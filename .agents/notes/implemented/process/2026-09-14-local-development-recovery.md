# Agent Note: Local development recovery proxy

Status: implemented

## Problem

A Harness served from its development checkout can stop working after its own agent changes or rebuilds it. The operator needs a fixed address with a recovery action that remains usable when the application fails.

## Decision

The [repository recovery tool](../../../../scripts/dev-proxy.ts) installs an independent supervisor and a fixed loopback HTTP/WebSocket proxy. Its private recovery page explicitly selects the current checkout or a retained committed build. The [backend owner](../../../../scripts/dev-proxy-runtime.ts) starts supported applications only through the built dsh Web profile. It waits for that child's complete-boot announcement rather than accepting a response from any process on a guessed port.

Last-good selection is an operator assertion after an actual code edit. A clean revision recorded around the current build and an unchanged artifact fingerprint bind that assertion to executable code. Retention installs the recorded commit's dependencies in an independent clone and copies the observed build artifacts; it rejects checkout changes and concurrent rebuilds before publishing the pointer. Preparation failure leaves the previous pointer intact. The proxy contains no task-success classifier or automatic fallback.

One backend process tree owns the shared Harness home at a time. Switching interrupts active work, closes old upgraded streams, awaits process exit, and starts the requested backend. The public address and recovery process survive backend build and boot failures. Recovery control requests require a private capability plus accepted Host and Origin; application requests preserve their original authority, cookies, status, and streaming bodies.

Recovery pages use `Referrer-Policy: same-origin` so HTML form submissions retain the origin required by the access check. The [Fetch standard](https://fetch.spec.whatwg.org/#append-a-request-origin-header) sets a form navigation's Origin to `null` under `no-referrer`. Token-bearing authentication redirects retain `no-referrer`; cross-origin and opaque-origin requests remain rejected. The [browser regression](../../../../apps/web/tests/local-recovery.e2e.ts) submits every recovery form through an isolated listener with recorded control actions.

## Alternatives considered

**Stable and candidate release channels with separate data generations.** This provides stronger migration rollback, but adds deployment and data-management machinery beyond a local developer's explicit rescue action.

**A recovery plugin inside the Harness.** A broken plugin graph, dependency, or build could prevent the recovery control itself from loading. Installed supervisor sources import only Node APIs and the other installed supervisor file.

**Infer task success or retry failed requests.** A completed HTTP request does not establish a successful code edit, and replay can duplicate tool side effects. An explicit operator confirmation and manual selection preserve the intended meaning of last good.

## Consequences

The independent checkout and dependency installation cost disk space and preparation time. Node and pnpm remain machine prerequisites. Personal configuration, out-of-tree plugins, and persisted data are shared; the retained executable does not provide configuration or data downgrade. [Desktop activation](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md) remains its separate application-owned mechanism; this development tool does not supersede it.

The [focused process and transport tests](../../../../scripts/dev-proxy.spec.ts) cover broken startup followed by editing through the retained fixture runtime, dirty and rebuilt provenance refusal, preparation failure preserving the prior record, forced termination, explicit selection persistence, streaming, upgrade traffic, access rejection, and exclusive operations. Their miniature dsh process is fixture evidence; an assembled local Harness editing smoke is a separate acceptance check. The recovery page has an owner-local expected artifact. The [cookbook](../../../../docs/cookbook/local-development-recovery.md) owns installation, Tailscale placement, and operator actions.

Local assembled acceptance uses committed Harness `acf06eb3031bc6f3d27ab77da7c3b1a1a004ec48`, the real DeepSeek V4.1 Flash route, the shipped standard preset, and isolated data and workspace directories. A real model edit and Python assertion qualify the retained build. An intentional TypeScript syntax error then rejects the temporary current build; manual fallback reopens the same Session and performs another model edit with a passing Python assertion. The browser uses the normal workspace API to register the scratch directory because its native folder picker is outside the headless browser. Two concurrent independent test processes also pass all seven focused tests.
