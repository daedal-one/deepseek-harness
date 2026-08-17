---
id: REQ:llm/configured-model-inheritance
type: requirement
status: accepted
level: MUST
summary: Configured model aliases retain the installed catalog metadata required for exact request behavior.
owners: [carlo]
refines: []
categorized_under: []
---

# Configured model inheritance

## Context

Provider routing suffixes and dated model identifiers can name the same model behavior as an installed catalog entry while requiring a different identifier on the request wire. Treating such entries as unrelated hand-declared models silently drops reasoning and compatibility metadata.

:::{requirement id="configured-model-inheritance" level="MUST"}
- {#c-source} A configured model entry MUST be able to name an installed model on the same provider route as its metadata source without changing the configured model identifier sent to the provider.
- {#c-complete} Inheritance MUST retain the complete installed model metadata, including reasoning effort mappings and compatibility behavior, before configured fields override it.
- {#c-invalid} An empty or unknown metadata source MUST fail configuration with a diagnostic naming the provider, configured model, and invalid source.
- {#c-roundtrip} Configuration editing MUST preserve a model's metadata source when editing other supported model fields.
:::
