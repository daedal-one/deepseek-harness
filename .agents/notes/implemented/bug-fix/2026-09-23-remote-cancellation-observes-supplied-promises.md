# Agent Note: Remote cancellation observes supplied promises

Status: implemented

## Problem

A Remote generation can end after its event carrier yields a ready frame but before the Client admits that frame. A forwarded listener can also cancel its generation synchronously while returning a Promise. Throwing immediately for the cancelled signal leaves the already-created admission or listener Promise without a rejection observer. The visible operation is cancelled, but its later failure can still escape as an unhandled rejection.

## Decision

The [Client event owner](../../../../packages/api/gateway/src/client/remote-events.ts) races cancellation against every supplied value, including values received with an already-aborted signal. It places cancellation first so a pre-existing abort wins over an already fulfilled value. Both participants retain settlement observers, and the helper releases its abort listener when the race settles. Cancelled admission publishes no generation or capabilities; cancelled deliveries send no result RPC.

The [portable Client ownership decision](../architecture/2026-09-15-portable-client-connections.md) continues to own per-Host lifetime, transport and recovery. This correction preserves that decision and changes no wire descriptor, business revision, retry policy or public export.

## Alternatives considered

**Wait for reconnection before frontend teardown.** This avoids one triggering schedule but leaves the same cancellation window in other consumers and real carriers.

**Suppress unhandled rejections globally.** That hides unrelated ownership failures and does not attach a settlement observer to the abandoned operation.

**Throw before consuming the supplied Promise.** Cancellation can stop publication but cannot undo creation of a Promise that already belongs to the operation.

## Consequences

Cancellation remains prompt even when a carrier or listener ignores its signal. Observing its eventual settlement does not mean the underlying work has stopped. Deterministic [Client regressions](../../../../packages/api/gateway/tests/gateway.client.spec.ts) exercise synchronous cancellation with settled listener values, pending cancellation followed by late rejection, and cancelled ready-frame admission through the existing owner. No model-visible, Session-log or durable-format behavior changes; physical native execution remains separately qualified.
