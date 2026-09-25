---
id: TASK:ui/conversation-profile-access
type: task
status: accepted
summary: Distinguish execution environment from access policy and bind initial permissions to conversation profiles.
owners: [carlo]
progress: done
addresses:
  - REQ:guard/tool-policy-permission-mode#c-plugin
  - REQ:guard/tool-policy-permission-mode#c-evidence
  - REQ:sandbox/isolated-execution-world#c-world
  - REQ:sandbox/isolated-execution-world#c-authority
---

# Conversation profile access

## Behavior

Conversation profiles carry a default access policy selected from the server's permission table. A new session resolves its profile default before accepting a creation-time override and records the effective permissions. Resumed and forked sessions retain their recorded permissions. Profile edits affect future sessions only.

The interface displays execution environment and access policy separately. A box identifies verified container execution; a computer identifies host execution. Host filesystem restrictions, policy review, and unrestricted access have distinct policy glyphs and text. Missing or mixed execution evidence must not appear as verified sandboxing. The environment indicator comes from the effective filesystem and subprocess providers, including preset-owned providers, rather than from permission names.

Access overrides are available until the first model turn; after that, the menu remains inspectable and changes require a new session. Changing access policy never changes execution placement or widens server capabilities. An existing conversation cannot move between host and container through its access menu. A transfer requires a separate destination session and must describe the state transferred.

## Validation

Cover profile defaults, explicit overrides, blank-profile changes, resumed and forked permissions, invalid policy references, host/container provider identity, and missing or mixed evidence. Verify labels and icons at desktop and mobile widths, real Loader behavior, session replay, and the affected documentation. Verify that the Python runtime dependency manifest includes the required peers of the permission service.

## Evidence

The publishing branch passes 330 focused profile, permission, Loader, and selector tests; six Chromium tests cover the desktop and phone UI. Selected headless and TypeScript SDK session replays pass, and the Python SDK regression preserves its owned run interval around access setup. Desktop and phone screenshots verify the Web menu.

The full build passes with the installed macOS 26.5 SDK. All 32 documentation checks and specification lint pass. The SDK replay passes in isolation after an initialization timeout while the build and documentation checks were running concurrently. Exhaustive repository coverage remains a CI responsibility.
