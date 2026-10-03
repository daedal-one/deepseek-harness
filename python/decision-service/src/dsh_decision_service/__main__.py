"""Operator-launched Python service; DSH composition remains a dsh profile."""

from __future__ import annotations

import argparse
import logging
import os
import sys

from .config import Manifest, ServerConfig


def main():
    """Validate fixed deployment configuration, then bind one loopback ASGI process."""
    parser = argparse.ArgumentParser(description="Offline local decision service")
    parser.add_argument("--config", required=True, help="private operator JSON configuration path")
    args = parser.parse_args()
    try:
        config = ServerConfig.load(args.config)
        # Remove even an unusually named credential variable before spawning the worker.
        bearer = os.environ.pop(config.bearer_env)
        manifest = Manifest(config.manifest, config.manifest_sha256)
        limits = manifest.limits
        from .service import create_app
        from .worker import Worker
        worker = Worker("dsh_decision_service.backend:create_backend",
                        {"manifest": config.manifest, "manifest_sha256": config.manifest_sha256},
                        queue_size=limits.queue_size, queue_timeout=limits.queue_timeout,
                        execution_timeout=limits.execution_timeout, startup_timeout=limits.startup_timeout,
                        shutdown_timeout=limits.shutdown_timeout,
                        max_request_bytes=limits.max_request_bytes, max_response_bytes=limits.max_response_bytes)
        app = create_app(limits=limits, bearer_key=bearer, worker=worker, mode=manifest.data["mode"])
    except Exception:
        print("decision service configuration verification failed", file=sys.stderr)
        raise SystemExit(2) from None
    import uvicorn
    # Bodies, credentials, paths and worker exceptions are never routed to service logs.
    logging.disable(logging.CRITICAL)
    server = uvicorn.Server(uvicorn.Config(app, host=config.host, port=config.port, workers=1,
                                          reload=False, lifespan="on", loop="asyncio", http="h11", ws="none",
                                          proxy_headers=False, access_log=False, log_config=None,
                                          limit_concurrency=limits.http_concurrency, backlog=limits.http_backlog,
                                          timeout_keep_alive=limits.http_keep_alive,
                                          timeout_graceful_shutdown=limits.shutdown_timeout,
                                          h11_max_incomplete_event_size=limits.http_header_bytes))
    server.run()
    if not server.started:
        print("decision service startup failed", file=sys.stderr)
        raise SystemExit(3)


if __name__ == "__main__":
    main()
