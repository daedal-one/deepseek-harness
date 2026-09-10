---
id: REQ:ui/english-only
type: requirement
status: accepted
level: MUST
summary: The fork ships English product copy and maintains English repository guidance.
owners: [carlo]
refines: []
categorized_under: []
---

# English product and repository language

:::{requirement id="english-only" level="MUST"}
- {#c-product} The fork MUST ship English as its only built-in UI locale. Feature dictionaries MUST have a single English owner, and shipped preset names and descriptions MUST be English.
- {#c-fallback} Unsupported browser languages and stored locale preferences MUST fall back to English. The public locale API MAY continue to accept language packs supplied by plugins.
- {#c-prose} Active repository documentation, comments, templates, and diagnostics MUST be English and MUST NOT instruct contributors to maintain a second language or translation pairing.
- {#c-exceptions} Vendored dependencies, frozen archived notes, and multilingual fixtures that verify parsing, rendering, or output-language enforcement MUST retain their functional or historical content. UI assertions MUST match the English product.
:::
