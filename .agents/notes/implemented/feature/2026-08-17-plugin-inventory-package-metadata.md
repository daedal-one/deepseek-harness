# Agent Note: Package metadata in the plugin inventory

Status: implemented

English | [中文](2026-08-17-plugin-inventory-package-metadata.zh.md)

## Problem

The read-only Plugin list identified entries by a shortened Loader module name, enablement, and root Fiber phase. Those facts explain whether an entry runs, but not what the package does, who authored it, or which release is installed. Module subpaths, local files, and `cordis:` built-ins also make browser-side package lookup incomplete and deployment-dependent.

## Decision

`dsh-host-plugin-inventory` resolves display metadata beside the Loader-state projection. Bare module subpaths use their owning package manifest, file-like specifiers use the nearest package manifest from the owning entry tree's base URL, and `cordis:` names try the corresponding `@deepseek-ai/cordis-plugin-*` package. The Remote entry carries `author`, `description`, and `version` as nullable strings. A missing field, an unreadable manifest, or an unresolved package yields `null`; the resolver does not infer authorship from package scope or repository URL and does not contact a registry.

Installed-package metadata is cached for the Gateway lifetime because installation changes take effect on restart. Enablement and Fiber phase are never cached: every `pluginInventory/list` call reads the current Loader entries and their current fibers directly.

The Plugin list renders description, author, and version on every collapsed card. Localized unavailable copy occupies a missing field, so every row keeps the same information structure. Search includes the available metadata beside module specifier and Loader entry id. Enabled runtime phase is a bordered text label rather than a color-only dot; disclosure still reveals the exact Loader entry id and configuration details.

## Alternatives considered

**Query a package registry from the Host.** Rejected because private and local packages may have no registry record, inventory would become network-dependent, and a read-only local deployment view would disclose installed package names to an external service.

**Infer author from a package scope or repository owner.** Rejected because publisher namespaces and repository organizations do not prove authorship. Explicit unavailable copy is less polished but preserves the package's declared facts.

**Resolve package metadata in the browser.** Rejected because the browser module graph carries client bundles, not authoritative Host installation paths or manifests. It would also split one inventory row between Loader-owned and browser-derived sources.

## Consequences

The inventory Remote payload is larger by three nullable strings per entry, and the first read performs local manifest lookup. Later reads reuse immutable installed-package metadata while retaining live Loader state. Package authors control the displayed prose through standard manifest fields; a technical or absent description remains visible as authored or explicitly unavailable rather than being rewritten by the Harness.
