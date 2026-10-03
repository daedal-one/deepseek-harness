"""Real subprocess lifecycle tests without model dependencies."""

import asyncio
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from dsh_decision_service.worker import ServiceError, Worker


class FakeBackend:
    def __init__(self, config: dict) -> None:
        if config.get("startup_delay"):
            time.sleep(config["startup_delay"])
        if config.get("startup_failure"):
            raise RuntimeError("private startup detail")
        self.marker = config.get("marker")
        self.close_delay = config.get("close_delay", 0)

    def handle(self, operation: str, payload: dict) -> dict:
        if self.marker:
            with open(self.marker, "a", encoding="utf-8") as stream:
                stream.write(operation + "\n")
        if operation in ("slow", "hang"):
            time.sleep(payload.get("delay", 10))
        if operation == "reject":
            raise ServiceError(422, "invalid_choice")
        if operation == "crash":
            raise RuntimeError("private input token")
        if operation == "die":
            os._exit(17)
        if operation == "large":
            return {"data": "x" * 1024}
        if operation == "flood":
            return {"data": "x" * (8 * 1024 * 1024)}
        if operation == "invalid":
            return {"number": float("nan")}
        if operation == "stdout":
            print("interference")
            os.write(1, b"fake response\n")
            os.write(2, b"private stderr\n")
        if operation == "environment":
            return {"secret": os.getenv("DECISION_TEST_SECRET"), "cuda": os.getenv("CUDA_VISIBLE_DEVICES")}
        return {"operation": operation, "payload": payload}

    def close(self) -> None:
        if self.close_delay:
            time.sleep(self.close_delay)


def fake_factory(config: dict) -> FakeBackend:
    return FakeBackend(config)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.workers: list[Worker] = []

    async def asyncTearDown(self) -> None:
        for worker in self.workers:
            await worker.close()

    def worker(self, config: dict | None = None, **options: object) -> Worker:
        values = dict(
            queue_size=1, queue_timeout=0.18, execution_timeout=1,
            startup_timeout=1, shutdown_timeout=0.18,
            max_request_bytes=512, max_response_bytes=512,
        )
        values.update(options)
        worker = Worker("test_worker:fake_factory", config or {}, **values)
        self.workers.append(worker)
        return worker

    async def assert_error(self, awaitable: object, status: int, code: str) -> None:
        with self.assertRaises(ServiceError) as caught:
            await awaitable
        self.assertEqual((caught.exception.status, caught.exception.code), (status, code))

    async def test_resident_worker_and_backend_rejection(self) -> None:
        worker = self.worker()
        self.assertFalse(worker.available)
        self.assertIsNone(worker.pid)
        await worker.start()
        pid = worker.pid
        self.assertTrue(worker.available)
        self.assertEqual(await worker.submit("stdout", {"x": 1}), {"operation": "stdout", "payload": {"x": 1}})
        await self.assert_error(worker.submit("reject", {}), 422, "invalid_choice")
        self.assertEqual(await worker.submit("ok", {}), {"operation": "ok", "payload": {}})
        self.assertEqual(worker.pid, pid)
        await worker.close()
        self.assertIsNone(worker.pid)
        self.assertFalse(worker.available)
        await self.assert_error(worker.submit("later", {}), 503, "worker_unavailable")

    async def test_queued_cancellation_frees_capacity_without_dispatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            marker = str(Path(directory) / "marker")
            worker = self.worker({"marker": marker}, queue_timeout=1)
            await worker.start()
            active = asyncio.create_task(worker.submit("slow", {"delay": 0.25}))
            await asyncio.sleep(0.04)
            queued = asyncio.create_task(worker.submit("cancelled", {}))
            await asyncio.sleep(0)
            await self.assert_error(worker.submit("full", {}), 429, "queue_full")
            queued.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await queued
            next_call = asyncio.create_task(worker.submit("next", {}))
            await active
            await next_call
            self.assertEqual(Path(marker).read_text(encoding="utf-8"), "slow\nnext\n")

    async def test_queued_expiry_never_runs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            marker = str(Path(directory) / "marker")
            worker = self.worker({"marker": marker}, queue_timeout=0.08)
            await worker.start()
            active = asyncio.create_task(worker.submit("slow", {"delay": 0.22}))
            await asyncio.sleep(0.03)
            await self.assert_error(worker.submit("expired", {}), 504, "queue_timeout")
            await active
            self.assertEqual(Path(marker).read_text(encoding="utf-8"), "slow\n")
            self.assertTrue(worker.available)

    async def test_active_cancellation_terminates_and_joins(self) -> None:
        worker = self.worker()
        await worker.start()
        pid = worker.pid
        active = asyncio.create_task(worker.submit("hang", {}))
        await asyncio.sleep(0.06)
        active.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await active
        self.assertFalse(worker.available)
        self.assertIsNone(worker.pid)
        self.assertNotEqual(pid, worker.pid)
        await self.assert_error(worker.submit("after", {}), 503, "worker_unavailable")

    async def test_hard_timeout_kills_and_joins_and_rejects_queue(self) -> None:
        worker = self.worker(execution_timeout=0.12, queue_timeout=1)
        await worker.start()
        active = asyncio.create_task(worker.submit("hang", {}))
        await asyncio.sleep(0.03)
        pending = asyncio.create_task(worker.submit("queued", {}))
        await self.assert_error(active, 504, "execution_timeout")
        await self.assert_error(pending, 503, "worker_unavailable")
        self.assertFalse(worker.available)
        self.assertIsNone(worker.pid)

    async def test_close_during_active_rejects_everything_and_joins(self) -> None:
        worker = self.worker(queue_timeout=1)
        await worker.start()
        active = asyncio.create_task(worker.submit("hang", {}))
        await asyncio.sleep(0.03)
        pending = asyncio.create_task(worker.submit("queued", {}))
        await asyncio.sleep(0)
        await worker.close()
        await self.assert_error(active, 503, "worker_unavailable")
        await self.assert_error(pending, 503, "worker_unavailable")
        self.assertIsNone(worker.pid)
        await worker.close()

    async def test_fatal_backend_error_and_exit_do_not_leak(self) -> None:
        for operation in ("crash", "die", "large", "invalid"):
            with self.subTest(operation=operation):
                worker = self.worker(max_response_bytes=128)
                await worker.start()
                await self.assert_error(worker.submit(operation, {}), 503, "worker_unavailable")
                await worker.close()
                self.assertFalse(worker.available)
                self.assertIsNone(worker.pid)

    async def test_timeout_drains_paused_stdout_before_join(self) -> None:
        worker = self.worker(max_response_bytes=16 * 1024 * 1024, execution_timeout=0.2)
        await worker.start()
        stream = worker._process.stdout
        original = stream.readexactly
        async def stall_payload(size):
            if size > 4:
                await asyncio.Event().wait()
            return await original(size)
        # Keep the real pipe unread after its header so the transport reaches
        # its high-water mark while the child is writing a multi-megabyte frame.
        with patch.object(stream, "readexactly", side_effect=stall_payload):
            await asyncio.wait_for(self.assert_error(worker.submit("flood", {}), 504, "execution_timeout"), 2)
        self.assertIsNone(worker.pid)
        self.assertFalse(worker.available)

    async def test_startup_failure_and_timeout_are_permanent(self) -> None:
        for config in ({"startup_failure": True}, {"startup_delay": 10}):
            with self.subTest(config=config):
                worker = self.worker(config, startup_timeout=0.12)
                await self.assert_error(worker.start(), 503, "worker_unavailable")
                self.assertIsNone(worker.pid)
                await self.assert_error(worker.start(), 503, "worker_unavailable")

    async def test_bounded_json_and_no_inherited_secret_or_cuda(self) -> None:
        with patch.dict(os.environ, {"DECISION_TEST_SECRET": "private", "CUDA_VISIBLE_DEVICES": "0"}):
            worker = self.worker(max_request_bytes=256, max_response_bytes=128)
            await worker.start()
            self.assertEqual(await worker.submit("environment", {}), {"secret": None, "cuda": None})
            await self.assert_error(worker.submit("big", {"data": "a" * 256}), 413, "request_too_large")
            await self.assert_error(worker.submit("nan", {"value": float("nan")}), 400, "invalid_request")
            self.assertTrue(worker.available)

    async def test_close_during_startup_kills_and_joins(self) -> None:
        worker = self.worker({"startup_delay": 10}, startup_timeout=1)
        startup = asyncio.create_task(worker.start())
        for _ in range(100):
            if worker.pid is not None:
                break
            await asyncio.sleep(0.01)
        self.assertIsNotNone(worker.pid)
        await worker.close()
        await self.assert_error(startup, 503, "worker_unavailable")
        self.assertIsNone(worker.pid)

    async def test_graceful_close_timeout_kills_and_joins(self) -> None:
        worker = self.worker({"close_delay": 10}, shutdown_timeout=0.12)
        await worker.start()
        await worker.close()
        self.assertIsNone(worker.pid)
        self.assertFalse(worker.available)

    async def test_unexpected_idle_exit_stops_dispatcher(self) -> None:
        worker = self.worker()
        await worker.start()
        assert worker.pid is not None
        os.kill(worker.pid, 9)
        for _ in range(100):
            if not worker.available:
                break
            await asyncio.sleep(0.01)
        self.assertFalse(worker.available)
        await asyncio.wait_for(worker.close(), 1)
        await self.assert_error(worker.submit("later", {}), 503, "worker_unavailable")

    async def test_zero_queue_allows_one_active_only(self) -> None:
        worker = self.worker(queue_size=0)
        await worker.start()
        active = asyncio.create_task(worker.submit("slow", {"delay": 0.15}))
        await asyncio.sleep(0)
        await self.assert_error(worker.submit("second", {}), 429, "queue_full")
        await active
