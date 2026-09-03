# Paseo ACP compatibility proof

This tutorial starts an isolated [Paseo](https://github.com/getpaseo/paseo) daemon that launches the built DeepSeek Harness ACP profile with the committed `text-turn` replay fixture. It proves client pairing, ACP launch, prompt transport, and committed assistant text without an API key or changes to the running DSH Web service.

Run every command from the repository root. Build artifacts must be current:

```sh
pnpm run build
```

## 1. Generate an isolated Paseo home

```sh
node apps/cli/config/examples/paseo/prepare.mjs
export PASEO_HOME="$PWD/tmp/paseo-dsh-poc"
```

The generator refuses to replace an existing `config.json`. The home belongs under ignored `tmp/` because Paseo adds a daemon private key, pairing identity, push token, logs, session databases, and project metadata.

## 2. Start Paseo

For a loopback-only Web client:

```sh
npm exec --yes --package=@getpaseo/cli@0.7.0-beta.3 -- \
  paseo daemon start --foreground \
  --home "$PASEO_HOME" \
  --listen 127.0.0.1:6769 \
  --no-relay --no-mcp --no-inject-mcp --web-ui
```

Open <http://127.0.0.1:6769>. The existing DSH Web service may continue listening on its own port.

For an encrypted mobile-relay check, replace `--no-relay` with `--relay --relay-use-tls`. In another terminal, print the pairing link and QR code:

```sh
export PASEO_HOME="$PWD/tmp/paseo-dsh-poc"
npm exec --yes --package=@getpaseo/cli@0.7.0-beta.3 -- \
  paseo daemon pair --home "$PASEO_HOME" --relay
```

Relay mode connects to Paseo's hosted relay. Pairing and transport are end-to-end encrypted, but enabling the relay is an explicit external-network action.

## 3. Run the replayed prompt

Select **DeepSeek Harness** in Paseo and send this exact message:

```text
Reply with exactly the word: PONG. Do not use any tools.
```

The agent completes with `PONG`. The replay fixture matches requests positionally, so other prompts fail by design.

The CLI can drive the same check:

```sh
npm exec --yes --package=@getpaseo/cli@0.7.0-beta.3 -- \
  paseo run --host 127.0.0.1:6769 \
  --provider dsh-replay --cwd "$PWD" --wait-timeout 45s \
  'Reply with exactly the word: PONG. Do not use any tools.'
```

## Limits

This proof uses Paseo as the session and workspace controller for one fresh ACP process. The replay checks one prompt and its committed response. It does not establish Paseo support for every current ACP capability; the [ACP protocol reference](../../../../../packages/acp/acp/README.md#protocol-contract) defines the supported methods.

Stop the foreground daemon before deleting `$PASEO_HOME`. Never commit the generated home.
