# @deepseek-ai/dsh-host-plugin-inventory

Read-only Host projection of the current Cordis Loader tree. `PluginInventoryGateway` registers the `pluginInventory` service and publishes one generated direct Remote, `pluginInventory/list`. Every call reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order with their Loader entry id, module specifier, effective enablement, current root Fiber phase, and package-manifest author, description, and version. Bare package subpaths resolve to their owning package, file-like specifiers use the nearest package manifest, and `cordis:` built-ins resolve through the corresponding `@deepseek-ai/cordis-plugin-*` package when installed. Missing, malformed, or unavailable metadata fields are `null`; display metadata never blocks the Loader-state projection.

The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. The snapshot is intentionally point-in-time: Loader remains the sole lifecycle authority, while this package owns no lifecycle cache, history, provenance model, event stream, or mutation path. Installed-package display metadata is cached for the Gateway lifetime because package installation changes take effect on process restart. Public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only inventory projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **Manifest metadata only** — a package without a readable author, description, or version reports that field as `null`; the inventory does not query a registry or infer authorship from a package scope or repository URL.
- **No provenance or mutation** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot enable, disable, add, or remove plugins.
