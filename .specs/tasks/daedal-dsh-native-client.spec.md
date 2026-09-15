---
id: TASK:tasks/daedal-dsh-native-client
type: task
status: accepted
summary: "Expose the portable DSH client."
owners: [carlo]
progress: pending
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Expose the portable DSH client

## Plan

Inspect the Connection client face, generated remotes, gateway streams and pure session projections. Prove their use in the Daedal DSH React Native, browser and Electron clients. Extract or expose a supported portable face only where imports, transport assumptions or package exports prevent that use. Preserve the existing Web consumer and supported dsh launch rules.

## Acceptance

A native iPhone build and browser/Electron consumers attach to an existing session, stream, prompt and resolve an interaction through native DSH semantics. Shared source and artifact checks reject Node/DOM imports on native paths. Focused lifecycle tests cover cancellation, disposal, disconnect after acceptance and reconnect; recorded-session output remains faithful.
