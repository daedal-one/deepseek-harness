# Agent Note: Session user terminals

Status: implemented

## Problem

Inspecting an agent's workspace through a separate Host terminal can target a different filesystem and process environment from an isolated Session. Users also need raw interactive programs rather than the line-oriented model terminal tool.

## Decision

The authenticated Session Controller starts user PTYs through the selected Agent's composed subprocess provider under initiating-Agent attribution. Executable resolution, working-directory translation and allocation all occur with that attribution, so conversation workspaces select their own runtime. There is no direct Host spawn fallback. Keyboard input and viewport resizing address both the Session id and an opaque browser terminal id. Raw output uses a cancellable Remote stream, and its lifetime owns awaited process cleanup.

The Terminal view has its own shell and never attaches to a model-owned terminal. Client models retain the stream across tab switches; the xterm component reconstructs its display from bounded raw output. Connection loss closes the terminal without automatic shell replay. Configured limits bound live terminals, input requests, cleanup grace, retained browser output and scrollback. Direct user commands are authenticated operations and are not model tool calls; terminal output does not enter model history.

This decision extends browser interaction and terminal resizing. Existing provider decisions continue to own execution isolation, process-range cleanup and model terminal readiness; none is fully superseded.

## Alternatives considered

A server-side Host shell ignores isolated Session ownership. Reusing the model terminal backend changes prompt markers and strips terminal sequences required by full-screen applications. Closing the shell on every tab change loses interactive state. Persisting a disconnected shell would need a separate process owner, reconnect authorization and retained-output protocol.

## Consequences

Users can inspect the same environment as their Session and run interactive programs without changing model history. User commands and agent operations can concurrently mutate the same files. Shell state ends with connection loss or explicit restart. Bounded tail replay can require a full-screen application redraw after eviction. Focused tests exercise ownership, allocation cancellation, input limits, resize forwarding and awaited teardown; browser qualification remains the evidence for rendered interaction.
