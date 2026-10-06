---
id: REQ:llm/visible-completion
type: requirement
status: accepted
level: MUST
summary: A completed model response requires visible text or a tool call.
owners: [carlo]
---

# Visible model completion

:::{requirement id="visible-completion" level="MUST"}
- {#c-stop} The pi-ai and dedicated DeepSeek adapters MUST classify a terminal stop containing only reasoning, empty text or whitespace as `EMPTY_RESPONSE`, rather than successful completion. Nonblank text or a tool call MUST satisfy response presence.
- {#c-evidence} The adapters MUST preserve streamed content and reported usage before the error finish. The loop MUST retain failed attempts outside model history, and configured request retry policy MUST remain authoritative. Classification MUST NOT invent or execute a tool call.
- {#c-terminal} Context-overflow, token-limit, cancellation, provider-error and tool-call finishes MUST retain their existing classification independently of response presence.
:::
