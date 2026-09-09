---
description: "Keep the Harness workspace roster aligned with Forge-owned projects."
kind: "package-reference"
---

# `@deepseek-ai/dsh-forge-project-workspaces`

## Summary

Keep the Harness workspace roster aligned with Forge-owned projects. The reconciler uses configured project metadata to add or update the corresponding workspace roots. Forge remains responsible for allocating and authorizing those roots.

## Table of Contents

- [Use this package](#use-this-package)
- [Runtime contract](#runtime-contract)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

This Web-host plugin accepts the Forge Hub's authenticated project catalog and reconciles it into the Harness Workspace registry. Forge remains authoritative for project identity and repository ownership; the Harness stores only the derived directory registrations and sessions.

## Runtime contract

`PUT /forge/v1/projects/sync` replaces the complete managed catalog. Every row must carry `project_id: PROJECT:<slug>`, the same validated slug, a display title, and an optional `owner/repository` Forgejo name. The route creates or reuses `/workspaces/forge/<slug>`, clones a named repository only when that directory has no Git checkout, registers the path, restores Forge order and title, and unregisters managed rows absent from the replacement. Unregistration never deletes the directory or Session logs.

The bearer token protects the replacement route. Repository credentials enter `git clone` only through the child environment, never the URL or response. Concurrent replacements serialize; a partial materialization failure returns an error and a later identical request reconciles the remaining state idempotently.

The Forge deployment supplies this package through its released DeepSeek Harness image and mounts it beside the Web profile. The Hub selects a reconciled project with the client runtime's exact `?workspace=` deep link. The Workspace browser remains mounted for managed Session history, while directory adoption is disabled and public create, rename, delete, and reorder RPCs are rejected. This authenticated replacement remains the only project-roster writer exposed to operators.

## Model Experience

None, as the host-side catalog reconciler and browser selection input register no prompt, tool, message, or session event.

#### KV Cache effect

None. The package never changes the model request prefix.

## Known Limitations and Deferred Work

- **The Web process executes in the mounted workspace world** — this plugin does not provide filesystem, process, network, credential, lifetime, or cleanup isolation. Forge's executor provider owns that later security boundary.
- **Existing repositories are not refreshed** — reconciliation preserves local edits and branches by leaving an existing `.git` directory untouched.
- **Removed directories are retained** — replacement removes only the Harness registration so an accidental catalog omission cannot delete source or Session data.

### Dev Note

None.
