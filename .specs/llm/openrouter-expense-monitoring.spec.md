---
id: REQ:llm/openrouter-expense-monitoring
type: requirement
status: accepted
level: MUST
summary: Users see OpenRouter spend for the configured inference key and an estimated USD cost of the current session in the Web client.
owners: [carlo]
refines: []
categorized_under: []
---

# OpenRouter expense monitoring

## Context

The shipped Web client shows neither the OpenRouter spend a session has incurred nor the limit of the key that paid for it. The session's durable token usage is logged but never priced against the model's published rate, and the inference key's own spend and limit are not exposed anywhere in the client, so a user cannot tell what the session costs or whether the key is running low.

:::{requirement id="openrouter-expense-monitoring" level="MUST"}
- {#c-key-usage} The host MUST read the configured OpenRouter credential's key spend and limit from `GET /api/v1/key` and MUST NOT require a management key or call the account-credits endpoint.
- {#c-session-cost} The system MUST estimate a session's USD cost from its durable token usage and the routed model's OpenRouter price, and MUST report an explicitly unpriceable cost rather than a zero when a price is missing.
- {#c-secret} The credential MUST stay on the host: it MUST NOT reach the client, a session-log record, or a diagnostic.
- {#c-failure} An unconfigured, unauthorized, rate-limited, unreachable, or malformed read MUST surface a distinct stated failure state and MUST NOT render a fabricated zero.
- {#c-cache} Repeated reads MUST be served from a bounded cache with a deployment-configurable lifetime and MUST de-duplicate concurrent reads.
- {#c-ui} The web client MUST expose the readings as a session conversation view alongside the existing Chat and Trajectory views, with all copy locale-owned.
- {#c-evidence} Keyless package tests MUST cover parsing, pricing, caching, and the credential-missing path, and client tests MUST cover the loading, success, unpriceable, and failure states.
:::
