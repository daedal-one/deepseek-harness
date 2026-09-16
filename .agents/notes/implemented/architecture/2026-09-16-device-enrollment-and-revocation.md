# Agent Note: Device enrollment and revocation

Status: implemented

## Problem

A phone must reconnect without carrying the browser owner's administrative credential. Removing a stored device grant must also end its already-authenticated streams and prevent pending calls from reaching business code after cancellation.

## Decision

Connection owns opt-in device enrollment through the existing credentials provider. The Loader preserves an omitted device-access configuration as disabled; an object schema default cannot silently enable or reject unrelated compositions. A browser owner issues a short-lived, single-use challenge; the claimant submits that challenge and the expected Host identity to one narrowly bounded unauthenticated route. Every request still passes Host/Origin validation. A claim consumes the challenge before persistence and returns a random bearer only after the provider acknowledges its Host-bound digest and public metadata. Lost claims require new enrollment rather than replay.

Bearer authentication cannot administer device grants or fall back to a browser cookie. It reads current grants and issues a request-owned revocation lease. A committed revoke cancels that device's leases; observed provider changes reconcile other active grants. HTTP bridges propagate cancellation and discard late responses, while Gateway binds every logical stream directly to the device lease, destroys the WebSocket and refuses business execution cancelled during asynchronous preparation. Logical cancellation cannot wait for the socket's later close event. Teardown closes admission, clears pending challenges and waits for record operations.

The browser administration model belongs to Connection but is separate from the portable bearer handle. An ordinary authenticated Web page owns its same-origin requests; private carriers receive no implicit owner authority. Every result is pinned to a live Host generation. Closing the section, hiding the page or losing the generation erases browser QR material and suppresses late enrollment results; this cannot retract a challenge already minted on the Host. Mutations run once and uncertain outcomes require an authoritative read before another gesture. A separate settings contribution keeps authorization and request lifetimes out of presentation state.

## Alternatives considered

**Copy the browser credential to the phone.** The phone would inherit device-administration authority and lack independent revocation.

**Store bearer values or retain completed claims.** Either would retain recoverable secrets beyond the one-time response and make a stolen enrollment reusable.

**Check authorization only at connection opening.** A revoked phone could retain an indefinitely active stream and continue submitting logical operations.

## Consequences

The browser owner presents enrollment QR data; native applications own scanning, secure storage, credential-scoped transport and candidate discovery. Their QR and protected-storage readers reuse Connection's exported Host-id, enrollment and grant validators, including grant/device identity consistency; the application does not fork wire schemas. JSON RPC adapters expose only status and decoded JSON, allowing native transports to retain cancellation through body consumption without fabricating browser Response objects. Device grants authorize the same ordinary API surface as browser sessions; they are not per-operation permission scopes. Revocation ends carrier authority but cannot undo accepted operations or resolve uncertain command outcomes. The credentials provider remains authoritative for observed record changes; Connection does not add an independent disk watcher.

The assembled browser scenario observes the real owner enrollment response, presents the QR, and exercises public device claim, admission and revocation. Its expected UI output retains only normalized public metadata; enrollment and bearer material stay in memory. QR decoding and physical-camera use remain separate acceptance evidence.
