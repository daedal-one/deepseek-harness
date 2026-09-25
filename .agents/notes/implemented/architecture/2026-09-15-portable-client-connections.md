# Agent Note: Portable per-host client connections

Status: implemented

## Problem

A native client can connect to several DSH hosts without a browser page. The Web client artifact registers with `window.__ModuleLoader__`, and page-global transport selection cannot identify several independent hosts. A missing browser location also cannot establish that a native connection is local.

## Decision

The [Connection package](../../../../packages/client/connection/README.md#portable-client) publishes a normal ESM companion with explicit per-host transport, correlation identity, locality and network inputs. The browser plugin adapts its existing globals to the same Connection implementation. The portable factory owns generation and retry state per instance; the caller retains transport authentication and command reconciliation. The Host continues to authorize every operation.

Portable exports use the `/client/portable` subpath so compiler and catalog analysis assign them to the Client program. Their normal ESM artifacts remain separate from the Web plugin factory.

The Web plugin factory format remains governed by [client plugin loading](2026-07-23-client-plugin-loading-model.md). The retry scheduler and generation cancellation rules remain governed by [continuous client recovery](../bug-fix/2026-09-05-continuous-client-recovery.md). Neither decision is superseded by the portable entry.

## Alternatives considered

**Import the Web artifact directly.** Its module-loader registration requires a page at evaluation time. A native shim would also inherit page-global transport and locality assumptions.

**Copy the connection protocol into the frontend fork.** A separate copy would divide ownership of request validation, generation recovery and cancellation between repositories.

**Give every host a separate browser global.** This ties independent native connections to synthetic pages and makes instance disposal depend on shared runtime state.

## Consequences

Browser and portable callers share one recovery implementation and RPC envelope parser. The [Gateway portable entry](../../../../packages/api/gateway/README.md#portable-client) also shares the multiplexed stream carrier; page URL selection and browser crypto remain in its Web adapter. Native adapters supply per-host sockets and identities. Cancellation consumes the common signal event API and preserves supplied reasons without requiring newer signal helpers. Native callers must supply authenticated transports and a correlation-id generator explicitly. The portable Gateway service also shares generated call dispatch, stream supervision and event forwarding with its Web plugin. Its caller supplies transport and event identities; the Cordis runtime remains an external dependency shared by the Client composition. The complete service and Connection accept a per-instance controller factory so native adapters can retain reasons and signal helpers without changing process globals. Gateway owns composed-signal cleanup at unary, stream, forwarded-event and generation completion; settled operations do not retain listeners on live method or host lifetimes. The application Remote selection and Typert registry also expose normal ESM Client entries. Generated descriptors are bundled from their existing owners; Cordis and Zod stay shared runtime dependencies. Client companion bundles run after the Client compiler phase, including packages whose Host artifact is required earlier for reflection. The application portable facade re-exports its Connection and Gateway building blocks with one declaration bundle. Bundling each primitive separately duplicates nominal service types and conflicts with Cordis declaration merges; consumers use the application facade for the shared Client assembly. Cordis, primitive brands and Typert protocol retain their external type identities. Bundled declarations live at `lib/client/portable.d.ts`, separate from the compiler leaf and traceable to `src/client/portable.ts`. The publication constraints admit the exact portable export pair; dependency policy retains the facade's runtime and nominal type externals as installed dependencies. The portable plugin callback is bound so native async transforms cannot make Cordis treat it as a constructor and report readiness before its namespaces finish mounting. The portable application also includes the existing Workspace Controller model and installer. Its compiled Client imports resolve to the portable Gateway within that artifact; the Web plugin keeps its module-loader imports. Workspace snapshots, Host order, archive state and mutation races keep one implementation. Session installation also accepts caller-owned request identities, time zone and hydrated per-host navigation. The shared service and manager retain event windows, queues, pending submissions and Agent scope disposal; the Web adapter owns its browser defaults. Native consumers do not depend on browser file-upload injection. Device pairing, capability negotiation and application integration remain separate requirements.

Focused tests cover concurrent Host isolation, offline suspension, observer disposal, stream cancellation and a lost mutation response without retries. A built-artifact check evaluates the ESM companion without Node imports or a browser and rejects both forbidden cases as negative controls. These checks do not establish physical iPhone compatibility or device authorization.

The [Client distribution decision](2026-09-16-portable-client-distribution.md) owns standalone package installation and artifact provenance; this note retains transport and runtime ownership.

Session-list consumers receive the manager's read activity and structured failure with the projected rows. Arrival stays monotone after a successful baseline; a failed refresh or continuation retains rows and exposes its error. Promise settlement alone cannot establish read success, and frontend copies or duplicate probes would disagree with the domain's own recovery state.

Prompt outcome observation belongs to the shared Session read model. Its portable observer correlates the original request identity with received queue entries or durable user messages, including facts recovered after a lost reply. Positive evidence latches; missing loaded history cannot prove rejection. Local echoes and text comparison cannot authorize another send, and the observer never retries mutations. The caller owns the draft, its original identity, and observer disposal. This preserves the separation between transport failure and domain admission without duplicating Session parsing in platform frontends.
