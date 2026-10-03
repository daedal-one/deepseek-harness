---
description: "Explicit host-only composition of production read, glob, and grep with exact operation eligibility and canonical completeness checks."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-operation-fs

## Summary

This private experimental plugin registers the production `read`, `glob`, and `grep` definitions and attaches independently reviewed operation policies to those exact objects. Registration, prompt guidance, presentation, and policy eligibility unwind together on disposal. It neither looks up definitions by name to grant eligibility nor creates scoped replacement tools. All other tools remain ineligible unless a different trusted composition explicitly registers their exact definitions.

## Table of Contents

- [Use this package](#use-this-package)
- [Arguments and evidence](#arguments-and-evidence)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount this plugin once at global scope in an explicitly read-only profile beside `operations`, `tools`, `systemPrompt`, host filesystem and subprocess providers, durable Session persistence, and a separately configured judgment provider. Use it instead of the ordinary `dsh-tool-fs` and `dsh-tool-fs-search` family mounts, not alongside them: the ordinary registry rejects duplicate names. Agent-scoped mounting is rejected rather than shadowing global definitions. This standalone composition intentionally omits `write`, `edit`, and `read_image`; it is not a drop-in replacement for a full filesystem profile. Shipped defaults are unchanged.

Every configuration field is explicit. The following workload example supplies no model, deployment verification, or calibration identity and does not authorize autonomous execution; the [operation runner](../operation/README.md) retains those requirements.

```yaml
- name: '@deepseek-ai/dsh-experimental-operation-fs'
  config:
    approvedRoots: [/work/repo/src]
    maxPathBytes: 4096
    maxPatternBytes: 512
    readMaxLines: 200
    readMaxLineLength: 2000
    readMaxBytes: 32768
    readStreamMinSize: 1048576
    globMaxResults: 100
    sampleOverCapGlobResults: false
    grepMaxMatches: 100
    grepMaxLineBytes: 2000
    searchMetaMaxBytes: 32768
    rawOutputMaxBytes: 262144
    graceMs: 1000
    stderrMaxBytes: 4096
    timeoutMs: 10000
```

Approved roots are canonical absolute host paths. Each operation target must resolve lexically inside one approved root, using component-aware containment; `/work/repo-else` is not inside `/work/repo`. The actual caller cwd must be an absolute canonical host path, but need not be inside an approved root: a Session rooted at `/work/repo` may explicitly search `src` when only `/work/repo/src` is approved. An omitted search path selects the caller cwd and therefore fails in that example. Caller cwd is not itself a source-access grant.

The filesystem and subprocess execution-world identities must both equal the host identity. The filesystem's host-path mapping and subprocess working-directory mapping must agree with the caller cwd, and filesystem source mapping must preserve the resolved target. These checks run at admission and immediately before the tool body; the runner also pins the initial caller cwd against owner drift. Missing caller cwd never falls back to `process.cwd()`. Guest and remote worlds are unsupported. Ripgrep uses only the packaged binary with the ordinary fixed argv and `--no-config`; executable overrides are rejected.

## Arguments and evidence

Operation argument validators deny every unknown key. `glob` admits only `pattern` and `path`; `grep` additionally admits `include`. Neither accepts output-derived arguments. `read` admits only `file_path`, optional `offset` equal to 1, and a required positive integer `limit` no greater than `readMaxLines`. It permits output references for the entire resolved argument object, then validates every concrete value; the policy boolean does not claim field-only provenance. No escalation, shell command, background, or arbitrary executable arguments are admitted.

Valid relative and absolute source paths pass unchanged to the normal tools. Parent traversal, NUL, unpaired Unicode surrogates, unsupported URI/tilde/UNC syntax, and over-bound path or pattern text fail admission. Paths, patterns, include filters, approved roots, and caller cwd must be well-formed Unicode before any UTF-8 conversion; valid replacement characters, BOM characters, and surrogate pairs remain unchanged. A canonical search path such as `src/a.ts` is already relative to the caller workspace, not to `glob.root`; a selected read must use it unchanged. Lexical source admission narrows the workload only. It is not a symlink-confidentiality guarantee or a filesystem read fence, and the filesystem sandbox's mutation fences do not confine reads.

Canonical results are inspected after ordinary output-schema validation and post-execution policy. A complete read has offset 1, contiguous numbered lines covering `1..totalLines`, exactly `totalLines` entries, `truncatedByBytes: false`, and an empty `truncatedLineNumbers` array. A successful empty whole file is complete. Partial or clipped reads return `needs-replan`; malformed canonical facts fail the operation. Rendering cannot promote incomplete evidence to completion.

Successful glob and grep values contain their complete search collections before display caps. Glob uses bounded raw-byte acquisition and lossless UTF-8/NUL path framing; grep rejects unsupported non-UTF-8 matched-line bytes instead of inventing placeholder text. Both tools treat a search target spelled `-` as the literal filesystem path, never stdin. Empty successful search collections are complete searches, not proof that the plan's goal is satisfied. Search raw-output overflow fails rather than inspecting a partial collection, and the runner independently bounds retained canonical evidence and candidate sets.

## Dev Note

No runtime invariant companion is published: eligibility is bound to exact registrations and validated synchronously before dispatch, and this composition maintains no independent projection or second observation that can diverge. Lifecycle and Loader regressions exercise the owned registrations directly.

## Model Experience

### Production read and search tools

#### What the model sees

The composition exposes the unchanged production `read`, `glob`, and `grep` descriptions, schemas, prompt guidance, and presentations owned by [tool-fs](../../fs/tool-fs/README.md) and [tool-fs-search](../../fs/tool-fs-search/README.md). Operation policy does not grant ordinary scope visibility, deferred discovery, approval, permission, or sandbox authority. Direct normal calls retain their ordinary semantics; whole-file restrictions apply only when the operation runner dispatches them. Shells, scripts, hooks, writes, network/browser calls, delegation, background work, and recursive operations receive no eligibility here.

#### Token effect

Only the three normal tool declarations and their existing guidance join the profile. Operation checkpoints consume bounded canonical observations and complete candidates, not rendered preview text; no additional model-facing policy prompt is injected.

#### KV Cache effect

Explicit mounting changes the normal tool catalog and guidance. Checkpoints add no planning-model messages beyond the outer operation summary; normal direct read/search results extend model history normally.

## Known Limitations and Deferred Work

- Host-only lexical admission does not resolve symlinks into a security fence.
- Read limits bound returned evidence, not total scanning work: determining whole-file completeness can scan beyond the selected window, under ordinary cancellation and operation deadlines.
- Search matching retains ripgrep's normal ignore and binary-file semantics; unsupported UTF-8 source paths or matched text fail rather than becoming complete evidence.
- This package adds no model inference, qualification protocol, automatic fallback, retry, Operations UI, or default-profile activation.
