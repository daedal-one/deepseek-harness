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

An optional local-container provider family owns exactly one disposable execution world per DSH process, stores its private writable volume below `/tmp`, and supplies matching filesystem and subprocess providers to generic file, shell, search, terminal, and LSP consumers. One verified owner container runs bounded filesystem controls; each concurrent process range runs in a separately removable sibling container sharing only that workspace mount, so removal proves descendant quiescence without an unavailable Podman exec-signal API. An opaque identity and Loader validator reject split-world provider pairs, and both providers map Session workdirs to `/workspace`. The owned containers receive no ambient host credentials or network, provider results expose no host path or control socket, per-container resource controls and bounded sibling concurrency define an aggregate maximum, and every container is removed before its backing directory after managed work reaches quiescence. The optional composition fixes contained operations to non-interactive authorization while external and host control-plane effects retain their independent policy; unsupported child-agent providers are absent. Fake-engine tests cover lifecycle and protocol behavior, while mandatory rootless Podman Engine tests qualify the supported engine mode before review is disabled. Those tests verify the host boundary and report cold creation and repeated warm no-op latency separately from model and network time. The decision record sketches a later optional full agent-desktop runtime without treating it as implemented.

## Runtime activation

The remote Web composition selects the container permission preset explicitly, waits for verified provider identity before shell-policy activation, omits classifier prewarming and policy decisions for contained commands, and retains policy enforcement for external tools. Validation includes the actual rootless engine and authenticated tailnet startup.

Source-based verification resolves the exported startup validator to its TypeScript source before any build; it must not load a second built module graph.

Fake-engine tests supply controlled host namespace observations and reject a container sharing either the PID or IPC namespace. Actual Linux namespace isolation remains part of rootless Podman qualification.
