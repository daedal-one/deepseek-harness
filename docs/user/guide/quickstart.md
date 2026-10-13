# Get started with dsh

This tutorial takes a fresh checkout to a running Web GUI that answers one task, then shows where the composition and state live and how to change a default.

## Prerequisites

- Node.js 22.19 or newer on the 22.x line, or 24 or newer.
- pnpm through Corepack; run `corepack enable` when `pnpm --version` does not resolve through Corepack.
- Git.
- An OpenRouter API key, or a DeepSeek API key when you switch the default route in the last step.

## Install and build

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
```

`pnpm install` installs the workspace and configures the Git hooks. `pnpm run build` produces the package artifacts and the Web frontend, and the Web surface serves only that built frontend: a missing dist stops startup with a `pnpm run build` hint instead of serving source. The [development guide](../../development.md) owns the toolchain, hook, and project-layout details.

## Provide a model credential

The shipped default route is OpenRouter's `deepseek/deepseek-v4.1-flash`, whose credential reference is `OPENROUTER_API_KEY`. Resolution is per request and the first source with a value wins: the environment you launched in, then the stored file `$DSH_HOME/.credentials.yaml`, then your project's `.env`, then `$DSH_HOME/.env`. `$DSH_HOME` defaults to `~/.dsh`.

Export the key for one shell:

```sh
export OPENROUTER_API_KEY=sk-or-...
```

Saving a key on the **Settings → Models** page stores it in `$DSH_HOME/.credentials.yaml` and takes effect on the next request. A turn whose route resolves no key fails with the `MISSING_CREDENTIAL` failure code, and a key that is present but malformed fails with `INVALID_CREDENTIAL`; both name the reference to fix and never the key. The [pi-ai adapter reference](../../../packages/llm/llm-pi-ai/README.md) owns the full route and credential contract.

## Start the Web GUI

```sh
pnpm dsh --profile web
```

The first run initializes `$DSH_HOME/profiles/web` from the shipped `web` template and boots it; `dsh --profile web` is the same command once the `dsh` binary is installed. Startup prints a `dsh web:` line whose URL carries a fresh process token and opens that URL in your default browser. An SSH launch and `--no-open` suppress the browser only: the server keeps running and the printed URL is yours to open.

## Choose a workspace and send one task

The page opens on Chat with no workspace selected, and the session composer stays unavailable until you choose one. Click **Choose workspace**, add the directory you started `dsh` in, and select it. Then start a session and send:

> Summarize this repository and identify its main packages.

The agent reads workspace files, runs commands, and asks before operations that require approval under the active permission policy.

## Inspect the composition

```sh
pnpm dsh --profile web --dump-config
```

`--dump-config` prints the composed entry list without booting it. The generated [per-profile composition page](../../../apps/cli/composition.md) resolves the same tree for every shipped profile: each profile's bundles in order, each layer's rows, and the per-session preset plane. The [CLI reference](../../../apps/cli/README.md#profiles) owns layer precedence.

## Where state lives

| Path | Contents |
|---|---|
| `$DSH_HOME/profiles/web/package.json` | The profile manifest: ordered `dsh.profile.bundles` and the `patchReload` lifecycle |
| `$DSH_HOME/profiles/web/cordis.patch.yml` | Your patch layer for this profile |
| `$DSH_HOME/sessions/` | Durable JSONL session logs |
| `$DSH_HOME/.credentials.yaml` | Stored credentials |
| `$DSH_HOME/settings.yaml` | The user settings document |

## Change a default

`$DSH_HOME/profiles/web/cordis.patch.yml` is a top-level YAML array of patch entries applied after every bundle layer. A patch targets a row by id and replaces that row's whole `config` rather than merging into it, so restate every key the row owns. The `web` profile watches this file while it runs; the other shipped profiles read it at startup.

To route new sessions through the first-party DeepSeek adapter, which resolves `DEEPSEEK_API_KEY`, replace the whole `agent-default-model` row:

```yaml
- id: agent-default-model
  config:
    provider: deepseek-official
    model: deepseek-flash
    reasoningEffort: high
```

Export `DEEPSEEK_API_KEY` as above, then send the next task. The [DeepSeek adapter reference](../../../packages/llm/llm-deepseek/README.md) owns the route's models and credential reference.

## Continue

- [Configure models](./providers.md)
- [Per-profile composition](../../../apps/cli/composition.md)
- [CLI profiles and flags](../../../apps/cli/README.md)
