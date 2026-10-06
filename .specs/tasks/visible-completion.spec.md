---
id: TASK:llm/visible-completion
type: task
status: accepted
summary: Reject reasoning-only and whitespace-only model completions.
owners: [carlo]
progress: done
addresses: ["REQ:llm/visible-completion#c-stop", "REQ:llm/visible-completion#c-evidence", "REQ:llm/visible-completion#c-terminal"]
---

# Visible completion validation

## Plan

Validate response presence at each adapter's terminal stop. Preserve reasoning, text and usage in the failed attempt, without admitting an empty assistant message to model history. Keep ordinary request retry policy and all other finish states. Explain the distinction between planner reasoning and an actual operation call in the operation-only guide.

## Acceptance

Reproduce reasoning followed by two newlines through the real pi-ai Loader composition with synthetic HTTP responses. Cover reasoning-only, whitespace-only, visible text, tool calls and independent terminal reasons in both adapters. Add a keyless recorded Session showing the failed attempt, ordinary retry and recovery. Verify package documentation, specifications and focused behavior checks. Keep production Session history and provider credentials outside repository fixtures.

## Validation

Both adapter suites and the real pi-ai Loader composition pass 132 tests. Six new response-presence cases fail against the preceding implementation. The new keyless Session replay preserves reasoning, whitespace, usage and the ordinary retry records. All 14 quick documentation gates, all 32 documentation gates and repository lint pass. Static specification validation passes; the configured Forge Intellect provider is unavailable in this checkout, so attributable adherence is not claimed. The synthetic qualification performs no paid inference and does not mutate production Sessions.
