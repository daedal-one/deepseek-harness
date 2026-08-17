# Agent Note: Make browser branding user-controlled

Status: implemented

English | [中文](2026-08-16-user-controlled-browser-branding.zh.md)

## Problem

The assembled Web application fixed the DeepSeek fish wordmark and product name into several independent surfaces. A downstream deployment could not identify the browser application as its own product, and changing one rendering site could leave the sidebar, blank-conversation hero, document title, favicon, loading interval, and install metadata disagreeing. The fixed DeepSeek name also described one vendor rather than the generic agent harness this repository provides.

## Decision

The new `@deepseek-ai/dsh-client-ui-branding` capability owns browser product identity. Its built-in name is `the harness`, in lowercase, and its built-in logo is the existing fish mark. The Host registers a `ui-branding` settings namespace with a required `name` field and optional `logo` field, and the API proxy explicitly exposes that namespace to loopback configuration clients. Names are trimmed, non-empty, and limited to 48 characters. Logos are base64 data URLs for PNG, JPEG, WebP, GIF, or AVIF files no larger than 512 KiB before encoding.

The browser plugin provides one observable `BrandingRuntime` backed by the shared settings-scope lifecycle. The General settings row writes through that service and shows a live preview. Sidebar, blank-conversation hero, document title, loading title, and favicon consume the same runtime rather than accepting copied branding props or reading the settings document themselves. Resetting a field unsets its stored override, so the default remains defined by the schema and service rather than duplicated in user configuration.

The Host half transforms each index response before it reaches the browser, replacing the initial title and favicon with current settings. It also owns exact, non-cacheable `/manifest.webmanifest` and `/branding/logo` routes. The manifest derives its application name and icon from the same settings. The logo route decodes the stored raster image or redirects to the built-in favicon. These Host projections cover the interval before client plugins activate and browser consumers that do not run the React application.

## Alternatives considered

**Keep DeepSeek as the default and only allow a custom label.** The repository is a general harness, while the model provider remains separately configurable. Keeping the vendor name as product identity would preserve the mismatch the feature is intended to remove.

**Expose deployment-time Cordis configuration only.** That would let a bundle author rebrand a distribution but would not make identity user-controlled. It would also create a second authority beside persisted settings once an editor was added.

**Store an external logo URL.** Browser rendering would disclose use of the harness to the remote image host, require network availability, and make a durable setting depend on mutable external content. Storing the bounded bytes makes rendering local and repeatable.

**Accept SVG uploads.** SVG can reference external resources and carries a larger active-content surface than the raster formats needed for a product mark. A raster allowlist keeps the stored value inert across settings, HTML, favicon, and HTTP response paths.

**Update only the React wordmark.** The loading document, browser tab, installed-application metadata, and blank-session state would retain stale identity. One settings owner with both Host and browser projections keeps those consumers aligned.

## Consequences

The browser application now identifies itself as `the harness` without user configuration. A loopback user can change its name and logo once and see the choice persist through `$DSH_HOME/settings.yaml`, reloads, and port changes. Remote browsers retain process-local behavior because the privileged settings API remains loopback-only.

Every visible and browser-metadata consumer reads one feature-owned source, while ui-primitives owns only the pure `BrandLogo` renderer and built-in fallback mark. The default favicon remains a static asset for development and fallback routing; it is not a second live branding authority.

A maximum-size logo expands to about 683 KiB in the YAML settings value and settings API payload. The 512 KiB source limit bounds that cost without introducing an asset store, lifecycle, or garbage collection policy. Animated GIF content remains animated where a browser accepts it; the feature does not transcode uploads.
