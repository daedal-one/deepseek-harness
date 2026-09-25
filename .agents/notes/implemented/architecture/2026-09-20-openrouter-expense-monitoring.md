# Agent Note: Host-owned OpenRouter spend readings in a session conversation view

Status: implemented

## Problem

The shipped Web client cannot tell the user how much the current session has spent against the configured OpenRouter key, or how much headroom that key has left. The session's durable token usage is logged and the routed model's published price exists, but nothing prices that usage, and the key's own spend and limit are not exposed to any view. The user must infer cost from token counts, and an exhausted or misconfigured key stays invisible until requests start failing.

## Decision

The [OpenRouter expense monitoring intent](../../../../.specs/llm/openrouter-expense-monitoring.spec.md), carried by the [accepted implementation task](../../../../.specs/tasks/openrouter-expense-monitoring.spec.md), ships through two new packages. The host package `@deepseek-ai/dsh-openrouter-spend` at `packages/llm/openrouter-spend` publishes one Typert Remote method, `openrouterSpend.read({ sessionId })`, and returns the inference key's spend and limit together with the session's estimated USD cost. The client package `@deepseek-ai/dsh-client-ui-openrouter-spend` at `packages/client/ui-openrouter-spend` contributes a `conversation.view` entry with id `spend`, label "Spend", and `order: 20`, so it appears alongside the existing `chat` (order 0) and `trajectory` (order 10) tabs in every session, with all copy locale-owned.

**The existing inference credential reads `GET /api/v1/key`.** The host builds the key request with `OPENROUTER_API_KEY`, the same credential the [OpenRouter route](2026-08-17-openrouter-agent-model-settings.md) already uses for conversation-model requests, so the deployment stores no second secret. That endpoint reports the routing key's own spend and limit, which is what the user needs. The account-credits endpoint `GET /api/v1/credits` reports account balance rather than the routing key's limit, so the host never calls it, and no management key enters the flow. The routed model's price comes from OpenRouter's public `GET /api/v1/models` price table, which needs no credential.

**The session estimate is priced on the host, not in the browser.** `openrouterSpend.read` prices each settled durable usage against that request's actual durable provider/model attribution, then sums OpenRouter routes from the public price table. A pending model selection never reprices history; a missing route, a non-OpenRouter route, or an unavailable price makes the whole historical estimate explicitly unpriceable. The client renders the returned number and holds no second billing truth.

**An unpriceable cost is `null`, never `0`.** OpenRouter returns `-1` as a pass-through price marker, and a blank or absent price likewise states no known price, so a model with no stated price is not a free model. When a routed model's price is unavailable, the reading reports an explicitly unpriceable cost, `null`, because a numeric zero would assert that the session cost nothing, a fact the catalog does not state.

**The tab is a contribution owned by its plugin.** The Spend tab registers through the contributing client plugin's `conversation.view` slot effect rather than through a change to `ui-conversation`, following the [conversation view model](../../../../docs/subsystems/conversation.md). Registration is an effect owned by the contributing plugin, so the tab loads and unloads with the plugin instead of making the shared conversation shell own a feature tab.

**Readings are cached and de-duplicated.** A successful key result records its actual fetch time in a bounded cache with a deployment-configurable lifetime, and concurrent reads de-duplicate into a single upstream request. The key cache is invalidated by an in-memory non-secret credential fingerprint on credential change; failed reads do not occupy it. The credential is consumed only to build the `GET /api/v1/key` request: it is not returned to the client, not written to a session-log record, and not present in any diagnostic, log line, or error detail.

## Non-goals

- No management key. The flow uses only the inference credential the deployment already stores for the OpenRouter route.
- No account-credits call. `GET /api/v1/credits` reports account balance, not the routing key's own limit, so it stays out of the reading.
- No background polling interval in this version. The view reads on demand and through its bounded cache; a timer-driven refresh is not part of this change.
- No persistence of the reading. The spend and cost readings are computed for display and are not written to a session-log record or any other durable store.

## Testing

The host package's keyless tests cover parsing, blank prices, route-attributed multi-model pricing, retries, non-OpenRouter usage, cache credential changes and failure recovery, and the credential-missing path. The client package's tests cover loading, success, unpriceable, failure, configured and remaining limits, and unlimited limits; a Loader-backed Web-profile slice covers the Host service, Remote mount, client contribution, and missing credential path.

## Alternatives considered

**A management key plus the account-credits endpoint.** Rejected because a management key is a second secret the deployment would have to store and configure, and `GET /api/v1/credits` reports account balance rather than the routing key's own spend and limit. The existing inference credential's `GET /api/v1/key` already reports exactly the key's spend and limit.

**Wiring the Spend tab into `ui-conversation`.** Rejected because the conversation shell is shared by every view; a feature tab registered there would outlive the plugin that supplies its data, and loading or unloading the plugin would not remove the tab. Slot entry registration is an effect owned by the contributing plugin, which keeps the tab's lifetime correct without coupling the shell to a feature.

**Computing the session cost in the browser.** Rejected because durable request headers, assistant-message sources, and settled usage are host session-log authorities; the browser cannot see every route-attributed input, and pricing there would give the client a second billing truth that can drift from the host's reading.

**Reporting `0` when a price is missing.** Rejected because OpenRouter's `-1` pass-through marker and an absent price entry both mean no stated price, and a numeric zero would assert that the session cost nothing, a fact the catalog does not state. An explicit `null` keeps the unpriceable case distinct from a known-zero cost.

## Consequences

The user sees key spend, configured and remaining limits, and the session's estimated cost in one tab in every session; a missing price, unavailable attribution, non-OpenRouter route, or failed upstream read shows as a stated state rather than a fabricated number. A session issues upstream reads only when the cache is empty or expired, concurrent readers share the single in-flight request, and a credential change invalidates its key reading. The credential's exposure surface is the one `GET /api/v1/key` request; no other wire, record, or diagnostic carries it. The session estimate derives from logged route-attributed usage and a public price table, so it is an estimate rather than a billing statement. No background timer runs, and the reading leaves no durable trace in the session log.
