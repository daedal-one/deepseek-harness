---
id: TASK:tasks/daedal-dsh-remote-admission-teardown
type: task
status: accepted
summary: "Observe cancelled Remote admission and listener promises without publishing late results."
owners: [carlo]
progress: in-progress
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Remote admission teardown

## Plan

Keep the existing Client Remote event owner and cancellation helper. Once the owner has received an admission or listener Promise, cancellation must observe its eventual settlement even when the signal is already aborted. Pre-existing cancellation takes precedence over an already fulfilled value. A cancelled generation publishes no readiness or capability snapshot, and a cancelled listener sends no result RPC. Do not suppress process-level unhandled rejections, add retries or expose a test-only public API.

## Acceptance

Deterministic Client-owner tests cover synchronous listener cancellation with fulfilled and rejected values, late rejection after pending cancellation, and cancellation while consuming a native ready frame before capability admission. The regressions fail against the prior helper and pass with the correction. Existing Gateway and Connection lifecycle tests, applicable types/lint/docs checks and the original installed-frontend teardown case pass. Portable artifacts are regenerated through the normal packer after the backend source commit, never patched manually. No physical native-device or whole-phase acceptance is implied.

## Sources

- [Client event owner](spec:src:packages/api/gateway/src/client/remote-events.ts)
- [Gateway Client regressions](spec:src:packages/api/gateway/tests/gateway.client.spec.ts)
- [Gateway package reference](../../packages/api/gateway/README.md)
