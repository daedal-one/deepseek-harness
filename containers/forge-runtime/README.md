# Forge runtime image

This image is the shared release carrier for the Forge session adapter and the
DeepSeek Harness Web profile. It contains built Harness packages, the native
Landlock launcher for the target platform, and the compatible
`forge-intellect-action-mcp` binary.

The default command boots `examples/forge-adapter/cordis.yml`. Forge's Web
service overrides it with the built `dsh --profile web` command. Builds must
provide the exact Forge Intellect checkout as the named `forge-intellect` build
context and publish an immutable digest; the Forge Compose overlay accepts no
mutable tag-only image reference.

The image also supplies the native development tools used by Forge: Forge Spec
0.8.0, Forge Intellect, Rust/Cargo 1.97, Bun 1.3.11, Python 3.12, uv 0.11.3 and
pnpm 11.7.0. Toolchain roots are immutable; temporary package caches live under
`/tmp`. Project sources and durable session state remain deployment-owned
volumes. Building Forge does not require mounting the host Docker socket into
the coding process; image builds and deployment remain operator actions.

Builds additionally require the exact `forge-spec` Git context or a
`.forge-source.bundle`, and full `FORGE_SPEC_REF` and `FORGE_INTELLECT_REF` build
arguments. Cargo keeps the upstream dependency identity and resolves the
selected Forge Spec commit through a local transport mirror. The resulting
image labels record all three source revisions. The Forge release builder runs
a no-network, read-only-root toolchain smoke check before returning local image
identities.
