---
id: TASK:tasks/daedal-dsh-browser-mount
type: task
status: accepted
summary: "Serve the Daedal browser preview from its DSH Host."
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Serve the Daedal browser preview from its DSH Host

## Plan

Extend the existing frontend-static owner to serve a separately built application at a configured named URL prefix while retaining the current DSH UI at the root. Mounted applications own their client bootstrap; they do not receive the current Web shell's injected module graph. Every index entry uses the existing Connection browser authentication, including explicit pathname routes. Assets stay public. Reject traversal, malformed mount configuration and unsupported methods; missing assets and unlisted paths remain 404 rather than becoming HTML. Prefix registration and disposal must not take or release the root fallback seat.

Require canonical absolute mount paths and index aliases without query, fragment, encoded separators, dot segments or trailing slash. The application build owns matching asset and router base paths. The Daedal preview uses `/daedal` and `/dsh-hosts` as its explicit relative route; startup remains a normal `dsh --profile web` with a patch, sharing the same Session writer and authorities.

## Implementation references

- [Static frontend owner](spec:src:packages/host/frontend-static/src/index.ts)
- [Real Loader composition](spec:src:packages/host/frontend-static/tests/frontend-static.spec.ts)

## Verification

Real Loader HTTP tests cover authenticated mounted index entries, existing root UI, independent bootstrap, missing assets, path traversal, method refusal and disposal. Verify an actual exported Daedal browser against an isolated DSH profile through its native client flow. Neither generated intent nor a static export establishes browser acceptance.
