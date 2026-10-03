"""Bounded authenticated FastAPI routes owning disconnect and worker lifetimes."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hmac
import ipaddress
import json

from fastapi import FastAPI, Request
from starlette.responses import Response

from .config import Limits, parse_json
from .worker import ServiceError, Worker


def create_app(*, limits: Limits, bearer_key: str, worker: Worker, mode: str) -> FastAPI:
    """Build the real HTTP routes; the supervisor is injectable only in the library API.

    The production entrypoint selects the verified backend, not a caller-controlled
    factory. Bodies are read once, then a single receive task owns disconnects.
    Cancellation awaits the worker submission's cleanup before route settlement.
    """
    if not isinstance(bearer_key, str) or not bearer_key or not bearer_key.isascii() or any(c.isspace() for c in bearer_key):
        raise ValueError("a nonempty ASCII bearer key without whitespace is required")
    if mode not in ("kev", "tokenizer"):
        raise ValueError("unknown service mode")
    authorization = ("Bearer " + bearer_key).encode("ascii")

    @asynccontextmanager
    async def lifespan(_app):
        try:
            await worker.start()
            yield
        finally:
            await worker.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.worker = worker

    def error(status: int, code: str) -> Response:
        return Response(json.dumps({"error": code}, separators=(",", ":")).encode(), status_code=status,
                        media_type="application/json", headers={"Cache-Control": "no-store"})

    async def dispatch(request: Request, operation: str) -> Response:
        # Loopback binding is also checked by the CLI; this protects alternate ASGI hosts.
        try:
            if request.client is None or not ipaddress.ip_address(request.client.host).is_loopback:
                return error(403, "loopback_required")
        except ValueError:
            return error(403, "loopback_required")
        headers = request.scope["headers"]
        auth = [v for k, v in headers if k.lower() == b"authorization"]
        if len(auth) != 1 or not hmac.compare_digest(auth[0], authorization):
            return error(401, "unauthorized")
        content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json" or request.headers.get("content-encoding", "identity") != "identity":
            return error(415, "json_required")
        if request.url.query:
            return error(422, "query_not_supported")
        body = bytearray()
        try:
            async with asyncio.timeout(limits.body_timeout):
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > limits.max_request_bytes:
                        return error(413, "request_too_large")
            payload = parse_json(bytes(body), limits.max_json_depth)
        except TimeoutError:
            return error(408, "body_timeout")
        except (ValueError, UnicodeError, RecursionError):
            return error(400, "invalid_json")
        # A disconnected stream has no usable response channel and is not admitted.
        except Exception as exc:
            from starlette.requests import ClientDisconnect
            if isinstance(exc, ClientDisconnect):
                return error(499, "client_disconnected")
            raise

        owned = None
        async def disconnected():
            while True:
                message = await request.receive()
                if message["type"] == "http.disconnect":
                    # Cancel at observation time, not later when the route waiter
                    # resumes: the dispatcher must see a cancelled queued future.
                    if owned is not None:
                        owned.cancel()
                    return

        watcher = asyncio.create_task(disconnected())
        try:
            # Consume a disconnect already pending after the body before admission.
            await asyncio.sleep(0)
            if watcher.done():
                return error(499, "client_disconnected")
            owned = asyncio.create_task(worker.submit(operation, payload))
            done, _ = await asyncio.wait({owned, watcher}, return_when=asyncio.FIRST_COMPLETED)
            if watcher in done:
                await asyncio.gather(owned, return_exceptions=True)
                return error(499, "client_disconnected")
            result = await owned
            raw = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
            if len(raw) > limits.max_response_bytes:
                return error(503, "response_too_large")
            return Response(raw, media_type="application/json", headers={"Cache-Control": "no-store"})
        except ServiceError as exc:
            return error(exc.status, exc.code)
        except (ValueError, UnicodeError, TypeError):
            return error(503, "invalid_worker_response")
        finally:
            watcher.cancel()
            if owned is not None and not owned.done() and not owned.cancelling():
                owned.cancel()
            await asyncio.gather(watcher, *([owned] if owned is not None else []), return_exceptions=True)

    if mode == "kev":
        @app.post("/v1/prepare")
        async def prepare(request: Request):
            return await dispatch(request, "prepare")

        @app.post("/v1/decision")
        async def decision(request: Request):
            return await dispatch(request, "decision")
    else:
        @app.post("/v1/tokenize")
        async def tokenize(request: Request):
            return await dispatch(request, "tokenize")

    return app
