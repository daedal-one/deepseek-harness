# Session telemetry

DSH can upload a Session log prefix to DeepSeek over OpenTelemetry (OTLP), and the base profile ships with that enabled in its most restrictive mode. This page is the reference for the three environment variables that control it: which mode is active, where records go, and how to opt out completely. Read [Run DSH behind a network proxy](./guide/network-proxy.md) if outbound traffic on your machine goes through a proxy, because telemetry ignores one.

## What the default mode uploads

The shipped `FEEDBACK_ONLY` default releases a Session-log prefix only after your own explicit feedback — text feedback, a message rating, or a note edit or withdrawal. Ordinary activity never triggers a capture: creating a Session, sending requests, restoring a conversation, or mounting a plugin uploads nothing. After one feedback event releases the prefix, later records wait for the next explicit feedback, and OpenTelemetry batching may finish an already-authorized upload without another interaction.

An export carries the complete released records: message text, tool arguments and results, the system prompt and tool schemas, todo text, compaction summaries, your feedback text, and the Session's working directory. Provider credentials never appear, because adapter API keys are constructor parameters rather than Session events. Deployments own their redaction rules.

## Environment variables

| Variable | Effect |
|---|---|
| `DSH_TELEMETRY_MODE` | Selects the sharing mode. `FEEDBACK_ONLY` is the default and is the only uploading mode; `DISABLED` constructs no exporter and no telemetry record leaves the process. `FULL` is rejected. |
| `DSH_TELEMETRY_OTLP_URL` | Overrides the OTLP logs endpoint, which defaults to `https://harness-telemetry.deepseeksvc.com/v1/logs`. |
| `DSH_TELEMETRY_DISABLED` | Opts the process out. **Any non-empty value disables telemetry, including `0` and `false`** — the switch prefers off-by-mistake over on-by-mistake. A composition that mounts no telemetry row exports nothing, so the switch is then trivially satisfied. |

Set them where `dsh` reads its launch environment: an exported shell variable, or `$DSH_HOME/.env` (`~/.dsh/.env` by default) next to your API key. An exported variable wins over that file.

## The anonymous user id

Uploaded records identify the installation by an anonymous user id, not by your account or machine. DSH mints a random UUID on first use and stores it as a bare line in `$DSH_HOME/.anonymous-user-id` (`~/.dsh/.anonymous-user-id` by default); every process sharing that directory reports the same id. Delete the file to reset the identity: the next launch mints a fresh one, and nothing derived from your hostname, network address, or git remote is consulted. The same id also travels to DeepSeek as model-hidden request metadata, independently of telemetry, so the id's own page is [the anonymous user identity reference](../../packages/identity/anonymous-user-id/README.md).

## Turn telemetry off

Set `DSH_TELEMETRY_DISABLED` to any non-empty value:

```sh
export DSH_TELEMETRY_DISABLED=1
```

`DSH_TELEMETRY_MODE=DISABLED` also stops delivery, and the difference matters. The switch removes the `session-telemetry-otel` row from the composed profile at boot, so no coordinator, provider, processor, or exporter is constructed and live feedback warns locally instead of uploading. The mode value keeps that row mounted and makes its own capture path a no-op. Prefer the switch when the goal is to guarantee that nothing leaves the machine.

Neither control affects the [DeepSeek session-log contributor](../../packages/session/session-log-deepseek/README.md), which is a separate opt-in sharing path. In a custom profile that does not mount the telemetry row, setting the switch changes nothing and needs no patch, because there is nothing to disable.

## Check the current setting

```sh
env | grep -i '^DSH_TELEMETRY'
```

An unset `DSH_TELEMETRY_DISABLED` means the composition's mode decides. The package contract behind these variables, including the exporter and processor defaults, is [the session-telemetry-otel reference](../../packages/session/session-telemetry-otel/README.md).
