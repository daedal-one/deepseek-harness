# Agent Note: Access-mode hover descriptions

Status: implemented

## Problem

The composer named each permission preset but did not explain the practical difference between modes. A host description reached only the closed control through a native browser title, while the open menu offered no explanation and built-in presets commonly had no description at all.

## Decision

The composer owns concise localized fallback descriptions for Read Only, Workspace Write, and Full access. A host-provided description remains authoritative for customized behavior. The closed control and each described menu row use the shared Tooltip primitive, so pointer hover and keyboard focus expose the same text while touch input keeps hover-only bubbles closed.

Menu items accept an optional `tooltip` string and attach it to the complete interactive row rather than only its label. This keeps the explanation available across the row's hover target and focus target without changing selection semantics.

## Consequences

Custom presets without host descriptions remain unexplained because the client cannot infer their sandbox or approval behavior. Deployments should provide descriptions for those presets. The generic Menu tooltip option is available to other compact menus whose labels need explanatory text.
