---
id: REQ:web/browser-authorization
type: requirement
status: accepted
level: MUST
summary: Remember authenticated browsers across restarts and renew authorization during active use.
owners: [carlo]
refines: []
categorized_under: []
---

# Browser authorization

:::{requirement id="browser-authorization" level="MUST"}
- {#c-persistence} Browser authorization MUST persist in an HttpOnly, authority-bound cookie backed by a durable signing secret, surviving browser and Host restarts within its configured lifetime.
- {#c-navigation} Remembered authorization MUST accompany ordinary top-level navigation from another site through an explicit SameSite=Lax cookie. Cross-site API requests MUST retain the carrier's existing trust checks.
- {#c-renewal} Authenticated index and HTTP API requests MUST renew the browser cookie for the configured lifetime. Expired, malformed, tampered, wrong-authority and revoked cookies MUST NOT renew. Device authorization and unauthenticated enrollment or discovery requests MUST NOT mint browser cookies.
- {#c-trust} Renewal MUST preserve existing Host, Origin and Fetch-Metadata checks, process-token exchange, signing-secret revocation and device credential precedence.
- {#c-evidence} Focused tests MUST prove renewal beyond the original expiry, refusal after inactivity, restart persistence, rejected credentials and real Loader HTTP response behavior. A real browser MUST retain access when reopening the application from another site after a Host restart.
:::
