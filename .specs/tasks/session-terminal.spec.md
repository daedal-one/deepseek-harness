---
id: TASK:frontend/session-terminal
type: task
status: accepted
summary: Provide an interactive terminal tab in each session's live execution environment.
owners: [carlo]
progress: done
addresses: ["REQ:frontend/daedal-dsh#c-native-client"]
labels: [terminal, ui, sandbox]
assignee: carlo
---

# Session terminal

## Acceptance

Each ordinary session offers a Terminal view with a real interactive PTY, raw output, keyboard input and viewport resizing. The shell starts in the selected session's working directory through its composed subprocess provider, including isolated conversation workspaces; it never falls back to a host subprocess. Switching views preserves the shell while the browser connection remains live. Explicit restart, connection loss and plugin disposal terminate owned processes and await quiescence. Input and retained browser output are bounded. Terminal commands are direct authenticated user operations, separate from model tools, and terminal output does not enter model history. Focused lifecycle tests and a keyless real-profile browser scenario over recorded Session history verify the feature.

## Qualification

The focused terminal owners, emulator presentation, plugin unload, provider resizing and CSS resolver tests pass 127 cases. The new Host owner and Client package reach 100% statement, branch, function and line coverage. The real Web-profile browser scenario verifies workspace file creation, tab-switch shell state, viewport resizing, explicit restart, localized controls and composer clearance without model calls. Host and Client builds, package hygiene and all 32 documentation gates pass. The adjacent seeded-history replay has four failures on unchanged file-result controls and theme geometry; those expectations remain unchanged.

## Sources

- [Host terminal owner](spec:src:packages/api/session-controller/src/terminal.ts)
- [Browser terminal plugin](spec:src:packages/client/ui-terminal/src/client/index.ts)
- [Connection lifetime tests](spec:src:packages/client/ui-terminal/tests/model.client.spec.ts)
- [Host lifetime tests](spec:src:packages/api/session-controller/tests/terminal.spec.ts)
- [Web profile scenario](spec:src:apps/web/tests/session-terminal.e2e.ts)
