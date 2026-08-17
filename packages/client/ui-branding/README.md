# @deepseek-ai/dsh-client-ui-branding

English | [中文](README.zh.md)

Browser branding plugin: it owns the user-controlled product name and logo shown by the application shell, blank-conversation hero, browser title, favicon, and Web App Manifest. The built-in identity is the lowercase name `the harness` with the fish mark as its logo fallback. The live `BrandingRuntime` is the one source read by every assembled React surface; the Host half also projects the same settings into the initial index response and exact metadata routes, so the loading interval and installed application do not revert to a different brand.

The Host registers the `ui-branding` settings namespace. `name` is a trimmed, non-empty string of at most 48 characters. `logo` is optional and stores a base64 data URL for PNG, JPEG, WebP, GIF, or AVIF content whose original file is at most 512 KiB. Loopback browsers edit the namespace through the privileged settings API, whose local provider stores it in `$DSH_HOME/settings.yaml`; the live service updates optimistically, converges on settings invalidations and reconnects, and restores the durable value after a rejected latest write. A remote browser cannot access that API, so its changes remain process-local. The persistence lifecycle follows the [Host-backed Web preferences decision](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md).

The General settings row edits the name, uploads or resets the logo, and shows the current mark. Uploaded logos appear immediately in the sidebar, blank-session hero, browser tab, and document-title suffix; resetting either field returns that field to the built-in value. External logo URLs are not accepted, so rendering never discloses the page visit to an image host or depends on that host remaining available. SVG is excluded because the settings value crosses storage, HTML, and browser rendering paths; the bounded raster allowlist keeps that value inert and gives the Host route an unambiguous media type.

The Host index transform replaces the initial `<title>` and favicon link with current settings. `/manifest.webmanifest` returns matching `name`, `short_name`, and icon metadata, while `/branding/logo` serves the decoded upload or redirects to `/favicon.svg` when no override exists. Both exact routes use `Cache-Control: no-store`, so a settings change cannot leave stale product identity in an intermediary cache. The [user-controlled browser branding decision](../../../.agents/notes/implemented/feature/2026-08-16-user-controlled-browser-branding.md) owns the full identity surface and format limits.

## Model Experience

None, as branding changes browser presentation and install metadata; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Uploaded logos enlarge the settings document** — a maximum-size file occupies about 683 KiB after base64 encoding and travels through the namespace settings API; the limit bounds that cost but does not provide a separate asset store.
- **Only raster uploads are accepted** — SVG, external URLs, and animated-format transcoding are not supported. GIF remains animated where the browser surface supports it.
- **Remote-browser edits are not durable** — the privileged settings API remains loopback-only by design, so remote branding changes last only for that browser process.
