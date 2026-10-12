---
id: TASK:process/opt-in-policy-bundle
type: task
status: accepted
summary: Give the tool-policy family a mountable opt-in owner and make the generated config catalog state where every package is mounted by default.
owners: [carlo]
progress: done
addresses: []
labels: [process, guard, bundles, catalog]
assignee: carlo
---

# Opt-in policy bundle

## Acceptance

The `@deepseek-ai/dsh-policy` bundle owns the tool-policy stack as a declared profile patch layer: it mounts the decision service and declares the enforcement and provider rows disabled, because each one needs deployment-owned auxiliary review routes or exact reviewed tool rules. The generated config catalog states, for every catalogued package, where a shipped profile or bundle reaches it by default, reports the tool-policy rows as opted in through that bundle, and reports model routing as reached by no shipped profile or bundle. No shipped profile changes behavior, and the model-routing README states that no shipped bundle mounts it and no production consumer is wired.
