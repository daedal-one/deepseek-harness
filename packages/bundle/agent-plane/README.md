---
description: "Apply a selected Agent preset consistently across headless, Web, and SDK surfaces."
kind: "package-bundle"
---

# @deepseek-ai/dsh-agent-plane

## Summary

Apply a selected Agent preset consistently across headless, Web, and SDK surfaces. This layer combines the shared base services with a preset roster and leaves each preset in charge of its prompts, tools, and guards. Runners must mount the selected preset when they create an Agent.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Shared profile layer for every preset-aware surface. It leaves process-wide services in `dsh-base`, disables the base model-facing Consumers, and mounts one `dsh-agent-presets` roster and the Host subagent-model-selection preference required by standard presets. Each runner resolves the selected preset before Session creation and mounts it inside the new Agent scope.

Place it after `@deepseek-ai/dsh-base` and before a surface bundle:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-agent-plane",
        "@deepseek-ai/dsh-headless"
      ]
    }
  }
}
```

The layer owns only composition. The disabled rows and preset-mounted packages own their own runtime invariants.

No invariant companion is published because the layer only composes plugins whose owners check their own state.

## Model Experience

### Preset composition

#### What the model sees

The prompt, tools, skills, delegation Consumers, and output guards registered by the selected `agentPreset`. This bundle adds no text or tool schema of its own.

#### Token effect

No direct tokens. The selected preset owns the complete model-visible contribution.

#### KV Cache effect

None directly. A preset change selects a different standing composition and therefore a different request prefix.

## Known Limitations and Deferred Work

- A custom surface must call the shared preset-composition helper during Agent creation. Bundle layering alone cannot attach a standing preset scope to an Agent.
- Preset mounts remain process-standing generations; edited compositions reach later Agents while already joined Agents retain their generation.

### Dev Note

None.
