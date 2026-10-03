"""Real loopback Uvicorn requests and production subprocess supervision, no weights."""

import asyncio
from contextlib import asynccontextmanager
import json
from pathlib import Path
import socket
import tempfile
import unittest

import httpx
import uvicorn

from dsh_decision_service.service import create_app
from dsh_decision_service.worker import Worker
from support import limits, request

KEY = "synthetic-private-key"


@asynccontextmanager
async def serving(*, mode="kev", overrides=None, backend=None):
    caps = limits(**(overrides or {}))
    worker = Worker("support:create", {"mode": mode, "limits": overrides or {}, **(backend or {})},
                    queue_size=caps.queue_size, queue_timeout=caps.queue_timeout,
                    execution_timeout=caps.execution_timeout, startup_timeout=caps.startup_timeout,
                    shutdown_timeout=caps.shutdown_timeout, max_request_bytes=caps.max_request_bytes,
                    max_response_bytes=caps.max_response_bytes)
    app = create_app(limits=caps, bearer_key=KEY, worker=worker, mode=mode)
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, lifespan="on", log_config=None,
                                          access_log=False, log_level="critical", http="h11", ws="none"))
    task = asyncio.create_task(server.serve(sockets=[sock]))
    try:
        async with asyncio.timeout(6):
            while not server.started:
                if task.done():
                    await task
                    raise RuntimeError("test server failed startup")
                await asyncio.sleep(0.01)
        async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", headers={"Authorization": f"Bearer {KEY}"},
                                     timeout=5, trust_env=False) as client:
            yield client, worker
    finally:
        server.should_exit = True
        await task
        sock.close()
        await worker.close()


def envelope(raw=None):
    return {"version": 1, "deployment": "fake-deployment", "request": raw or request()}


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_prepare_is_pure_and_decision_preserves_full_distribution_and_official_usage(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "calls"
            async with serving(backend={"marker": str(marker)}) as (client, worker):
                payload = envelope(request(criteria={"a": "A", "b": "B", "c": "C"}))
                prepared = await client.post("/v1/prepare", json=payload)
                self.assertEqual(prepared.status_code, 200, prepared.text)
                self.assertFalse(marker.exists())
                value = prepared.json()
                self.assertEqual(value["identity"]["serviceCaps"]["vocabSize"], 512)
                self.assertEqual(value["preparation"]["inputTokens"], len(value["preparation"]["tokenIds"]))
                ranked = await client.post("/v1/decision", json={**payload, "preparation": value["preparation"]})
                self.assertEqual(ranked.status_code, 200, ranked.text)
                result = ranked.json()
                self.assertEqual(set(result["probabilities"]), {"a", "b", "c"})
                self.assertAlmostEqual(sum(result["probabilities"].values()), 1)
                self.assertEqual(result["result"]["answers"]["transition"]["probabilities"]["a"], 0.3333)
                self.assertGreater(result["result"]["usage"]["output_tokens"], 0)
                self.assertEqual(marker.read_text(), "hello\n")
                self.assertTrue(worker.available)
            self.assertFalse(worker.available)

    async def test_auth_wrong_identity_duplicates_and_malformed_preparation(self):
        async with serving() as (client, _worker):
            response = await client.post("/v1/prepare", json=envelope(), headers={"Authorization": "Bearer wrong"})
            self.assertEqual(response.status_code, 401)
            response = await client.post("/v1/prepare", json={**envelope(), "deployment": "wrong"})
            self.assertEqual(response.status_code, 422)
            response = await client.post("/v1/prepare", content='{"version":1,"version":1}', headers={"Content-Type": "application/json"})
            self.assertEqual(response.status_code, 400)
            response = await client.post("/v1/decision", json={**envelope(), "preparation": {}})
            self.assertEqual(response.status_code, 422)
            valid = (await client.post("/v1/prepare", json=envelope())).json()["preparation"]
            valid["tokenIds"][0] = True
            response = await client.post("/v1/decision", json={**envelope(), "preparation": valid})
            self.assertEqual(response.status_code, 422)
            response = await client.post("/v1/prepare", json=envelope(request().replace('"kev-test"', '"other-model"')))
            self.assertEqual(response.status_code, 422)

    async def test_reencoding_drift_never_scores(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "calls"
            async with serving(backend={"drift": True, "marker": str(marker)}) as (client, _):
                payload = envelope()
                prep = (await client.post("/v1/prepare", json=payload)).json()["preparation"]
                result = await client.post("/v1/decision", json={**payload, "preparation": prep})
                self.assertEqual(result.status_code, 422)
                self.assertFalse(marker.exists())

    async def test_request_response_depth_and_token_bounds(self):
        async with serving(overrides={"max_request_bytes": 800, "max_response_bytes": 900}) as (client, _):
            response = await client.post("/v1/prepare", json=envelope())
            self.assertEqual(response.status_code, 503)
            response = await client.post("/v1/prepare", json=envelope(request("x" * 900)))
            self.assertEqual(response.status_code, 413)
            response = await client.post("/v1/prepare", content='[' * 17 + '0' + ']' * 17,
                                         headers={"Content-Type": "application/json"})
            self.assertEqual(response.status_code, 400)
        async with serving(overrides={"max_input_tokens": 100, "max_state_tokens": 100}) as (client, _):
            response = await client.post("/v1/prepare", json=envelope())
            self.assertEqual(response.status_code, 422)

    async def test_tokenizer_only_batch_identity_special_tokens_and_limits(self):
        async with serving(mode="tokenizer") as (client, _):
            response = await client.post("/v1/tokenize", json={"version": 1, "tokenizer": "fake-tokenizer", "texts": ["", "a", "é"]})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual([entry["tokens"] for entry in response.json()["counts"]], [1, 2, 3])
            self.assertEqual([entry["index"] for entry in response.json()["counts"]], [0, 1, 2])
            response = await client.post("/v1/tokenize", json={"version": 1, "tokenizer": "wrong", "texts": ["a"]})
            self.assertEqual(response.status_code, 422)
            response = await client.post("/v1/tokenize", json={"version": 1, "tokenizer": "fake-tokenizer", "texts": [""] * 9})
            self.assertEqual(response.status_code, 422)
            response = await client.post("/v1/prepare", json=envelope())
            self.assertEqual(response.status_code, 404)

    async def test_active_hang_killed_and_worker_stays_unavailable(self):
        async with serving(overrides={"execution_timeout": 0.15}) as (client, worker):
            payload = envelope(request("hang"))
            prep = (await client.post("/v1/prepare", json=payload)).json()["preparation"]
            response = await client.post("/v1/decision", json={**payload, "preparation": prep})
            self.assertEqual(response.status_code, 504, response.text)
            self.assertFalse(worker.available)
            response = await client.post("/v1/prepare", json=envelope())
            self.assertEqual(response.status_code, 503)

    async def test_client_disconnect_cancels_queued_request_before_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "calls"
            async with serving(overrides={"queue_timeout": 1.0}, backend={"marker": str(marker)}) as (client, worker):
                first, second = envelope(request("slow")), envelope(request("cancelled"))
                first["preparation"] = (await client.post("/v1/prepare", json=first)).json()["preparation"]
                second["preparation"] = (await client.post("/v1/prepare", json=second)).json()["preparation"]
                active = asyncio.create_task(client.post("/v1/decision", json=first))
                async with asyncio.timeout(2):
                    while not marker.exists():
                        await asyncio.sleep(0.005)
                queued = asyncio.create_task(client.post("/v1/decision", json=second))
                await asyncio.sleep(0.05)
                queued.cancel()
                await asyncio.gather(queued, return_exceptions=True)
                self.assertEqual((await active).status_code, 200)
                await worker.close()
                self.assertEqual(marker.read_text(), "slow\n")

    async def test_already_pending_disconnect_is_not_admitted(self):
        from unittest.mock import patch
        async with serving() as (_client, worker):
            app = create_app(limits=limits(), bearer_key=KEY, worker=worker, mode="kev")
            incoming = iter([{"type": "http.request", "body": json.dumps(envelope()).encode(), "more_body": False},
                             {"type": "http.disconnect"}])
            outgoing = []
            async def receive():
                return next(incoming)
            async def send(message):
                outgoing.append(message)
            scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "scheme": "http",
                     "method": "POST", "path": "/v1/prepare", "raw_path": b"/v1/prepare", "query_string": b"",
                     "headers": [(b"authorization", f"Bearer {KEY}".encode()), (b"content-type", b"application/json")],
                     "client": ("127.0.0.1", 43210), "server": ("127.0.0.1", 8765)}
            with patch.object(worker, "submit", wraps=worker.submit) as submission:
                await app(scope, receive, send)
                submission.assert_not_called()
            self.assertEqual(outgoing[0]["status"], 499)
            self.assertTrue(worker.available)

    async def test_active_http_disconnect_joins_process_and_requires_operator_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "calls"
            async with serving(backend={"marker": str(marker)}) as (client, worker):
                payload = envelope(request("hang"))
                payload["preparation"] = (await client.post("/v1/prepare", json=payload)).json()["preparation"]
                active = asyncio.create_task(client.post("/v1/decision", json=payload))
                async with asyncio.timeout(2):
                    while not marker.exists():
                        await asyncio.sleep(0.005)
                active.cancel()
                await asyncio.gather(active, return_exceptions=True)
                async with asyncio.timeout(2):
                    while worker.pid is not None:
                        await asyncio.sleep(0.005)
                self.assertFalse(worker.available)
                response = await client.post("/v1/prepare", json=envelope())
                self.assertEqual(response.status_code, 503)
                self.assertEqual(marker.read_text(), "hang\n")

    async def test_queue_expiry_never_dispatches_request(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "calls"
            async with serving(backend={"marker": str(marker)}) as (client, _):
                first, second = envelope(request("slow")), envelope(request("expired"))
                first["preparation"] = (await client.post("/v1/prepare", json=first)).json()["preparation"]
                second["preparation"] = (await client.post("/v1/prepare", json=second)).json()["preparation"]
                active = asyncio.create_task(client.post("/v1/decision", json=first))
                async with asyncio.timeout(2):
                    while not marker.exists():
                        await asyncio.sleep(0.005)
                response = await client.post("/v1/decision", json=second)
                self.assertEqual(response.status_code, 504)
                self.assertEqual((await active).status_code, 200)
                self.assertEqual(marker.read_text(), "slow\n")


if __name__ == "__main__":
    unittest.main()
