# Agent Note: Authenticated frontend mounts

Status: implemented

## Problem

The Daedal browser client needs the DSH Host's existing browser authentication and API while the current Web interface remains usable. Replacing the root distribution would make unfinished migration work the only interface. Serving it from another origin would introduce cross-origin authentication and another credential owner.

## Decision

[Frontend-static](../../../../packages/host/frontend-static/README.md) supports named prefix mounts alongside the root fallback. Each mount owns its built assets and explicit index routes. Every index entry delegates authorization to Connection; public static assets retain their existing behavior. The normal root launch URL remains the browser sign-in entry.

Mounted applications supply their own bootstrap and do not receive the root Web shell's module graph or index taps. Only the fallback application runs Host index rendering. Configuration constrains mount and index paths to unambiguous ASCII path segments, while filesystem traversal checks remain in the shared serving function. Unknown paths return 404.

This preserves the independent [profile/fallback ownership](2026-08-05-profile-plugin-bundles.md) and [browser authentication](2026-08-24-browser-token-authentication.md) decisions. Both notes remain active; neither is superseded.

## Alternatives considered

**Replace the current Web distribution.** The accepted migration retains the current UI until the new frontend is qualified.

**Add a cross-origin authentication proxy.** It adds credential forwarding and origin policy that the same-origin consumer does not need.

**Return the index for every missing path.** It turns missing assets and misspelled routes into successful HTML responses, hiding deployment failures.

## Consequences

A named mount shares the Host and Session writer with the current UI. Its builder must emit matching router and asset base paths and its configuration must list supported pathname entries. It does not dynamically inherit the current Web plugin UI.

The real Loader HTTP test proves authenticated aliases, independent bootstrap, root coexistence, traversal and method refusal, missing-path failures, and independent route disposal. Full application behavior remains the consuming frontend's acceptance responsibility.
