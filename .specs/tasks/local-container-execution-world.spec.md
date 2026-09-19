---
id: TASK:sandbox/local-container-execution-world
type: task
status: accepted
summary: Implement the opt-in process-owned local container execution world and record the full-runtime direction.
owners: [carlo]
progress: in-progress
addresses:
  - REQ:sandbox/isolated-execution-world#c-opt-in
  - REQ:sandbox/isolated-execution-world#c-world
  - REQ:sandbox/isolated-execution-world#c-isolation
  - REQ:sandbox/isolated-execution-world#c-capabilities
  - REQ:sandbox/isolated-execution-world#c-authority
  - REQ:sandbox/isolated-execution-world#c-secrets
  - REQ:sandbox/isolated-execution-world#c-lifecycle
  - REQ:sandbox/isolated-execution-world#c-data
  - REQ:sandbox/isolated-execution-world#c-evidence
labels: [sandbox, container, permissions, performance]
assignee: carlo
---

# Local container execution world

## Acceptance

An optional local-container provider family owns exactly one disposable execution world per DSH process, stores its private writable volume below `/tmp`, and supplies matching filesystem and subprocess providers to generic file, shell, search, terminal, and LSP consumers. An opaque identity and Loader validator reject split-world provider pairs, and both providers map Session workdirs to `/workspace`. The container receives no ambient host credentials or network, exposes no host path or control socket, enforces configured resource bounds, and is removed with its backing directory after all managed work reaches quiescence. The optional composition fixes contained operations to non-interactive authorization while external and host control-plane effects retain their independent policy; unsupported child-agent providers are absent. Fake-engine tests cover lifecycle and protocol behavior, while mandatory Docker Engine tests qualify every supported root mode before review is disabled. Those tests verify the host boundary and report cold creation and repeated warm no-op latency separately from model and network time. The decision record sketches a later optional full agent-desktop runtime without treating it as implemented.
