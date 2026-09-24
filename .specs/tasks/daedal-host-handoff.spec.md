---
id: TASK:sandbox/daedal-host-handoff
type: task
status: accepted
summary: Give Daedal agents explicit environment guidance and a human-confirmed host-session handoff.
owners: [carlo]
progress: in_progress
addresses:
  - REQ:sandbox/host-maintenance#c-daedal-handoff
  - REQ:sandbox/host-maintenance#c-world
  - REQ:sandbox/host-maintenance#c-handoff
  - REQ:sandbox/host-maintenance#c-deployment
labels: [sandbox, daedal, interaction]
assignee: carlo
---

# Daedal host handoff

Mount the guidance and tool only in the Daedal and Daedal OpenAI presets. Derive environment identity from filesystem and subprocess providers. Use the existing human-question interaction to review the configured destination and full task summary, including committed work and pending deployment steps. A separately launched host Web profile owns the receiving session; its narrow authenticated receiver refuses container providers and fixes the destination working directory. The source never receives a host shell or changes its permissions. Preserve the selected Daedal preset and provide the destination session identity on success or uncertain acceptance.

Verify scope isolation, current preset selection, root ownership, explicit approval, rejection, cancellation, missing destination, wrong execution environment, authentication, bounded input, duplicate delivery, and real session admission through a Loader composition. Pin model-visible guidance and tool output in a keyless recorded-session scenario. Keep deployment activation separate from source validation.

Deploy on the existing server while preserving its current release changes and companion service. Resolve session-specific execution providers, configure a distinct host Web profile on loopback with a dedicated credential, qualify before activation, and verify authenticated source and destination readiness.
