# Agent Note: Trusted subagent principals and result validators

Status: implemented

## Problem

Named roles imported from another agent setup need capabilities and completion rules that ordinary children must not receive. A role label, prompt sentence, or tool argument is model-controlled text and cannot authorize privileged tools. Completion protocols such as a required status block also cannot be enforced reliably by asking the child to remember them.

## Decision

Subagent descriptor version 3 carries an optional branded principal selected by trusted tool configuration and written before the child starts. Principal setup providers install capabilities during child activation. They run before the child's tool filter is validated, so a principal may contribute the exact tools that its configured filter names; root and ordinary children do not receive those contributions.

Subagent result validators run after the child settles and before its result is delivered to the parent. Validators append structured warnings without rewriting or discarding the child's durable output. `dsh-subagent-result-status-block` uses this seam to inspect an exact completion block and return bounded diagnostics when fields are missing or malformed.

## Alternatives considered

**Authorize from a role name or persona.** Rejected because both are model-visible text and can be copied or claimed by an ordinary child.

**Install privileged tools globally and hide them with filters.** Rejected because visibility is not authority and another Consumer could execute a known global tool name.

**Validate completion inside each provider.** Rejected because completion policy belongs to the delegation Consumer and must behave identically across providers.

## Consequences

Authorization depends on durable process-owned configuration, not persona claims. Memory review tools and MCP policy can read the same principal fact on every execution. Capability installation and result validation are extension points on the subagent service, so imported roles do not require changes to the Agent loop.

A principal is authority, not a display name. Presets must keep principals unique by trust role and must not copy them onto general-purpose children. Warnings affect what the parent receives; the original child output remains available in the child session for diagnosis.
