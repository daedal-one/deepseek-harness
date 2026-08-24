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
