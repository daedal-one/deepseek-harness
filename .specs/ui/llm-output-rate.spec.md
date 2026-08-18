---
id: REQ:ui/llm-output-rate
type: requirement
status: accepted
level: MUST
summary: Web token-rate figures use request wall time so buffered streams cannot report transport-drain speed as model throughput.
owners: [carlo]
refines: []
categorized_under: []
---

# LLM output rate

## Context

Some providers or transports deliver generated chunks in a short burst after
the model has already spent seconds producing them. A token rate derived from
the first and last local chunk timestamps measures buffer drain speed and can
report physically implausible model throughput.

:::{requirement id="llm-output-rate" level="MUST"}
- {#c-measurement} Every Web `tok/s` figure MUST divide provider-reported output
  tokens by the full `step/start` to `assistant/message` wall time over exactly
  the steps carrying both values, and MUST NOT use the local chunk-arrival span
  as its denominator.
- {#c-scope} The stats strip MUST aggregate the same measurement over the whole
  durable session, while a settled turn footer MUST aggregate it over that
  complete loaded turn.
- {#c-degradation} A figure without a positive measured duration or a valid
  non-negative output-token count MUST be omitted rather than guessed, capped,
  or rendered as zero throughput.
:::
