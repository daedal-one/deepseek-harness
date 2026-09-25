---
id: REQ:performance/coding-delivery
type: requirement
status: accepted
level: MUST
summary: Measure coding-task delivery through supported Harness profiles with independent acceptance and explicit timing exclusions.
owners: [carlo]
refines: []
categorized_under: []
---

# Coding delivery measurement

## Context

Local request benchmarks exclude model latency and do not establish how quickly an agent delivers correct code. A local evaluator needs fixed tasks, independent acceptance, and complete failure accounting before request or orchestration optimizations can be compared.

:::{requirement id="coding-delivery" level="MUST"}
- {#c-outcome} Each trial MUST measure task submission through independent acceptance with one monotonic controller clock, include repair rounds, and distinguish accepted, failed, timed-out, and infrastructure-error outcomes. Startup and cleanup MUST be reported separately.
- {#c-isolation} Each trial MUST use a private synthetic workspace and Harness home, preserve controller-owned acceptance checks outside the editable workspace, bound owned processes, await cleanup, and avoid ambient user sessions or credentials in keyless mode.
- {#c-entry} Coding work MUST execute through the supported built dsh profile and SDK entry path with production tools. Keyless runs MUST replace only the model and MUST NOT call network providers. Live requests MUST require explicit opt-in and an explicit provider/model selection.
- {#c-evidence} Versioned local reports MUST retain every trial outcome, raw elapsed values, task/configuration identity, repair counts, available usage, and diagnostic timing provenance. Overlapping spans MUST NOT be summed as project elapsed time, and unavailable phase attribution MUST remain explicit.
- {#c-validation} Keyless tests MUST reject unchanged or incorrect artifacts, include repair and timeout/error paths, and verify report aggregation without dropping failed trials. The initial corpus and reports MUST disclose that they do not establish general coding quality or calibrated provider speed.
:::
