# Agent Note: Forge adapter authentication through lifecycle proxies

Status: implemented

## Problem

The OpenSandbox lifecycle proxy strips generic `Authorization` credentials before forwarding a request into a sandbox. The Forge session adapter required a bearer credential in that header, so its authenticated routes were unreachable through the deployment proxy even though sandbox allocation and endpoint resolution succeeded.

## Decision

The Forge session adapter accepts its deployment-owned token only through `X-Forge-Adapter-Token`. Forge sends that header for DeepSeek Harness discovery and commands whether it reaches the adapter directly or through OpenSandbox. OpenSandbox lifecycle authentication remains a separate control-plane credential and never enters the sandbox request.

The adapter rejects a generic bearer credential even when its value matches. This keeps proxy credentials, model-provider credentials, and adapter authentication in separate headers and makes proxy filtering fail closed.

## Alternatives considered

**Expose Docker-mapped adapter ports directly to the worker.** Rejected because it makes Forge depend on runtime-specific routing and bypasses the lifecycle server's endpoint boundary.

**Forward generic `Authorization` through the lifecycle proxy.** Rejected because the proxy intentionally removes ambient credentials before contacting an untrusted sandbox service, and changing that rule would widen every proxied application boundary.

**Put the adapter token in the endpoint URL.** Rejected because URLs leak more readily through access logs, traces, redirects, and diagnostics.

## Consequences

Direct callers must use `X-Forge-Adapter-Token`; bearer-only requests receive `401`. The dedicated header survives OpenSandbox's credential filtering, while the adapter token remains mandatory at the application route. Unit coverage pins both acceptance and bearer rejection, and the Forge OpenSandbox smoke path verifies discovery through the server proxy.
