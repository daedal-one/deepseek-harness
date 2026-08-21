# Agent Note: Standardize Chinese contract terminology on "convention"

Status: implemented (later superseded; the Chinese and bilingual documentation was removed during the English-only cleanup)

> **Superseded:** The repository is now English-only. The bilingual documentation and translation pipeline this decision governed were removed, so this terminology ruling no longer applies to any active corpus.

## Problem

The Chinese documentation rendered English `contract` inconsistently as two competing engineering renderings, sometimes within one file or paragraph: the formal "contract" rendering (prescribed by the terminology table) and the interface-facing "convention" rendering (preferred by reviewed incremental proofreading). Leaving the table and corpus split made either choice fail the repository's terminology rule and allowed later translations to reintroduce the disagreement.

English `convention` also commonly renders as "convention". That overlap is intentional: ordinary Chinese engineering prose uses a single term for both concepts, and context normally carries whether a statement is descriptive practice or a binding interface rule. Where an English sentence explicitly contrasts a convention with a contract, the Chinese sentence must preserve the distinction through wording such as "custom" versus "convention", rather than mechanically giving every `convention` the same rendering.

## Decision

The terminology source of truth defines `contract` as "convention" and `adapter contract` as "adapter convention (adapter contract)" on first mention. Every active Chinese documentation pair follows that ruling; archived Agent Notes remain frozen. Unpaired bilingual calibration assets and the translation prompt's explanatory prose follow the same terms so they cannot teach the superseded rendering.

The migration is semantic prose maintenance, not a rename of identifiers. Inline code, file paths, links, API names, English filenames containing `contract`, and machine-readable values remain unchanged. `convention` does not receive a global terminology row or corpus-wide rewrite: translators preserve natural Chinese and explicitly disambiguate only where the source contrasts the two concepts. The [concrete prose decision](2026-08-09-concrete-prose-names-actors-and-recorded-facts.md) separately decides when English prose should replace a vague `contract` use with the exact rule, API, or behavior before translation.

## Alternatives considered

**Keep `contract` as the formal "contract" rendering.** Rejected because the reviewed corpus consistently preferred "convention" for technical interfaces, lifecycle guarantees, and behavioral boundaries, and maintaining the older term would require reverting accepted proofreading across many documents.

**Give `convention` a mandatory global rendering.** Rejected because its meaning ranges from naming practice to protocol convention. A single forced term would create a second broad migration without improving ordinary prose; only explicit source contrasts require a distinct rendering.

**Permit both the "contract" and "convention" renderings for `contract`.** Rejected because it preserves the exact inconsistency that made package families and even individual paragraphs disagree.

## Consequences

Active Chinese documentation had one binding rendering for `contract`, and future translation prompts received that decision directly from the terminology table. Archived records kept their historical text. A source sentence that contrasts convention and contract requires local semantic wording, so equal dictionary choices never erase a distinction the source actually uses.

## Verification

The migration scans every active bilingual pair, updates each affected Chinese document, re-records its pairing sidecar, and leaves active prose with no outdated `contract` renderings. The pairing gate, full `doc-sync`, website build, translation prompt tests and snapshot, and `git diff --check` verify the resulting corpus and pipeline assets.