---
id: TASK:tasks/daedal-dsh-native-client
type: task
status: accepted
summary: "Expose the portable DSH client."
owners: [carlo]
progress: in-progress
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Expose the portable DSH client

## Plan

Inspect the Connection client face, generated remotes, gateway streams and pure session projections. Prove their use in the Daedal DSH React Native, browser and Electron clients. Extract or expose a supported portable face only where imports, transport assumptions or package exports prevent that use. Preserve the existing Web consumer and supported dsh launch rules. Native transport owners supply fresh cancellation controllers; composed cancellation releases its source listeners when an operation finishes, including success, failure, stream return and contribution withdrawal. Publish the existing generated Remote selection and Client registry through ordinary ESM, retaining Client declarations and shared registry/schema identity. The portable application facade exposes its shared Connection and Gateway building blocks with one declaration bundle so separately installed consumers do not duplicate nominal Client types or depend on Host development dependencies.

Reuse the existing Workspace model and follow controller in the portable assembly. Preserve Host-confirmed ordering, mutation echoes, archive state, race resolution, per-host isolation and stream disposal.

Reuse the existing Session service, manager, event windows, pending submissions, queues and projection stores. Portable callers supply request identities, a current client time zone and an already hydrated, host-specific selection store. Keep the browser composition on its existing preference key and browser identity source. Native Session state must not read browser persistence or crypto globals, require the browser upload service, or share navigation across hosts.

## Acceptance

A native iPhone build and browser/Electron consumers attach to an existing session, stream, prompt and resolve an interaction through native DSH semantics. Shared source and artifact checks reject Node/DOM imports on native paths. Focused lifecycle tests cover cancellation, disposal, disconnect after acceptance and reconnect; recorded-session output remains faithful.
