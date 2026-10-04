---
description: "Run an interactive shell in a Session's live execution environment from the Terminal tab."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-terminal

## Summary

Open Terminal in a Session to inspect files, run commands and use interactive programs in that Session's execution environment. Keyboard input, paste, colors and viewport resizing reach a real PTY. Switching tabs preserves the shell while the browser connection remains live. Restart terminal replaces the shell; connection loss closes it. Commands directly affect the Session workspace.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

The shipped Web profile includes the Terminal tab beside Chat and Trajectory. The Session must have a working directory and a subprocess provider. The [Session Controller](../../api/session-controller/README.md#user-terminals) owns shell selection and process limits. Terminal input is a direct authenticated user action rather than a model tool invocation.

The Client configuration accepts `outputChars` (default 1,048,576 retained UTF-16 characters) and `scrollback` (default 5,000 xterm lines). Both are integers; `outputChars` is at least four and `scrollback` is nonnegative.

-----

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One connection-owned model per viewed Session retains the live Remote stream and bounded output across view remounts. The renderer binds its observable to a Slot hook. The component owns the xterm emulator and fit addon; input and resize callbacks reach the Host through the generated Session Remote API. Plugin disposal aborts its streams and awaits their completion. No runtime invariant companion is published because terminal transport and viewport presentation have no independently mutable cross-plugin registry relation.

</details>

-----

## Further Exploration

- [Session terminal ownership](../../../.agents/notes/implemented/feature/2026-10-04-session-terminal.md)
- [Subprocess terminal providers](../../subprocess/subprocess/README.md#running-a-terminal-session)

## Model Experience

None, as raw user terminal input and output stay outside model history.

#### KV Cache effect

None; this package does not assemble model requests.

## Known Limitations and Deferred Work

- Shells survive tab switches, not browser reloads or connection loss. Output retention is bounded: a remount after eviction replays only the retained tail and displays a notice; a full-screen program can require its own redraw. Session terminal operations can run concurrently with agent commands in the same workspace. A missing provider or executable surfaces an error without a Host fallback.

### Dev Note

None.
