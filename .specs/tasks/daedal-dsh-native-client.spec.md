---
id: TASK:tasks/daedal-dsh-native-client
type: task
status: accepted
summary: "Expose the portable DSH client."
owners: [carlo]
progress: in-progress
addresses: ["REQ:frontend/daedal-dsh#c-native-client", "IFC:frontend/daedal-dsh-client"]
blocked_by: []
---

# Expose the portable DSH client

## Plan

Inspect the Connection client face, generated remotes, gateway streams and pure session projections. Prove their use in the Daedal DSH React Native, browser and Electron clients. Extract or expose a supported portable face only where imports, transport assumptions or package exports prevent that use. Preserve the existing Web consumer and supported dsh launch rules. Native transport owners supply fresh cancellation controllers; composed cancellation releases its source listeners when an operation finishes, including success, failure, stream return and contribution withdrawal. Publish the existing generated Remote selection and Client registry through ordinary ESM, retaining Client declarations and shared registry/schema identity. The portable application facade exposes its shared Connection and Gateway building blocks with one declaration bundle so separately installed consumers do not duplicate nominal Client types or depend on Host development dependencies.

Reuse the existing Workspace model and follow controller in the portable assembly. Preserve Host-confirmed ordering, mutation echoes, archive state, race resolution, per-host isolation and stream disposal.

Reuse the existing Session service, manager, event windows, pending submissions, queues and projection stores. Portable callers supply request identities, a current client time zone and an already hydrated, host-specific selection store. Keep the browser composition on its existing preference key and browser identity source. Native Session state must not read browser persistence or crypto globals, require the browser upload service, or share navigation across hosts.

Require the current logical Session header format before accepting an opening snapshot. Validate the Session event vocabulary at every Client journal boundary, independently of which Host build accepted the persisted log. Unknown required event types must refuse snapshots, live entries and history pages before publication. Unknown records explicitly marked ignorable retain their original payload and metadata. Use the same generated known-event set as persistence and retain it in portable artifacts.

Generate per-endpoint wire fingerprints from the same resolved codec projection used by Host and Client artifacts. Cover Context identity, ordered argument wire names, lookup keys, absence, cancellation and result items, including transitive and recursive type references. Isolate each endpoint from unrelated declarations and methods, erase source paths, symbol spelling and prose, and version the canonical fingerprint algorithm. Publish the fingerprint in authenticated capability metadata; absence denotes unverified schema compatibility. Exact fingerprint equality is conservative schema evidence, not proof of business semantics, permission or Session event support. Use the generated schema evidence with explicit business revisions and operation-time enforcement before native acceptance.

Remote methods start at business semantic revision 1. An explicit positive safe integer `@remoteRevision` annotation changes that revision when observable behavior becomes incompatible without a codec change. The generator emits the resolved revision independently of the wire fingerprint; neither field substitutes for the other. Generated Client calls carry both expectations and native calls also carry the admitted Host identity and activation. Native dispatch refuses absent evidence before sending a domain operation. The Host compares expectations to its live strict descriptor and identity before resolving Contexts or lookups, and rechecks the same descriptor before business execution after asynchronous preparation. Mismatch refuses unary and stream operations without business execution or automatic retry. Calls that omit expectations retain the existing unnegotiated Web/source route during migration. Authenticated capability metadata carries optional semantic revisions; absence remains unverified. Native generation admission uses the explicit Client requirement set below.

## Generation admission

Native composition explicitly selects required endpoints from the same generated contributions that it mounts. The requirement records contain endpoint, unary or stream mode, wire fingerprint and semantic revision; no Host response supplies Client expectations. On each authenticated event-stream opening, validate the paired Host and read capability metadata for that exact activation before publishing readiness or delivering forwarded events. Every required endpoint must match mode, schema and business revision and be available or context-required. Missing, unverified, unavailable or incompatible required endpoints refuse admission; unrelated optional capabilities do not block it. An explicit empty requirement list admits metadata-only compositions. The accepted snapshot is visible only for its active generation and disappears on loss. Cancellation and late metadata responses cannot publish readiness; reconnect repeats admission. Per-operation Host enforcement and Session format/event checks remain authoritative after admission.

Supervised native read streams opened before the first admitted generation must wait for admission. Losing an admitted generation must remain a recoverable carrier failure for those streams so their existing baseline/cursor logic can reopen. A present generation belonging to a different Host remains a terminal refusal. Unary commands retain their single-send behavior and uncertain outcomes; classifying a connection loss must never replay a command.

## Installable Client distribution

Produce a DSH-owned portable Client distribution from the existing generated facade runtime and bundled declarations. Its manifest includes only the shared portable runtime and nominal type dependencies; installing it must not fetch Host implementations. Keep Cordis, Brand and Typert identities shared with the consumer. Do not copy wire schemas or maintain a second implementation in the frontend. A clean committed source revision, a fresh build and checksums identify every supplied archive, including unpublished shared dependencies. The frontend pins those archives and its lockfile. Qualification must include a real clean package-manager install, strict declaration consumption, runtime imports and the actual mobile bundler; unpacked archives alone do not establish installability.

The application distribution combines the existing API, Conversation and Chat portable runtime entries at the packaging owner, without moving presentation logic into the API service. Keep one original compiled declaration graph across these entries, including module augmentations and side-effect imports. Rewrite only internal module references to packaged relative files; reject unresolved, escaping, non-declaration or undeclared external dependencies. Retain shared external type identities and declare their dependencies explicitly. Packaging stages into an exclusively created destination and removes only its own incomplete output. The API-only distribution remains separately available. Qualification includes strict declaration merging and discriminated Chat types, source provenance, clean installation, runtime imports and the installed iOS bundler.

## Native credential consumption

Export the existing Connection-owned Host id and device-grant validators together with a strict enrollment-envelope validator for application QR and protected-storage readers. A stored value or QR remains untrusted until those shared parsers accept it; malformed data must not create a transport. Keep grant/device identity consistency and version refusal in DSH rather than copying their schemas into the frontend.

Portable unary fetch adapters require only HTTP success, status and JSON decoding. Expose that narrow response type so native adapters can retain cancellation ownership through complete body decoding without emulating a browser Response. Existing browser fetch implementations remain structurally compatible.

## Observable Session reads

The shared Session-list projection must retain the owning manager's read activity and structured failure alongside arrival phase. A settled read promise does not imply a successful result. Initial failure remains pending arrival with a visible error; refresh and continuation failures retain existing rows, preserve the next cursor, and expose retry state. Native and browser consumers use this same feed without issuing duplicate reads or deriving success from promise settlement.

## Portable Conversation assembly

Expose the existing target-neutral Conversation assembler, effect-owned Definition registries and observable Session binding through an ordinary ESM entry that does not load the browser shell, editor, image URL cache or React. Reuse this binding in the existing browser service. Portable consumers supply the publication scheduler or explicitly request immediate publication; the browser adapter preserves its current three-frame streaming cadence. The binding consumes the existing contiguous Session event source, including replace, prepend, append, revision gaps and Assistant settlement, without opening another history stream or redefining Session projection semantics. Closing the binding detaches its source and cancels queued publication; late callbacks cannot flush or reactivate it. Qualify subscription identity, target activation, cumulative streaming, registry changes, pagination, resynchronization and disposal with deterministic schedulers and the existing browser composition. Business target Definitions, native renderer integration and installable mobile distribution remain separate required work before native Conversation acceptance.

## Portable Chat business composition

Expose the existing Chat business Definitions and snapshot builder through a renderer-independent registration entry. Browser and native callers install the same ordered contributions through effect-owned Conversation registries and the existing pure request/system-prompt inspectors. Use one canonical type outlet for merge-extensible Conversation maps across browser and portable faces; update every contributing consumer and retain the same declaration identity. Preserve fallback ownership, stable node identities, compact-process facts, stream settlement, surface replacement, history prepend and registry teardown. The browser plugin delegates to this composition without changing its rendering or target semantics. Do not add a second Chat projection or put presentation business logic in the Remote API service. Qualify native consumption with the actual Chat target, recorded event fixtures, browser composition, strict installed declarations and the mobile bundler. Installable distribution must retain shared Cordis and branded identities and accept the existing generated Session event source; select its packaging from verified declaration/runtime compatibility rather than duplicating runtime or wire models. Native screens and physical-device Session interaction remain separate acceptance requirements.

## Acceptance

A native iPhone build and browser/Electron consumers attach to an existing session, stream, prompt and resolve an interaction through native DSH semantics. Shared source and artifact checks reject Node/DOM imports on native paths. Focused lifecycle tests cover cancellation, disposal, disconnect after acceptance and reconnect; recorded-session output remains faithful.
