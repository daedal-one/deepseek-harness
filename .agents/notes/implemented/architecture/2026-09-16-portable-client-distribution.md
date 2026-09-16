# Agent Note: Installable portable Client distribution

Status: implemented

## Problem

A portable subpath can execute without Host code while its parent npm manifest still installs Host dependencies. Unpacking archives or copying selected declaration packages does not exercise package-manager resolution and cannot establish a mobile installation path.

## Decision

A DSH-owned build command produces a separate Client distribution from the generated portable facade's existing JavaScript and bundled declarations. Its dependency manifest retains the shared nominal Cordis, Brand and Typert identities and the declaration dependency on value primitives. The command packs the unpublished shared dependencies alongside the Client, after a clean committed-source build, and records their archive hashes and source revision. The frontend installs those archives with its own lockfile.

The [portable Connection decision](2026-09-15-portable-client-connections.md) continues to own transport injection and the shared runtime implementation. This distribution changes installation ownership only; it does not replace that decision or the full Remotes package's Host dependency declarations.

## Alternatives considered

**Remove Host dependencies from Remotes.** Its Host entry would become incorrectly declared even though the portable subpath worked.

**Copy schemas or strip package manifests in the frontend.** The consuming repository would become a second API or packaging authority.

**Bundle Cordis and nominal type identities.** Separate roots or declarations could disagree about the same service and branded values.

## Consequences

Consumers must install the supplied archives together and retain their lockfile. The generated Client archive is private until a separate publishing policy exists. A clean package-manager installation, strict typecheck and native bundle qualification establish the portable dependency closure; they do not establish authenticated physical-device behavior.
