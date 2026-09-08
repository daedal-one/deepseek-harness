#!/bin/sh
# Fixed native tools remain readable under Landlock; caches stay in lease TMPDIR.
set -eu
export HOME="${TMPDIR:-/tmp}/forge-home"
export XDG_CACHE_HOME="${TMPDIR:-/tmp}/forge-cache"
export XDG_DATA_HOME="${TMPDIR:-/tmp}/forge-data"
export XDG_CONFIG_HOME="${TMPDIR:-/tmp}/forge-config"
export RUSTUP_HOME=/usr/local/rustup
export CARGO_HOME="${TMPDIR:-/tmp}/forge-cargo"
export COREPACK_HOME=/usr/local/share/corepack
export BUN_INSTALL_CACHE_DIR="$XDG_CACHE_HOME/bun"
export UV_CACHE_DIR="$XDG_CACHE_HOME/uv"
export UV_PYTHON_INSTALL_DIR="$XDG_DATA_HOME/uv/python"
export UV_TOOL_DIR="$XDG_DATA_HOME/uv/tools"
export UV_TOOL_BIN_DIR="$HOME/.local/bin"
mkdir -p "$HOME" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$CARGO_HOME"
tool=$(basename "$0")
case "$tool" in
    cargo|rustc|rustdoc|rustfmt|cargo-fmt|cargo-clippy|clippy-driver)
        exec "/usr/local/cargo/bin/$tool" "$@" ;;
    bun|uv|uvx)
        exec "/usr/local/lib/forge-tools/$tool" "$@" ;;
    bunx)
        exec /usr/local/lib/forge-tools/bun x "$@" ;;
    pnpm)
        exec node /usr/local/lib/node_modules/corepack/dist/pnpm.js "$@" ;;
    *)
        echo "Unsupported Forge toolchain entry point: $tool" >&2
        exit 2 ;;
esac
