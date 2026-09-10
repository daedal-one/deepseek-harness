# Verify specifications with Deadal-intellect

Deadal-intellect checks whether a repository implementation meets its Forge specifications. You choose what to verify in a conversation, review the proposed checks, and receive evidence tied to a specific revision. You do not need the Forge dashboard or its services.

## Start the profile

Use a macOS or Linux machine with this Harness fork and compatible `spec`, `forge-intellect`, and `forge-intellect-action-mcp` commands installed. Open the profile from your repository:

```sh
dsh --profile deadal-intellect
```

Select the repository workspace and the **Deadal-intellect** agent preset. Existing saved preset preferences can take precedence over the profile default. The profile uses your Harness credentials; if OpenRouter is not configured, add its key in Settings. The [model guide](providers.md) explains credential and model settings. Assessor and challenger have separate entries in the agent-model settings.

## Ask for a small verification

Start with a concrete behavior:

> Verify the specification for canonical projection in this repository. Choose a small, meaningful set of tests, explain the plan, and record an attestation if the evidence qualifies.

The assistant discovers your specs, reads the relevant implementation, and prepares a plan. If the repository has unfinished changes, it helps you finish and commit the intended work first. Ask it to preserve unrelated work. A qualifying implementation commit needs the appropriate `Spec-Ref: REQ:namespace/name (implements)` trailer.

Review the exact checks, source scope, models and limits in the approval request. Approving starts the check execution and separate assessor and challenger reviews. The conversation reports progress and remains available for other work. You can ask to cancel the verification.

## Read the result

A result distinguishes three things: whether execution completed, what the evidence establishes, and whether that evidence is current for your checkout.

| Assessment | Meaning |
|---|---|
| Supported | The selected obligation has qualifying implementation and check evidence. |
| Contradicted | Captured evidence demonstrates a violation. |
| Inconclusive | The available evidence cannot establish support or contradiction. |
| Stale | A relevant revision, policy or verification dependency changed. |

Ask “Show the evidence for this clause” or “Explain the unresolved gaps.” The assistant records an attestation only when native Intellect accepts complete scope, evidence, freshness and implementation provenance. TASK completion and structural coverage do not establish implementation adherence.

After fixing a demonstrated gap, commit the intended change and ask to verify again. To reconsider existing evidence without rerunning checks, ask for reassessment. It requires current authenticated executions and uses fresh reviewers while preserving the original run.

## Return later

Open the same repository and ask:

> Show the previous verification runs and whether their evidence is still current.

Results are retained under your Harness home. An interrupted job is identified explicitly. Missing or altered evidence cannot silently become a successful attestation.

For automation, `dsh --profile deadal-intellect-headless "your verification request"` exposes the same tools. Execution still requires an approval answerer; the browser is the simplest interactive path.

The [integration reference](../../../packages/integration/forge-intellect/README.md) describes native prerequisites, storage and execution limits.
