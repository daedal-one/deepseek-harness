# @deepseek-ai/dsh-subagent-result-status-block

Role-aware completed-result validation for one-shot subagents. Each plugin instance registers a named validator on `ctx.subagents`; a [`dsh-tool-subagent`](../tool-subagent/README.md) instance selects it through `resultValidation`. Unconfigured delegation tools are unchanged.

`implementer-status` checks the imported Daedal completion fields (`Status`, `Confidence`, `Spec issues`, `Deviations`, `Files`, `Verification`, `Commit`, and `Warnings`). Guru `PLAN` and `ADVERSARIAL` reports are exempt because they use their own verdict protocol. When the child is in-process, successful `write`, `edit`, and `str_replace_editor` events corroborate `Files:`; a mutated path omitted from the status block produces a warning.

`review-verdict` requires `Verdict` and `Summary`, plus `Defects` for a defect verdict. File-and-line claims in defect bullets are compared with successful durable `read` or `read_image` events when the child is in-process. This evidence check is intentionally one-way: shell reads and remote-provider activity are not observable as structured filesystem facts, so absence of a matching event creates a warning but never deletes or rejects the review.

Warnings are structured values on foreground delegation results and stable text on background task results. Validator failure becomes `validator-failed`; the child's output is always preserved. A configured validator that is absent rejects before starting a child, so a misspelled policy cannot silently disable enforcement.

## Config

| Key | Meaning |
|---|---|
| `validator` | Unique registry name selected by a delegation tool. |
| `kind` | `implementer-status` or `review-verdict`. |

## Model Experience

### Result warnings

#### What the model sees

The child's normal final text, followed only when needed by lines such as `[subagent-result:missing-status-fields] ...`. Foreground canonical output also carries the warning `code`, `message`, and optional JSON `details`.

#### Token effect

Zero tokens for valid results. Invalid results add one bounded line per detected concern plus the provider's safe path list.

#### KV Cache effect

Append-only. Validation changes only the new delegation result and does not alter earlier request prefixes.

## Known Limitations and Deferred Work

- Structured filesystem events cannot prove shell, remote-provider, or external-editor reads and writes. The validator reports only contradictions supported by durable facts and does not claim complete activity reconstruction.
- The status-block parser exists for imported role prompts. New role designs should use the existing subagent `outputSchema` capability and keep textual parsing as compatibility only.
