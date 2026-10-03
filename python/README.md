# DeepSeek Harness Python packages

Python packages provide the subprocess SDK/runtime and an opt-in local decision service. The client SDK communicates with the bundled runtime over newline-delimited JSON-RPC on stdio; the independent decision service exposes bounded local preparation and scoring.

## Packages

| Directory | Dist / module | Role |
|---|---|---|
| [sdk](sdk/README.md) | `deepseek-harness-sdk` / `deepseek_harness` | High-level turns API and lower-level JSON-RPC client |
| [sdk-runtime](sdk-runtime/README.md) | `deepseek-harness-runtime-bin` / `deepseek_harness_runtime` | Bundled `dsh` CLI executable and native sidecars |
| [decision-service](decision-service/README.md) | `dsh-local-decision-service` / `dsh_decision_service` | Private opt-in CPU decision and tokenizer service with pinned local artifacts |

## Behavior

The SDK starts the matching bundled `dsh --profile sdk` runtime unless the caller selects another `dsh` executable or profile. The runnable minimal example selects the shipped standalone `sdk-minimal` profile; the same runtime also packages `dsh web` and its frontend assets for separate CLI use. Every launch requires an explicitly selected Harness home; Python never silently reads `~/.dsh`. The [SDK reference](sdk/README.md) and [runtime carrier reference](sdk-runtime/README.md) own runtime selection, profiles, patches, and external plugin management.

## Contributor workflows

The [Python contributor workflows](development.md) cover building runtime artifacts, validating the packages, source-mode development, and distribution.
