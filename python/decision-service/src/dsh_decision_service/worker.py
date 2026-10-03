"""Bounded, process-isolated synchronous decision backend transport."""

import asyncio
from collections import deque
from dataclasses import dataclass
import importlib
import json
import math
import os
import re
import struct
import sys
from typing import Any


_CODE = re.compile(r"[a-z][a-z0-9_]*\Z")
_STARTUP_LIMIT = 64 * 1024 * 1024
_ENV_KEYS = frozenset({
    "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "PYTHONPATH",
    "PYTHONHOME", "VIRTUAL_ENV", "LD_LIBRARY_PATH", "OMP_NUM_THREADS",
    "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "HF_HOME",
})


class ServiceError(Exception):
    """A non-sensitive HTTP status and machine-readable error code."""

    def __init__(self, status: int, code: str) -> None:
        if type(status) is not int or not 400 <= status <= 599 or not isinstance(code, str) or not _CODE.fullmatch(code):
            raise ValueError("invalid service error")
        self.status = status
        self.code = code
        super().__init__(code)


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _finite_float(raw: str) -> float:
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError("non-finite JSON")
    return value


def _reject_constant(raw: str) -> None:
    raise ValueError("non-finite JSON")


def _decode(data: bytes) -> Any:
    return json.loads(data.decode("utf-8"), parse_constant=_reject_constant, parse_float=_finite_float)


def _frame(data: bytes) -> bytes:
    return struct.pack("!I", len(data)) + data


def _child_read(stream: Any, limit: int) -> Any:
    header = stream.read(4)
    if len(header) != 4:
        raise EOFError
    size = struct.unpack("!I", header)[0]
    if size > limit:
        raise ValueError("oversized frame")
    data = stream.read(size)
    if len(data) != size:
        raise EOFError
    return _decode(data)


def _child_write(stream: Any, value: Any, limit: int) -> None:
    data = _json_bytes(value)
    if len(data) > limit:
        raise ValueError("oversized response")
    stream.write(_frame(data))


def _child() -> None:
    output = os.fdopen(os.dup(1), "wb", buffering=0)
    null = os.open(os.devnull, os.O_WRONLY)
    try:
        os.dup2(null, 1)
        os.dup2(null, 2)
    finally:
        os.close(null)
    backend = None
    try:
        startup = _child_read(sys.stdin.buffer, _STARTUP_LIMIT)
        request_limit = startup["request_limit"]
        response_limit = startup["response_limit"]
        module_name, separator, attribute = startup["factory"].partition(":")
        if not separator or not module_name or not attribute or "." in attribute:
            raise ValueError("invalid factory")
        backend = getattr(importlib.import_module(module_name), attribute)(startup["config"])
        _child_write(output, {"ready": True}, response_limit)
        while True:
            request = _child_read(sys.stdin.buffer, request_limit)
            if request == {"close": True}:
                close = getattr(backend, "close", None)
                if close is not None:
                    close()
                _child_write(output, {"closed": True}, response_limit)
                return
            try:
                result = backend.handle(request["operation"], request["payload"])
                if not isinstance(result, dict):
                    raise TypeError("backend response is not an object")
                _child_write(output, {"result": result}, response_limit)
            except ServiceError as error:
                _child_write(output, {"error": {"status": error.status, "code": error.code}}, response_limit)
    except Exception:
        try:
            if backend is not None:
                _child_write(output, {"unavailable": True}, response_limit)
        except Exception:
            return


@dataclass
class _Request:
    frame: bytes
    future: asyncio.Future[dict]
    deadline: float
    timer: asyncio.TimerHandle | None = None


class Worker:
    """One resident backend; fatal failures stop admission until a new Worker is created."""

    def __init__(
        self, factory: str, backend_config: dict, *, queue_size: int,
        queue_timeout: float, execution_timeout: float, startup_timeout: float,
        shutdown_timeout: float, max_request_bytes: int, max_response_bytes: int,
    ) -> None:
        if not isinstance(factory, str) or not isinstance(backend_config, dict):
            raise ValueError("invalid worker factory or configuration")
        if type(queue_size) is not int or queue_size < 0:
            raise ValueError("invalid queue size")
        if any(type(value) not in (int, float) or not 0 < value < float("inf") for value in (
            queue_timeout, execution_timeout, startup_timeout, shutdown_timeout,
        )):
            raise ValueError("invalid worker timeout")
        if any(type(value) is not int or not 0 < value <= 0xFFFFFFFF for value in (
            max_request_bytes, max_response_bytes,
        )):
            raise ValueError("invalid worker frame limit")
        self._factory = factory
        self._config = backend_config
        self._queue_size = queue_size
        self._queue_timeout = queue_timeout
        self._execution_timeout = execution_timeout
        self._startup_timeout = startup_timeout
        self._shutdown_timeout = shutdown_timeout
        self._max_request_bytes = max_request_bytes
        self._max_response_bytes = max_response_bytes
        self._queue: deque[_Request] = deque()
        self._event = asyncio.Event()
        self._active: _Request | None = None
        self._process: asyncio.subprocess.Process | None = None
        self._start_task: asyncio.Task[None] | None = None
        self._dispatcher: asyncio.Task[None] | None = None
        self._watcher: asyncio.Task[None] | None = None
        self._stop_task: asyncio.Task[None] | None = None
        self._reader_task: asyncio.Task | None = None
        self._ready = False
        self._failed = False
        self._closed = False

    @property
    def pid(self) -> int | None:
        """Return the running child PID, or None after exit."""
        process = self._process
        return process.pid if process is not None and process.returncode is None else None

    @property
    def available(self) -> bool:
        """Report readiness and permanent failure or disposal."""
        return self._ready and not self._failed and not self._closed and self.pid is not None

    async def start(self) -> None:
        """Load the backend once, bounded by startup_timeout; never restart on failure."""
        if self._closed or self._failed:
            raise ServiceError(503, "worker_unavailable")
        if self._start_task is None:
            self._start_task = asyncio.create_task(self._boot())
        await asyncio.shield(self._start_task)

    async def _boot(self) -> None:
        try:
            data = _json_bytes({
                "factory": self._factory, "config": self._config,
                "request_limit": self._max_request_bytes,
                "response_limit": self._max_response_bytes,
            })
            if len(data) > min(self._max_request_bytes, _STARTUP_LIMIT):
                raise ValueError("oversized configuration")
            env = {key: value for key, value in os.environ.items() if key in _ENV_KEYS}
            async with asyncio.timeout(self._startup_timeout):
                self._process = await asyncio.create_subprocess_exec(
                    sys.executable, "-B", "-c", "from dsh_decision_service.worker import _child; _child()",
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL, env=env,
                )
                if self._closed:
                    raise ValueError("worker closed")
                await self._send(_frame(data))
                if await self._receive() != {"ready": True}:
                    raise ValueError("worker startup failed")
            if self._closed:
                raise ValueError("worker closed")
            self._ready = True
            self._dispatcher = asyncio.create_task(self._dispatch())
            self._watcher = asyncio.create_task(self._watch_exit())
        except Exception:
            self._fail()
            if self._stop_task is not None:
                await asyncio.shield(self._stop_task)
            raise ServiceError(503, "worker_unavailable") from None

    async def submit(self, operation: str, payload: dict) -> dict:
        """Admit bounded JSON; queued calls expire, and active cancellation kills the child."""
        if not self.available:
            if self._process is not None and self._process.returncode is not None:
                self._fail()
            raise ServiceError(503, "worker_unavailable")
        if not isinstance(operation, str) or not isinstance(payload, dict):
            raise ServiceError(400, "invalid_request")
        try:
            data = _json_bytes({"operation": operation, "payload": payload})
        except (TypeError, ValueError, OverflowError, RecursionError):
            raise ServiceError(400, "invalid_request") from None
        if len(data) > self._max_request_bytes:
            raise ServiceError(413, "request_too_large")
        if len(self._queue) >= self._queue_size + (self._active is None):
            raise ServiceError(429, "queue_full")
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict] = loop.create_future()
        request = _Request(_frame(data), future, loop.time() + self._queue_timeout)
        self._queue.append(request)
        request.timer = loop.call_at(request.deadline, self._expire, request)
        self._event.set()
        try:
            return await future
        except asyncio.CancelledError:
            if self._active is request:
                self._fail()
                if self._stop_task is not None:
                    await asyncio.shield(self._stop_task)
            else:
                self._remove(request)
            raise

    def _remove(self, request: _Request) -> None:
        if request.timer is not None:
            request.timer.cancel()
        request.future.cancel()
        try:
            self._queue.remove(request)
        except ValueError:
            return

    def _expire(self, request: _Request) -> None:
        if self._active is request or request.future.done():
            return
        self._queue.remove(request)
        request.future.set_exception(ServiceError(504, "queue_timeout"))

    async def _send(self, frame: bytes) -> None:
        assert self._process is not None and self._process.stdin is not None
        self._process.stdin.write(frame)
        await self._process.stdin.drain()

    async def _receive(self, *, closing: bool = False) -> Any:
        if self._failed or (self._closed and not closing):
            raise ValueError("worker closed")
        assert self._process is not None and self._process.stdout is not None
        async def read_frame():
            header = await self._process.stdout.readexactly(4)
            length = struct.unpack("!I", header)[0]
            if length > self._max_response_bytes:
                raise ValueError("oversized response")
            return _decode(await self._process.stdout.readexactly(length))
        reader = self._reader_task = asyncio.create_task(read_frame())
        try:
            return await reader
        except asyncio.CancelledError:
            if self._failed or self._closed:
                raise ValueError("worker closed") from None
            raise
        finally:
            if self._reader_task is reader:
                self._reader_task = None

    async def _dispatch(self) -> None:
        while not self._closed and not self._failed:
            if not self._queue:
                self._event.clear()
                await self._event.wait()
                continue
            request = self._queue.popleft()
            if request.future.done():
                continue
            if asyncio.get_running_loop().time() >= request.deadline:
                if request.timer is not None:
                    request.timer.cancel()
                request.future.set_exception(ServiceError(504, "queue_timeout"))
                continue
            self._active = request
            if request.timer is not None:
                request.timer.cancel()
            try:
                async def exchange() -> Any:
                    await self._send(request.frame)
                    return await self._receive()
                response = await asyncio.wait_for(exchange(), self._execution_timeout)
                if not isinstance(response, dict):
                    raise ValueError("invalid worker response")
                if set(response) == {"result"} and isinstance(response["result"], dict):
                    if not self._closed and not self._failed and not request.future.done():
                        request.future.set_result(response["result"])
                elif set(response) == {"error"} and isinstance(response["error"], dict):
                    error = response["error"]
                    if set(error) != {"status", "code"}:
                        raise ValueError("invalid worker error")
                    rejection = ServiceError(error["status"], error["code"])
                    if not request.future.done():
                        request.future.set_exception(rejection)
                else:
                    raise ValueError("invalid worker response")
            except asyncio.TimeoutError:
                self._fail()
                if self._stop_task is not None:
                    await asyncio.shield(self._stop_task)
                if not request.future.done():
                    request.future.set_exception(ServiceError(504, "execution_timeout"))
            except Exception:
                self._fail()
                if self._stop_task is not None:
                    await asyncio.shield(self._stop_task)
                if not request.future.done():
                    request.future.set_exception(ServiceError(503, "worker_unavailable"))
            finally:
                self._active = None

    async def _watch_exit(self) -> None:
        assert self._process is not None
        await self._process.wait()
        if not self._closed and not self._failed:
            self._fail()

    def _reject_queue(self) -> None:
        while self._queue:
            request = self._queue.popleft()
            if request.timer is not None:
                request.timer.cancel()
            if not request.future.done():
                request.future.set_exception(ServiceError(503, "worker_unavailable"))

    def _fail(self) -> None:
        self._failed = True
        self._ready = False
        self._reject_queue()
        self._event.set()
        if self._stop_task is None and self._process is not None:
            self._stop_task = asyncio.create_task(self._reap(False))

    async def _reap(self, graceful: bool) -> None:
        process = self._process
        if process is None:
            return
        if graceful and process.returncode is None:
            try:
                async with asyncio.timeout(self._shutdown_timeout):
                    await self._send(_frame(_json_bytes({"close": True})))
                    if await self._receive(closing=True) != {"closed": True}:
                        raise ValueError("invalid worker close")
                    await process.wait()
            except Exception:
                graceful = False
        if not graceful:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass  # The exit watcher owns the already-exited child; join below.
            reader = self._reader_task
            if reader is not None:
                reader.cancel()
                await asyncio.gather(reader, return_exceptions=True)
            # A paused stdout transport can otherwise keep Process.wait() pending
            # even after SIGKILL. Drain after cancelling the sole framed reader.
            if process.stdout is not None:
                while await process.stdout.read(65536):
                    pass
        await process.wait()
        if process.stdin is not None:
            process.stdin.close()
            try:
                await process.stdin.wait_closed()
            except (BrokenPipeError, ConnectionResetError):
                return

    async def close(self) -> None:
        """Stop admission, reject queued calls, and await child and dispatcher exit."""
        graceful = self.available and self._active is None
        self._closed = True
        self._ready = False
        self._reject_queue()
        if self._active is not None and not self._active.future.done():
            self._active.future.set_exception(ServiceError(503, "worker_unavailable"))
        if self._process is not None and self._stop_task is None:
            self._stop_task = asyncio.create_task(self._reap(graceful))
        if self._stop_task is not None:
            await asyncio.shield(self._stop_task)
        if self._start_task is not None:
            await asyncio.gather(self._start_task, return_exceptions=True)
        self._event.set()
        if self._dispatcher is not None:
            await self._dispatcher
        if self._watcher is not None:
            await self._watcher


if __name__ == "__main__":
    _child()
