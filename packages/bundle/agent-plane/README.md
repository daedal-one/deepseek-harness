# @deepseek-ai/dsh-agent-plane

Shared profile layer for every preset-aware surface. It leaves process-wide services in `dsh-base`, disables the base model-facing Consumers, and mounts one `dsh-agent-presets` roster. Each runner resolves the selected preset before Session creation and mounts it inside the new Agent scope.

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
