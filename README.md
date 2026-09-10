# DeepSeek Harness

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Changes in this fork

Alongside minor cosmetic changes, this fork:

- Keeps the maintained source, documentation, and website English-only.
- Adds the [Daedal reference setup](docs/reference/daedal/README.md): an OpenRouter-first coding preset with named roles, matching Web and headless composition, and per-role model and reasoning controls.
- Routes conversation models and citation-backed web search through OpenRouter, with provider-routing controls, editable provider and model configuration, and native OpenAI Codex account authentication.
- Adds [model-backed tool policy](docs/subsystems/tool-policy.md), including a Policy reviewed permission mode, independent intent and effect review, scoped MCP capabilities and clients, trusted subagent principals, and validated child results.
- Adds [durable reviewed memory](docs/subsystems/memory.md) with explicit project and global scopes, evidence, review states, and approval-gated global changes.
- Adds a route-scoped [English-output guard](packages/guard/english-output-guard/README.md) that keeps selected models' reasoning blocks in English before they enter durable history; drifting explanatory prose is translated too, while code, identifiers, and tool calls stay unchanged.
- Rejects private-network Web fetches and fails closed when required policy evidence is missing, invalid, or unavailable.
- Integrates [Forge-managed sessions](packages/integration/forge-session-adapter/README.md) and [Forge-managed Code workspaces](packages/integration/forge-project-workspaces/README.md), with Forge Intellect as the accountable workspace tool plane.
- Improves the Web UI with searchable plugin metadata and state filters, plus end-to-end LLM output-rate reporting that does not mistake buffered delivery for generation speed.

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
