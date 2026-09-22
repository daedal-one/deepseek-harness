---
description: "Authenticated static frontends at the Web root or named URL prefixes, with explicit index routes and traversal rejection."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-frontend-static

## Summary

Serve a built frontend from its configured distribution directory. The root Web shell owns unmatched routes; additional applications can occupy named URL prefixes. Only the mount root, configured index and declared index routes serve authenticated HTML. Assets remain public, missing paths return 404, traversal returns 403, and unsupported methods return 405. Mounted applications own their bootstrap; only the root Web shell receives Host index injections. Disposing one frontend releases its route without unloading another.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin in a browser-facing host that serves the built Web shell: it claims the webserver's fallback seat and answers every request no named route matches. Its required config value locates the built frontend's `index.html`.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-host-frontend-static'
  config:
    distIndex: /absolute/path/to/dist/index.html
```

For the root Web shell, [`dsh-web-app`](../../bundle/web-app/README.md) resolves `distIndex` through the frontend package's exports. A separately built application supplies its own absolute distribution path.

### Additional frontend

Set `mountPath` to a named prefix such as `/daedal`, and `indexPaths` to explicit routes relative to that prefix, such as `[/dsh-hosts]`. Both accept slash-separated ASCII letters, digits, hyphens and underscores; `/` is also valid. The default mount `/` retains the single-owner fallback behavior, and the default index route list is empty. Duplicate named prefixes fail through the webserver route registry.

The built application's router and absolute asset paths must match its mount. A `<base>` element anchors relative assets at the mount root. Named mounts serve their own HTML without the Web shell's index injections; they share the existing Connection authentication and API on the same origin. Sign in through the normal DSH root launch URL before opening a mounted page. Mounting files starts no additional Host or Session writer.

### What the server enforces

Requests are served from the dist root (the directory containing `distIndex`). The mount root, configured index path and declared index routes render `index.html` with HTTP 200; any other existing file is served directly with its MIME type, and unknown extensions ship as `application/octet-stream`. A path that resolves outside the root is rejected with 403, so a crafted path cannot read files above the dist. An absent or non-file target inside the dist root — a missing file, a directory, or a missing configured index — returns an empty 404. Non-GET/HEAD requests handled by this frontend receive 405. Root-fallback index responses run through the webserver's `renderIndex`; mounted applications supply their own bootstrap.

Every index entry calls `ctx.connection.authorizeIndex` before reading HTML. The normal root launch URL exchanges a valid process token for the persistent browser cookie and a 303 redirect; an existing valid cookie serves the index; every other index request receives the Connection-owned 401 response. Non-index files remain public static assets. Connection owns the token, cookie, expiry, and signing-record semantics.

### Observable failures

Traversal returns 403 rather than an error page. An absent or non-file target inside the dist root returns an empty 404, so a stale link or a mistyped pathname is an explicit failure rather than a silent SPA fallback. Claiming the fallback seat or the same named prefix twice throws. Disposing a frontend releases only its own registration; requests then reach the remaining route table.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The function plugin resolves the dist root, mount and explicit index routes before registering an effect-scoped handler. The root uses `registerFallback`; another mount uses `register` with a prefix route. The handler removes the mount prefix, maps declared index paths to the root, then delegates to `serveStatic`. Authentication still precedes every index read. Only the root rendering closure applies Host injections.

### The traversal fence

`serveStatic` normalizes the requested pathname and joins it to the dist root, then requires the target to be the root itself or stay under it. The check uses `sep` rather than `/` because `resolve()` emits backslash paths on Windows, where a `/` suffix would reject every legitimate subpath as traversal.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `serveStatic` and `apply`: route ownership, traversal rejection, authenticated index rendering, MIME table |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the serving contract is not enough: the seat owner's contract, then the composition that resolves the dist and the subsystem reference.

- [Webserver](../webserver/README.md) — the fallback seat this plugin claims and the index taps it runs.
- [dsh-web-app bundle](../../bundle/web-app/README.md) — the application that resolves `distIndex` and mounts this plugin.
- [HTTP server subsystem](../../../docs/subsystems/web-server.md) — how the fallback seat fits the route tables.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-host-frontend-static) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

None, as the SPA dist server answers browser asset requests and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when a served asset class is not yet covered. They are current package constraints, not a task backlog.

- **The starter MIME table is minimal** — it covers JavaScript, CSS, SVG/PNG/icons, web fonts, JSON, source maps, the PWA manifest and gzip data; other extensions fall back to `application/octet-stream` until an asset class ships.
- **Pathname routing is explicit** — only configured index paths receive SPA HTML. Applications must keep their router base and declared entry paths aligned; unknown routes and missing assets remain explicit failures.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Route ownership is enforced by the webserver registration APIs, which cannot be probed from the teardown stream — `internal/plugin` fires before the disposing fiber's effects run, so the legitimate owner still holds the seat at notification time and a claim probe would false-positive on every correct disposal (unlike the webserver companion, whose reserved-path probes never collide with a live registration). Fallback and prefix register/release symmetry is covered by the package's real-composition HMR-safety test instead.
