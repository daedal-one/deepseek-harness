---
description: "Daedal-only execution guidance and human-confirmed transfer of host maintenance to a separately launched host profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-daedal-handoff

## Summary

Transfer host-maintenance work from an isolated Daedal session after the user reviews the destination and complete task. A new session runs in a separately launched host profile; the source keeps its execution environment and permissions. Choose this package for the Daedal and Daedal OpenAI presets. The destination must be configured by the operator, and each transfer requires an explicit human answer.

## Table of Contents

- [Use this package](#use-this-package)
- [Runtime contract](#runtime-contract)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

The default entry installs the host-owned `daedalHandoff` service. Its optional `destinationUrl` and `token` must be configured together; an absent pair leaves handoff unavailable. `destinationUrl` accepts an HTTPS origin or numeric loopback HTTP origin, without credentials, path, query, or fragment. The dedicated token must contain at least 32 characters and remain outside agent workspaces. `timeoutMs` defaults to 15000 per HTTP exchange; `maxBytes` defaults to 65536 for complete serialized requests and responses.

Mount `@deepseek-ai/dsh-daedal-handoff/tool` only in the [Daedal presets](../../../docs/reference/daedal/README.md). It adds execution guidance and `handoff_to_host`; mounting the default service does not publish either globally. The calling session’s filesystem and subprocess providers determine whether it runs on the host, including providers isolated inside its preset. Host sessions refuse redundant host handoffs. The service requires the current logged preset to be `daedal` or `daedal-openai` and the caller to be the exact live root agent.

The separate host Web profile mounts `@deepseek-ai/dsh-daedal-handoff/receiver`. Configure its `name`, absolute existing `cwd`, and the same dedicated `token`. An optional `publicUrl` advertises the browser origin when the source connects over loopback; this HTTP(S) origin is also part of the reviewed destination. Its `maxBytes` and `timeoutMs` default to 65536 and 15000. The receiver rejects non-host filesystem or subprocess providers. Follow the [host-profile setup](../../../apps/cli/reference/README.md#host-maintenance); starting this plugin in a container never grants host access.

```yaml
- id: daedal-handoff-receiver
  name: '@deepseek-ai/dsh-daedal-handoff/receiver'
  config:
    name: Host maintenance
    cwd: /srv/harness
    token: !!js process.env.DSH_HANDOFF_TOKEN
    maxBytes: 65536
    timeoutMs: 15000
```

The source [Daedal host patch](../../../docs/reference/daedal/host/cordis.patch.yml) reads `DSH_HANDOFF_URL` and `DSH_HANDOFF_TOKEN`. Keep container overrides in the source profile, configure the receiver in a distinct host-backed Web profile, and give the profiles separate listen ports. Preserve the ordinary Web authentication and loopback binding; the dedicated handoff token authorizes only this receiver and does not replace browser sign-in.

## Runtime contract

`GET /daedal-handoff/v1` authenticates and returns the receiver's name and working directory. The source presents those values, the origin, selected Daedal preset, and complete task to the existing user-question interface. Only the single selected **Start host session** answer without additional free text authorizes `POST`; rejection, unavailable interaction, and pre-dispatch cancellation start no work. A destination configuration change requires a new confirmation.

The authenticated `POST` validates a bounded UTF-8 JSON request and creates a separate ordinary session through the Session Controller, preserving the selected Daedal preset. A stable identity derived from the exact request protects repeated delivery; the existing session and prompt admission owners prevent duplicate prompt execution. Source permissions and provider identities remain unchanged. The task and source session reference become the destination's first user message, while the source's tool call and result retain its task and receipt.

A post-dispatch transport failure reports unknown acceptance with the destination session id. The source never retries automatically: the user must inspect the destination before requesting another transfer. Plugin unload cancels source reviews and network calls and drains receiver admission. Receiver responses omit host exception details, and bearer credentials are never included in tool arguments, prompts, or receipts. Browser-origin requests are refused.

No invariant companion is published: this package delegates Session identity and prompt deduplication to the Session Controller; it owns no independently maintained Session projection to reconcile.

## Model Experience

### Request context and condition

#### What the model sees

The Daedal-only dynamic context states the current execution environment. In isolated sessions it directs host-maintenance requests to `handoff_to_host`, forbids guessed host paths, blocked localhost retries, and invented tools, and explains that permission changes cannot leave the container. Host sessions receive the corresponding host guidance. The exact text is owned by [tool.ts](src/tool.ts) and pinned in the [recorded-session scenario](../../../snapshots/session/daedal-host-handoff/snapshot.yml). The tool accepts a short `title` and a complete `task` containing committed work, completed checks, and remaining host steps. It returns `unavailable`, `declined`, `started`, or `unknown` with a message and, after dispatch, a destination session identity. No tool argument selects the destination, changes permissions, or supplies credentials.

#### Token effect

The Daedal session includes one tool schema and one environment-context paragraph. A transfer adds its task summary and receipt to the source log and starts a separate destination context with the approved summary.

#### KV Cache effect

The tool schema is stable within the selected Daedal preset. Execution guidance enters the logged runtime context; changing preset or provider identity can change the next model request. Human review does not invoke a model; an approved destination session uses its own configured model and context.

## Known Limitations and Deferred Work

- The destination must already run a separately configured host Web profile. This package does not launch services, enable host access, restart the harness, or change the current profile.
- A task summary and committed revision references are transferred; uncommitted files, background jobs, and a complete conversation are not copied. Complete and publish the required commits through the existing workspace workflow before handing off.
- The receipt identifies the destination origin and session. The user opens that host and selects its new session; browser navigation and cross-host sidebar integration are not automatic.
- The receiver token grants host-session creation authority. Keep it in the host control plane and restrict access to the receiver's network listener.

### Dev Note

The [host-maintenance decision](../../../.agents/notes/implemented/architecture/2026-09-21-host-maintenance-profiles.md) owns the separate-profile rule and confirmation rationale.
