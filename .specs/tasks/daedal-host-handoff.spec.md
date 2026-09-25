---
id: TASK:sandbox/daedal-host-handoff
type: task
status: accepted
summary: Give Daedal agents explicit environment guidance and a human-confirmed host-session handoff.
owners: [carlo]
progress: done
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

## Acceptance

The implementation passes 37 focused tests with 100% package coverage, concurrent independent test processes, the keyless recorded-session replay, and a built Web composition that admits one destination session and deduplicates repeated delivery with a fixture model. The isolated handoff checkout builds with the matching macOS SDK.

The deployed host profile uses release `fa443353f8951c34fb75d06d3c463b1f64501e5f`; the main server retains release `77e317dd918ba58e7b82aa1d33ab41ddc2476245`. Main Web, host maintenance, and companion services are active, and host maintenance is enabled at boot. Dedicated-credential receiver discovery succeeds, unauthenticated and browser-origin receiver requests fail, and both Web listeners require authentication. No live model task was dispatched during this acceptance check; authenticated browser interaction remains outside its evidence.
