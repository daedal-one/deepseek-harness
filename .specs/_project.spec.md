---
id: PROJECT:deepseek-harness
type: project
status: accepted
summary: A plugin-composed coding-agent harness with durable sessions, policy-controlled tools, and automation interfaces.
owners: [carlo]
---

# DeepSeek Harness

## Purpose

DeepSeek Harness composes replaceable model, tool, session, interaction, and
automation plugins into coding-agent runtimes for interactive and programmatic
clients.

## Scope

The project owns its plugin runtime, durable session semantics, model-facing
tool execution, user interaction, automation protocols, packaged profiles, and
the adapters that translate those capabilities for host control planes.

## Non-goals

DeepSeek Harness does not own repository intent, cross-project workflow state,
deployment authority, or the durable provenance ledger used by Forge. Those
remain with forge-spec, Forge, application infrastructure, and Forge Intellect.

## Principles

Everything is a plugin. Model-visible state is durable. Policy decisions are
enforced at the operation that acts. Automation integrations preserve native
events as attributed detail without making provider-specific fields mandatory
for their host protocol.
