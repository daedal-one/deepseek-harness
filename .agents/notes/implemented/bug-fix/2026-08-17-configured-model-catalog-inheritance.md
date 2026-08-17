# Agent Note: Configured model catalog inheritance

Status: implemented

English | [中文](2026-08-17-configured-model-catalog-inheritance.zh.md)

## Problem

A configured model whose request identifier did not exactly match an installed pi-ai catalog identifier was materialized as a hand-declared model. It retained the configured identifier and route defaults but silently lost installed reasoning levels, compatibility behavior, headers, modalities, pricing, and other request metadata. Dated identifiers and provider routing suffixes therefore behaved differently from the catalog model they intentionally represented.

## Decision

A `models` entry may name `catalogModel`, an installed model on the same provider route. The resolver spreads that source model in full and then applies the configured entry, while the entry's `id` remains the identifier sent to the provider. Configured capacities, reasoning levels, compatibility switches, and other supported fields continue to win over inherited values.

An explicit source is an assertion, not a hint. An empty source or one absent from the installed route catalog fails profile resolution with the provider, configured model, and invalid source in the diagnostic. The graphical model editor preserves fields it does not expose, including `catalogModel`, when a visible field changes.

## Alternatives considered

**Repeat reasoning and compatibility fields on every routed identifier.** Rejected because it duplicates only the metadata known today, drifts when pi-ai corrects a model, and still drops unmodeled or future fields.

**Infer the source by removing dates or routing suffixes from the identifier.** Rejected because provider model identifiers are opaque strings. Spelling conventions do not establish semantic equivalence, and a mistaken inference would alter request behavior silently.

**Accept an unknown source and fall back to a hand-declared model.** Rejected because the explicit field states that inherited behavior is required. Continuing without it would preserve the original failure under configuration that appears more precise.

## Consequences

Deployments can keep an exact dated or routed identifier on the wire while inheriting the installed model's complete request behavior. The source must belong to the same provider route, so it cannot smuggle metadata across credentials or endpoints.

Installed catalog upgrades may add metadata to an inherited model without a Harness code change. Explicit fields remain stable overrides, and invalid source names fail before any provider request.
