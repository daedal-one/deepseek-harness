---
description: "Browser-host wire layer for the web GUI: Remote RPC, event-stream delivery with reconnect, exact Fetch routes, the /api HTTP bridge, and the browser-trust fence."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-connection

## Summary

The package carries browser-to-Host Remote calls, exact Fetch responses, and connection generations. The Client plugin mounts `ctx.connection` with current-page loopback state, generic RPC, the active generation and its Host facts, observable recovery state, an immediate reconnect command, and the registration point for one generation source. A generation becomes visible when its source reports ready; source completion, failure, withdrawal, or an explicit stop clears it before `ConnectionController` applies its retry policy.

## Table of Contents

- [Use this package](#use-this-package)
- [Portable client](#portable-client)
- [Browser authentication and request trust](#browser-authentication-and-request-trust)
- [Device enrollment](#device-enrollment)
- [Host identity](#host-identity)
- [Connection generation](#connection-generation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The browser uses HTTP POST for Remote unary calls. API Gateway owns the `/api/remote.mux` WebSocket and its logical streams; shell-owned compositions provide equivalent Remote streams through `connection.rpc.open` without opening a WebSocket. The Host half always provides the carrier-neutral RPC and exact `GET`/`HEAD`/`POST` route registries. When a Web carrier is present it also owns the sole `/api` route, Fetch bridge, browser authentication, and Host/Origin checks; a shell-owned carrier dispatches the shared Fetch handler directly. Each exact route declares buffered or streaming request-body handling before the bridge reads any bytes. Typert Gateway claims generated Remote endpoints, feature packages register non-JSON responses such as Session-log downloads and raw file uploads, and unclaimed requests return 404. Plugins register exact JSON RPC endpoints through `ctx.connection.rpc.handleRoute`; Connection owns envelope validation and response encoding across Web and shell-owned carriers. Loopback hostname classification remains package-internal to the browser-facing Client state. Browser raw-body transfer is provided by [`dsh-client-file-upload`](../file-upload/README.md).

-----

<a id="portable-client"></a>
## Portable client

The `@deepseek-ai/dsh-client-connection/client/portable` entry provides `createConnection` and `createConnectionRpc` as ordinary ESM without the Web module loader. Each connection receives an explicit RPC transport, local-Host hint, recovery configuration, optional network observer and optional `createAbortController` factory. The factory defaults to the platform controller; native callers supply fresh controllers that preserve abort reasons. Native callers supply their Host authority, authenticated Fetch and stream adapters, and correlation-id generator. The portable entry does not read page, fetch or crypto globals. Its `RpcFetchResponse` requires only HTTP success/status and JSON decoding; native adapters retain cancellation through body decoding without emulating a complete browser `Response`. The Web plugin supplies those inputs from its browser environment and uses the same connection implementation. Both Client entries expose the same Host identity and device-access declarations.

Each instance owns its generation, retry state and subscriptions. Stopping its loop or withdrawing its generation source removes its network observer and cancels that instance's generation. Unary calls are sent once: a lost response rejects without resubmitting the operation. The transport owner must reconcile an uncertain command result before retrying it. The local-Host hint does not establish identity or grant permissions. The generated domain Remote client remains separate from this transport entry. `claimDeviceEnrollment({ baseUrl, expectedHostId, challenge, label, fetch, signal })` claims once through a dedicated unauthenticated Fetch adapter, with cookies omitted and redirects refused. It validates the grant and matching Host before returning it, and checks cancellation before dispatch and after response decoding. The application owns secure storage, authenticated adapters and any uncertain claim outcome. Portable consumers validate transferred Host ids, enrollment metadata and protected grants through `connectionHostIdSchema`, `connectionDeviceEnrollmentSchema` and `connectionDeviceGrantSchema`. `DEVICE_ACCESS_PATHS` supplies the same Connection-owned routes; neither a parsed QR nor a stored grant substitutes for live Host authorization.

-----

<a id="browser-authentication-and-request-trust"></a>
## Browser authentication and request trust

Host RPC methods and WebSocket streams require a browser session or an enrolled device; there is no method-specific loopback tier. Each process mints a random launch token. `dsh-web-app` prints and opens the ordinary root URL with `?token=...`; `frontend-static` delegates root and index requests to `ctx.connection.authorizeIndex`, which accepts that token only on `GET /`, writes an authority-bound signed cookie, and redirects to clean `/`. A missing, expired, malformed, or wrong-authority cookie returns 401 before RPC dispatch. Static assets remain public. The HTTP carrier accepts no query token outside the root exchange. Device authorization uses a separate Authorization-header credential.

The cookie signing secret is the owner-scoped `client-connection/browser-session` grant record in `ctx.credentials`. The local provider persists it in `$DSH_HOME/.credentials.yaml`; `BrowserAuth` loads or creates the record during Connection activation and retains the secret in memory, so request authentication is synchronous. Deleting or replacing the record takes effect on the next Connection activation. Cookies carry an absolute issue/expiry interval, defaulting to 30 days through `cookieMaxAgeDays`, and bind the normalized hostname plus port in both their deterministic name and signed payload. They are host-only, `Path=/`, `HttpOnly`, and `SameSite=Strict`; they deliberately omit `Secure` because the shipped server uses loopback HTTP.

Before authentication, every request still passes `src/api-request-trust.ts`. Its `Host` must be loopback or match a `trustedHosts` entry: exact on `host:port`, any port on port-less entries, both sides WHATWG-normalized. An attached `Origin` must equal that Host and `sec-fetch-site: cross-site` is refused. Malformed configured authorities fail plugin load. These checks defend DNS rebinding and cross-site browser requests; they never establish identity. A failed Host/Origin check returns 403, while a trusted but unauthenticated request returns 401. `dsh web --host 0.0.0.0` remains unsupported. Decision records: [browser request trust](../../../.agents/notes/implemented/architecture/2026-07-28-api-browser-trust-boundary.md) and [browser token authentication](../../../.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.md).

<a id="device-enrollment"></a>
## Device enrollment

Device access is disabled unless `config.deviceAccess` supplies `enrollmentTtlMs`, `maxPendingEnrollments` and `maxDevices`. The Web profile supplies five minutes, four outstanding challenges and sixteen devices. An authenticated browser owner creates a challenge with `POST /api/connection/devices/enroll` and `{}`, lists public metadata with `GET /api/connection/devices`, and revokes one grant with `POST /api/connection/devices/revoke` and `{ deviceId }`. Device bearers cannot administer grants. Existing browser-only auxiliary routes and private DesktopHost carriers retain their own policies.

`POST /api/connection/devices/claim` accepts `{ hostId, challenge, label }` without an existing credential, still behind the Host/Origin fence. This exact route has a fixed 2 KiB request limit; labels contain 1–80 characters after trimming. Challenges contain 256 random bits, expire by elapsed time, remain in memory and are consumed before a grant is persisted. Restart or plugin reload invalidates outstanding challenges. A failed or lost claim requires a fresh enrollment; it is never retried automatically. The [Devices section](../ui-device-access/README.md) presents the browser-owner QR; native applications own scanning, Host review and secure storage. Permanent credentials must never enter URLs or QR codes.

The Web Client provides `ctx.connectionDevices` separately from the portable Connection handle. It uses same-origin cookies only on ordinary HTTP(S) pages, validates strict responses and the current Host identity, and discards results after its generation changes. Opening the Devices section reads metadata; creation and revocation require explicit actions. Closing the section, page hiding, generation loss and disposal clear enrollment material, and expiry hides the QR. Failed mutations are never replayed; an uncertain outcome requires an authoritative list refresh. Private carriers and fixtures expose no browser-owner administration.

A successful claim returns `{ version: 1, hostId, device: { deviceId, label, createdAt }, credential }` once. Connection persists only its SHA-256 digest and public metadata in the Host-bound `client-connection/device-access` credential record. No credential or challenge appears in device lists. Requests send `Authorization: Bearer <credential>` on HTTP and WebSocket upgrades; invalid supplied authorization cannot fall back to a valid browser cookie. HTTP authentication reads the current stored grants before dispatch. Invalid or foreign persisted state fails closed.

Every accepted device carrier retains an authorization lease. Successful revocation commits first, then cancels that device's HTTP requests and sockets and rejects future admission. Observed credential-record replacement or removal reconciles active leases; malformed observed state cancels them. Other devices and browser sessions remain valid. Disposal stops admission, invalidates challenges and leases, and waits for pending record operations. Revocation cannot undo an accepted business operation or prove that an interrupted command failed; callers must reconcile uncertain outcomes. See the [device access decision](../../../.agents/notes/implemented/architecture/2026-09-16-device-enrollment-and-revocation.md).

<a id="host-identity"></a>
## Host identity

Authenticated carriers read `connection/identity` through `/api` with an empty object. The portable and Web Client entries expose `readHostIdentity(rpc, signal)` with shared response validation. The response contains only `{ version: 1, hostId, activationId }`: a durable random UUID for the credential store and a random UUID for the current application root. `version` describes this envelope, not API or Session compatibility. Identity does not grant permissions or bind a separate stream to this response. The Host service exposes the same value as `connection.identity`; the application Remote assembly carries it on the authenticated Gateway stream. The type-only `/types` entry shares identity types across Host and Client programs. The `/identity` entry contains only identity wire schemas, constants and types; Client bundles may inline it without importing the Connection plugin.

Connection atomically creates the versioned `client-connection/host-identity` grant through the credential provider before publishing its service. Malformed records and persistence failures prevent activation. Reloading Connection within one root preserves both ids and rejects a deleted or replaced Host record; a new root sharing the store retains `hostId` and gets a new `activationId`. Copying the credential store copies Host identity. Addresses, display names, browser signing secrets and telemetry identifiers are independent. The [Host identity decision](../../../.agents/notes/implemented/architecture/2026-09-15-host-connection-identity.md) records these ownership limits.

<a id="connection-generation"></a>
## Connection generation

API Gateway Client registers the internal `$events` logical stream as the sole generation source, independently of whether any `$on` listener exists. The Host attaches all incremental listeners in the API Remotes source factory, then sends one `{ type: 'ready', protocolVersion: 1, clientId, host: { home, identity } }` item before events. Gateway validates its opening protocol and identity before reporting ready; generic synthetic generation sources may omit identity. Native Host pinning and operation lifetime are owned by [Gateway](../../api/gateway/README.md#portable-client). `ConnectionController` publishes that generation and calls `onConnected` only after the ready item arrives, so baseline acquisition cannot race ahead of incremental observation.

An ended `$events` stream, a Remote stream error, a non-ready opening item, or a malformed event item invalidates the current generation. A pending handshake logs a slow-Host warning after 3 seconds and logs the readiness timeout and aborts after 15 seconds by default, including time spent waiting for the physical socket. The source must stop delivery, release resources, and settle after cancellation before a replacement starts; late readiness from a cancelled source cannot publish a generation. While the browser reports network availability, the controller publishes `connecting` and retries with 50%–100% jitter under caps of 500ms, 1s, 2s, 4s, 8s, and 10s, continuing at the final cap until recovery. Every retry asks Gateway to replace the physical WebSocket once and reopens `$events`. The [continuous recovery decision](../../../.agents/notes/implemented/bug-fix/2026-09-05-continuous-client-recovery.md) owns the deadlines and retry policy.

`ctx.connection.reconnect()` interrupts active work, resets the sequence, and starts retry 1 immediately. Browser `offline` aborts active work, publishes `disconnected`, and suspends automatic attempts; the next `online` transition resets the sequence and starts at the 500ms tier. Only a ready item publishes `connected`. Gateway mux owns no independent retry schedule.

Set the Host Connection row's `config.recovery` to override retry caps, the growth factor, or handshake warning and cancellation times; the [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-client-connection) lists accepted fields. The Host validates these values and injects them into each served page. The Client validates the bootstrap data before providing Connection and uses those defaults when Gateway starts its loop; explicit `start()` timing overrides take precedence. The growth factor must be finite and at least one. Readiness, failure, cancellation, or a hard deadline that occurs before the warning cancels that warning. Reload the page after changing Host recovery configuration.


<a id="model-experience"></a>
## Model Experience

None, as the wire consumer layer moves already-composed messages between browser and host; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Buffered `/api` routes retain each request body in memory** — `maxRequestBodyBytes` (default 300 MiB, sized for the default 200 MiB aggregate image limit after base64 expansion plus envelope headroom) bounds ordinary image and RPC envelopes. Opt-in streaming routes receive backpressured chunks and bypass the aggregate cap; route implementations own persistence, cancellation, and any storage quota.
- **The browser cookie is not marked `Secure`** — loopback HTTP is the shipped transport, so exposing the same authority over plaintext networking can expose the bearer cookie in transit.
- **There is no logout operation** — clearing the browser cookie ends one browser session; deleting the owner credential record and restarting `dsh` revokes every session.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Connection loads its browser signing secret and Host identity during activation; the credentials companion owns record commit-event lifetime. Stream/reconnect sequencing and rpcId round-trip discipline are exercised directly by behavior specs, and route register/dispose symmetry is audited by the webserver companion.
