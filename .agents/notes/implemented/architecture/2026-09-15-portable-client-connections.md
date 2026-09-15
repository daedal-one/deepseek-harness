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

Browser and portable callers share one recovery implementation and RPC envelope parser. The [Gateway portable entry](../../../../packages/api/gateway/README.md#portable-client) also shares the multiplexed stream carrier; page URL selection and browser crypto remain in its Web adapter. Native adapters supply per-host sockets and identities. Cancellation consumes the common signal event API and preserves supplied reasons without requiring newer signal helpers. Native callers must supply authenticated transports and a correlation-id generator explicitly. The portable Gateway service also shares generated call dispatch, stream supervision and event forwarding with its Web plugin. Its caller supplies transport and event identities; the Cordis runtime remains an external dependency shared by the Client composition. The complete service and Connection accept a per-instance controller factory so native adapters can retain reasons and signal helpers without changing process globals. Gateway owns composed-signal cleanup at unary, stream, forwarded-event and generation completion; settled operations do not retain listeners on live method or host lifetimes. Device pairing and selected domain Remotes remain separate requirements.

Focused tests cover concurrent Host isolation, offline suspension, observer disposal, stream cancellation and a lost mutation response without retries. A built-artifact check evaluates the ESM companion without Node imports or a browser and rejects both forbidden cases as negative controls. These checks do not establish physical iPhone compatibility or device authorization.
