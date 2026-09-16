---
id: TASK:tasks/daedal-dsh-device-access
type: task
status: accepted
summary: "Add device enrollment and host discovery."
owners: [carlo]
progress: in-progress
addresses: ["REQ:frontend/daedal-dsh#c-device-access", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Add device enrollment and host discovery

## Plan

Add DSH-owned host identity, explicit capabilities, single-use enrollment and revocable device credentials. Adapt the existing companion host-assisted Tailscale discovery behavior at its DSH owner with bounded scans and separate candidate authorization. Preserve loopback listeners and existing service routes.

Persist a random Host identity through the existing credential provider, independently of browser signing secrets, hostnames and network addresses. A new application root gets a distinct activation identity; reloading Connection within that root preserves it. Expose the identity through the authenticated, carrier-neutral Connection RPC with shared Client validation. Failed or malformed persistence must prevent a new identity from being published. Identity is a correlation fact, never proof of authorization or a complete API/capability handshake.

Bind Host identity to the authenticated Gateway event stream before publishing a native connection generation. The portable Remote installer requires the paired Host id, refuses a missing or different identity and an unsupported Gateway opening protocol, and keeps generated domain calls and streams unavailable until that Host is ready. Lost generations cancel active native operations and refuse late results without replaying mutations. New activations of the same paired Host may reconnect. Browser and private DesktopHost carriers retain their existing authorization. Gateway opening protocol version is separate from Session data and domain API compatibility.

Expose an authenticated Gateway capability snapshot from current Host descriptors and dispatch prerequisites. Advertise only fully strict descriptors, never Client-compiled selection or SRC inference. Distinguish direct availability, a required receiver Context and missing dispatch prerequisites without invoking resolvers or business methods. The snapshot contains endpoint names, unary/stream modes and fixed reason codes, excludes local paths and provider credentials, and is bound to the current Host and activation. A portable reader validates the entire versioned response, refuses another Host or activation, forwards caller cancellation and never retries. Capability metadata is advisory and does not establish domain schema compatibility, authorization or successful resolution of a particular Session. Calls continue to enforce live Host checks.

Keep capability assembly private to the Gateway query rather than adding a general service operation. Qualify identity and capability responses through the public dsh Web profile and its real Loader composition, using isolated Harness homes and OS-assigned loopback ports. Verify authorization, strict generated endpoints, durable Host identity and a new activation across restart, retaining the portable fixture and physical-device distinction.

## Device enrollment and revocation

Connection owns an opt-in device-access configuration with explicit enrollment lifetime, pending-challenge limit and enrolled-device limit. The Web composition supplies those values. Browser-authenticated owner requests may create a challenge, list device metadata and revoke a device. Device bearer credentials cannot perform those administrative operations or mint other credentials. Existing browser cookies, index authentication, Host/Origin checks and private DesktopHost transport retain their policies.

An exact enrollment-claim POST is the only unauthenticated API exception and still passes the Host/Origin fence. Its request carries the expected Host id, single-use challenge and bounded device label in JSON. Challenges use cryptographic randomness, expire by elapsed time, stay in memory only and are consumed before durable grant creation. Restarts and plugin reloads invalidate outstanding challenges. A failed or lost claim never causes automatic replay or returns a second credential. QR data carries only the short-lived challenge, expected Host identity and selected origin; permanent credentials never enter QR codes or URLs.

A successful claim returns a random device bearer credential once, only after the credential provider commits its Host-bound record. Persist only a digest and bounded device metadata, never the bearer secret or enrollment challenge. Stored versions and fields validate on load and every admission; malformed state fails closed. Administrative listing never exposes hashes or secrets. Device authorization uses the Authorization header for API requests and WebSocket upgrades, never query strings, and never falls back to a browser cookie when a supplied bearer is invalid.

Every accepted device request owns a revocation lifetime. A committed revoke rejects future requests and cancels that device's active HTTP and WebSocket carriers; other devices and browser sessions remain valid. Credential-record changes reconcile active grants, and malformed or removed state cancels affected access. Abort before dispatch or after asynchronous Context/lookup preparation prevents business execution; an operation already accepted may have an uncertain outcome and cannot be undone by revocation. Teardown stops new admission, cancels active leases, clears challenges and waits for owned work. Privileged browser-only auxiliary routes retain their current policy.

Portable claim validation binds the returned grant to the expected Host and respects caller cancellation before accepting credentials. Native storage, the QR presentation and discovery remain separate application work. Live public-profile qualification must prove single-use enrollment, bearer access to identity/capabilities and native generation admission, durable credentials across restart, revocation of active streams and rejection of revoked or wrong-Host credentials. Keep physical iPhone acceptance distinct from local and fixture checks.

## Browser owner interface

The authenticated DSH Web Settings page presents enrolled device metadata, creates a pairing QR only after an explicit gesture, and requires a separate confirmation before revoking one selected device. Connection owns the browser administration model and validates its existing exact HTTP routes; a settings contribution renders it without copying business state or exposing browser cookies. Worker, fixture and private desktop carriers do not inherit this browser authority.

Bind every read and mutation result to the active Host generation and the current page origin. Request only same-origin cookies, refuse redirects and never send bearer credentials for administration. Validate complete responses and matching Host identity before publishing metadata or a QR. Closing the section, hiding the page, generation loss and disposal clear QR material and prevent late enrollment results from reappearing. Expiry hides the QR; hiding a challenge does not cancel it on the Host. No challenge or credential is persisted, copied to a clipboard, placed in a URL or logged.

Expose loading, empty, unavailable, owner-required, failed read, capacity and uncertain mutation states through fixed localized copy. Reads may refresh after reconnect; enrollment and revocation are never automatically replayed. A lost revocation result requires refreshing the authoritative device list before deciding to revoke again. Use the current page origin in the version-1 native pairing envelope and warn when a loopback URL cannot be reached by a physical phone. The existing native parser and protected access owner consume that envelope unchanged.

Qualify the controller's cancellation, late-result, expiry, malformed-response and unknown-outcome behavior, the real settings composition and localized render states, and a real isolated Web profile with browser-created QR data, device admission and revocation. Keep synthetic UI snapshots, browser execution, Simulator and physical-camera acceptance distinct.

Keep a committed keyless assembled-browser scenario for owner-created enrollment, visible QR presentation, single-use public claim, authenticated device admission, cancelled and confirmed revocation, and refused admission after revocation. Its expected UI output contains only bounded public metadata, with scenario-owned Host and device identities normalized. Read enrollment and bearer material only in memory; QR decoding and physical-camera acceptance remain separate evidence. Scenario teardown waits for pending startup before releasing its browser and Host, including failed or timed-out setup. Existing Web request interception must assert the generated compatibility expectations and settle its route without unhandled callback assertions.

## Acceptance

Real iPhone QR pairing and host discovery succeed without address entry. Expired or replayed enrollment, revoked devices, mismatched host identity and unauthorized discovery fail explicitly. Candidate probes never receive another host credential and never imply enrollment.
