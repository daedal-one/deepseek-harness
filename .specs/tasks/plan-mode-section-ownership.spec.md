---
id: TASK:process/plan-mode-section-ownership
type: task
status: accepted
summary: Move the plan-mode section prose and the tool-result-pruner thresholds into their plugin schema defaults and delete the duplicated literals.
owners: [carlo]
progress: done
addresses: []
labels: [process, plan, presets, defaults]
---

# Plan-mode section ownership

## Acceptance

The plan-mode policy text has one home: the `section` schema default in `@deepseek-ai/dsh-plan-mode`, which the base bundle patch row and the shipped `standard` preset row no longer restate. Omitting `config.section` renders that text byte-identically to the base patch's former literal, pinned by a fixture test.

The tool-result-pruner budgets have one home: the plugin's `DEFAULTS` and schema defaults, with the base bundle patch row no longer restating `8192`/`4096`/`1024`.

The shipped preset set is documented as `standard`, `minimal`, `ptc`, and `cordis`; the stale `code` preset reference is gone, and persona strings stay per-preset deployment-owned text.
