# Agent Note: Package metadata in the plugin inventory

Status: implemented

## Problem

The read-only Plugin list identified entries by a shortened Loader module name, enablement, and root Fiber phase. Those facts explain whether an entry runs, but not what the package does, who authored it, or which release is installed. Module subpaths, local files, and `cordis:` built-ins also make browser-side package lookup incomplete and deployment-dependent.

## Decision

`dsh-host-plugin-inventory` resolves display metadata beside the Loader-state projection. Bare module subpaths use their owning package manifest, file-like specifiers use the nearest package manifest from the owning entry tree's base URL, and `cordis:` names try the corresponding `@deepseek-ai/cordis-plugin-*` package. The Remote entry carries `author`, `description`, and `version` as nullable strings. A missing field, an unreadable manifest, or an unresolved package yields `null`; the resolver does not infer authorship from package scope or repository URL and does not contact a registry.

Installed-package metadata is cached for the Gateway lifetime because installation changes take effect on restart. Enablement and Fiber phase are never cached: every `pluginInventory/list` call reads the current Loader entries and their current fibers directly.

The Plugin list renders description, author, and version on every collapsed card. Localized unavailable copy occupies a missing field, so every row keeps the same information structure. Search includes the available metadata beside module specifier and Loader entry id. Disclosure reveals the exact Loader entry id and configuration details.

Preset rows use the same metadata resolver and card renderer. Their composition inventory carries the actual import base: the installed harness for bare names and the owning composition for relative files. The Host consumes this URL without sending it to the browser. Using the preset directory for bare package names would miss the harness dependencies; using the harness for relative files would misidentify preset-owned plugins. Reading an unmounted preset remains a file read and activates no plugins.

A literal composition-row `description` supplies the instance's `purpose`, preferred over the package summary. This lets a reviewer explain its task while other instances of the same delegation package retain their own roles. Blank or non-string metadata is omitted without evaluation. The inventory does not infer descriptions from entry ids, inspect persona prompts, or project plugin configuration. Package description, author, and version remain separate declared facts and all available display metadata participates in search.

## Alternatives considered

**Query a package registry from the Host.** Rejected because private and local packages may have no registry record, inventory would become network-dependent, and a read-only local deployment view would disclose installed package names to an external service.

**Infer author from a package scope or repository owner.** Rejected because publisher namespaces and repository organizations do not prove authorship. Explicit unavailable copy is less polished but preserves the package's declared facts.

**Resolve package metadata in the browser.** Rejected because the browser module graph carries client bundles, not authoritative Host installation paths or manifests. It would also split one inventory row between Loader-owned and browser-derived sources.

## Consequences

The inventory Remote payload is larger by three nullable strings per entry, and the first read performs local manifest lookup. Later reads reuse immutable installed-package metadata while retaining live Loader state. Package authors control the package summary through standard manifest fields; preset authors can supply an instance purpose through literal row metadata. The Harness displays authored text or explicit unavailable copy without generating a description.
