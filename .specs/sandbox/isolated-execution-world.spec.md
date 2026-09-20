---
id: REQ:sandbox/isolated-execution-world
type: requirement
status: accepted
level: MUST
summary: Provide an opt-in disposable local container execution world for agent-controlled file and process operations.
owners: [carlo]
refines: []
categorized_under: []
---

# Isolated execution world

## Context

Model-backed policy review adds latency to unmatched operations in policy-reviewed mode. A disposable local execution world can remove that repeated decision from file and process operations when configured container controls prevent those operations from reaching host files, credentials, processes, sockets, or external networks. The container image, rootless Podman Engine, host kernel, and Harness control plane remain trusted.

:::{requirement id="isolated-execution-world" level="MUST"}
- {#c-opt-in} The local container execution world MUST be an opt-in composition and MUST NOT change shipped profile defaults.
- {#c-world} One runtime owner MUST provide one private host directory below `/tmp`, mounted as the only persistent writable volume in every container path namespace it owns. The filesystem and subprocess service definitions MUST expose an opaque execution-world identity; the container providers MUST publish the runtime owner's identity, and a composition validator MUST fail load when the two mounted providers differ. The providers MUST map every configured Session cwd to the runtime's canonical `/workspace` path, and provider-returned paths and diagnostics MUST NOT expose the host backing path.
- {#c-isolation} The provider MUST use a read-only container root, a private temporary filesystem, no host network, no added Linux capabilities, no privilege escalation, no host process namespace, and no host home, Harness state, credential, device, IPC, or container-engine socket mounts. It MUST fail closed when the configured container engine or image cannot establish those controls.
- {#c-capabilities} Agent file operations, shell commands, background commands, terminals, language servers, and searches in the isolated composition MUST use the shared filesystem and subprocess providers without provider-specific model tools. Child-agent providers that need external credentials or bypass `ctx.subprocess` MUST be unavailable until a separate brokered-runtime design contains them.
- {#c-authority} Contained file and process operations MUST run without per-operation model-backed or human approval. Browser, Web, MCP, model, credential, persistence, settings, telemetry, plugin-management, and other host control-plane or external effects MUST remain outside this authority and retain their independent authorization.
- {#c-secrets} Container processes MUST receive a replacement allowlisted environment. Ambient host credentials and ambient `DSH_*` values MUST NOT enter the execution world. Consumers MAY explicitly supply non-secret operation identifiers from the `DSH_*` namespace; secret forwarding requires a separate accepted broker capability.
- {#c-lifecycle} The initial implementation MUST own exactly one execution world per DSH process. One verified owner container MUST serve bounded filesystem control operations, while every concurrent agent process range MUST use a separately removable sibling container sharing only the private workspace bind; container removal is the process-range quiescence proof. The runtime MUST bound live sibling count, apply configured memory, CPU, and PID limits per container, document the resulting aggregate maximum, enforce configured output and lifetime limits, and own setup rollback, every container's removal, and backing-directory cleanup. Per-Session routing requires a separate accepted task.
- {#c-data} Host workspace import and sandbox output export MUST be explicit bounded host-owned operations that reject special files and reject symlinks unless the selected conversation-workspace lifecycle validates confined relative links without following them. The initial implementation MAY start with an empty volume and omit import/export while documenting that limitation. Automatic transfer requires the accepted conversation-workspace lifecycle and MUST NOT derive host authority from model-generated paths or commands.
- {#c-evidence} Focused unit and Loader-composition tests MUST prove cross-capability visibility, lifecycle cleanup, fail-closed setup, absence of tool-policy decisions for contained operations, and retained independent authorization for one external operation. Mandatory rootless Podman Engine coverage MUST prove mount, host-sentinel, network, environment, namespace, device, resource-limit, and cleanup behavior before the composition can disable review. Real-engine evidence MUST report cold world creation and repeated warm no-op operation latency separately from model and network latency before the composition is presented as a policy-reviewed speed replacement.
:::
