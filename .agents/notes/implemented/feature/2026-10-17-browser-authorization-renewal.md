# Agent Note: Browser authorization renewal

Status: implemented

## Problem

A fixed browser-cookie expiry requires a new process launch URL even when the browser uses the Harness regularly. Durable signing-secret storage preserves authorization across Host restarts but does not extend an issued cookie's expiry. A Strict SameSite cookie is withheld when the user follows a link from another site; the index returns 401 despite the browser retaining a valid cookie, and a reload can retain that cross-site navigation context.

## Decision

Connection renews a valid browser cookie on authenticated index and HTTP API requests. Each replacement retains the authority-bound name, signed payload and HttpOnly attribute, and receives the configured `cookieMaxAgeDays` interval from issuance. Explicit `SameSite=Lax` lets safe top-level navigation carry the cookie while cross-site subresource requests and POSTs omit it. API Host, Origin, Fetch-Metadata and JSON media-type checks remain mandatory; cookie presence alone does not admit an API call. Verification rejects expired, future-issued, malformed, tampered and wrong-authority cookies before renewal. HTTP response headers carry the replacement without redirects or client-side credential storage.

API renewal follows request-trust and authentication checks. Device bearer authorization takes precedence over a supplied cookie on the shared API route and never renews browser-owner credentials. Unauthenticated device claims and Host advertisements do not mint cookies. Dedicated browser RPC routes retain their browser-only admission. WebSocket traffic does not issue cookies; a page or authenticated HTTP request renews them.

This partially supersedes the absolute session-lifetime and Strict SameSite decisions in [browser token authentication](../architecture/2026-08-24-browser-token-authentication.md). That note remains active because it owns token exchange, durable-secret storage, cookie signing, authority binding and revocation. The [browser trust decision](../architecture/2026-07-28-api-browser-trust-boundary.md) remains unchanged; neither note qualifies for archival.

## Alternatives considered

**Increase the fixed lifetime.** A longer expiry postpones the same interruption and also lengthens access for an unused cookie. Renewal preserves the existing configurable interval while supporting regular use.

**Renew only when loading the index.** A browser can remain open while making API requests for longer than one cookie lifetime. HTTP API renewal covers that activity without adding a polling timer or WebSocket protocol.

**Retain Strict SameSite and retry navigation.** A retry page adds another navigation and state to distinguish missing credentials from withheld cookies. Lax directly supports ordinary links while the carrier retains API trust enforcement. The [HTTP cookie draft's navigation and reload sections](https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html#section-8.8.2) describe this browser behavior.

## Verification

Clock-controlled tests prove renewal beyond the original expiry, validity after authentication-owner restart and rejection after inactivity. The real Loader composition exercises index and API Set-Cookie responses, original-cookie expiry, invalid bearer precedence, Origin rejection and cross-site rejection. Gateway tests retain HTTP and WebSocket admission coverage. These HTTP expectations are owner-local; renewal changes no Session event or model transcript.

An isolated browser against the built Web profile reproduces the Strict-cookie 401 by following a link from a different site; toolbar reload retains the refusal. Renewing that existing cookie with Lax permits the same external link, including after another server restart without token exchange. The real CLI regression independently preserves the cookie and Host identity across process restarts.

## Consequences

Regular authenticated HTTP use keeps the browser signed in. Clearing site data, switching authority, secret revocation or inactivity beyond the configured lifetime still requires the current launch URL. Each authenticated HTTP response carries a signed cookie; background HTTP activity also counts. A stolen valid cookie can renew until the signing secret is revoked, so the interval is an inactivity limit rather than an absolute session cap. Existing Strict cookies acquire Lax through a successful direct visit or token exchange; no payload or signing-secret migration is required. Live deployment and browser-profile verification are separate from these local checks.
