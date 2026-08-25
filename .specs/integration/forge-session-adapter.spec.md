---
id: IFC:integration/forge-session-adapter
type: interface
status: accepted
summary: A DeepSeek Harness HTTP adapter translates Forge session commands into durable agent operations and normalized evidence.
owners: [carlo]
provided_by: [deepseek-harness-forge-adapter]
consumed_by: [forge-agent-runtime]
stability: experimental
related: [REQ:integration/forge-runtime]
---

# Forge session adapter

:::{interface id="forge-session-adapter" level="MUST"}
- {#c-health} The adapter MUST expose authenticated health and capability
  discovery that name its implementation version, supported Forge protocol,
  commands, checkpoint support, approval semantics, evidence protocol, and
  limitations. Every route MUST authenticate the deployment-owned adapter token
  through `X-Forge-Adapter-Token`; generic `Authorization` credentials MUST NOT
  authenticate the adapter.
- {#c-command} `POST /v1/sessions/{id}/commands` MUST accept one idempotent
  normalized command and return only events after the caller's acknowledged
  sequence plus the current normalized state and optional terminal outcome.
- {#c-sequence} Events MUST have contiguous, monotonic per-session sequence
  numbers; retrying an idempotency key MUST return the recorded response without
  executing the command again.
- {#c-encapsulation} Native session events MAY be retained as attributed
  artifacts but MUST be translated into the Forge event vocabulary on the HTTP
  interface.
- {#c-recovery} A restarted adapter MUST resume the persisted session and Forge
  Intellect workspace state or return an explicit unsupported or evidence
  incomplete outcome; it MUST NOT create a second logical session silently.
:::
