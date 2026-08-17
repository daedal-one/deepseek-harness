---
id: TASK:llm/configured-model-inheritance
type: task
status: accepted
summary: Preserve installed model metadata for dated and routed provider identifiers.
owners: [carlo]
progress: done
addresses:
  - REQ:llm/configured-model-inheritance#c-source
  - REQ:llm/configured-model-inheritance#c-complete
  - REQ:llm/configured-model-inheritance#c-invalid
  - REQ:llm/configured-model-inheritance#c-roundtrip
labels: [llm, configuration, reasoning]
assignee: carlo
---

# Configured model inheritance

## Acceptance

The pi-ai adapter accepts an explicit installed-catalog source on configured model entries, retains the source model's request metadata under the configured wire identifier, rejects invalid sources, documents the field, and proves source inheritance and editor preservation through focused tests.
