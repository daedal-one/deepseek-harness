---
id: TASK:process/spec-ref-none-convention
type: task
status: accepted
summary: Record the Spec-Ref none convention and enforce the trailer on feat, fix, and perf commits.
owners: [carlo]
progress: done
addresses: []
labels: [process, specs, gates]
assignee: carlo
---

# Spec-Ref none convention

## Acceptance

A behavior-changing commit that has no applicable spec carries `Spec-Ref: none (<reason>)` with a non-empty reason, so the absence of a spec reference is an explicit, reviewable statement instead of a silent omission. The lefthook `commit-msg` gate requires a `Spec-Ref:` trailer on `feat`, `fix`, and `perf` subjects; merge commits and the remaining conventional prefixes are exempt. A trailer naming a real reference resolves against the `id:` frontmatter of every spec under `.specs/`, and an unresolvable reference fails the commit with the closest declared ids. The repository instructions state Specs Format v0.7 as the format version.
