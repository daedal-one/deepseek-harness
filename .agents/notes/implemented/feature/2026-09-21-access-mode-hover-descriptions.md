# Agent Note: Access-mode hover descriptions

Status: implemented

## Problem

Permission preset names alone do not explain their practical difference. Deployments can customize a preset's behavior, so client copy cannot safely override a host-provided explanation.

## Decision

The composer owns concise localized fallback descriptions for Read Only, Workspace Write, and Full access. A host-provided description remains authoritative for customized behavior. The Full access fallback limits policy reach to the displayed environment and does not promise container escape or host access.

The closed control and each described menu row use the shared Tooltip primitive, so pointer hover and keyboard focus expose the same text while touch input keeps hover-only bubbles closed. Menu items accept an optional `tooltip` string and attach it to the complete top-level or submenu button without changing selection semantics.

## Alternatives considered

**Native browser titles:** rejected because they do not provide the same keyboard-focus behavior as the shared Tooltip primitive and cannot explain open menu rows.

**Client descriptions for custom presets:** rejected because the client cannot infer deployment-specific sandbox or approval behavior.

## Consequences

Custom presets without host descriptions remain unexplained. Deployments provide descriptions for those presets, and other compact menus can use the generic Menu tooltip option.
