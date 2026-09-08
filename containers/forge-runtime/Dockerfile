# syntax=docker/dockerfile:1.7

# Named contexts contain exact Git revisions. KEEP_GIT_DIR supports Compose's
# remote contexts; the local release script supplies a self-contained bundle.
FROM rust:1.97-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3 AS spec-source
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates cmake git libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
ARG FORGE_SPEC_REF=33f3794e89895b61c3fbe6bddc866a7dd5b577cc
COPY --from=forge-spec . /context/forge-spec/
RUN if [ -f /context/forge-spec/.forge-source.bundle ]; then \
        git clone --bare /context/forge-spec/.forge-source.bundle /opt/forge-spec.git; \
    elif [ -d /context/forge-spec/.git ]; then \
        git clone --bare /context/forge-spec /opt/forge-spec.git; \
    else \
        echo 'The pinned forge-spec context needs Git metadata or .forge-source.bundle' >&2; exit 1; \
    fi \
    && test "$(git --git-dir=/opt/forge-spec.git rev-parse "$FORGE_SPEC_REF^{commit}")" = "$FORGE_SPEC_REF" \
    && mkdir -p /src/forge-spec \
    && git --git-dir=/opt/forge-spec.git archive --format=tar --output=/tmp/spec-source.tar "$FORGE_SPEC_REF" \
    && tar -xf /tmp/spec-source.tar -C /src/forge-spec \
    && rm /tmp/spec-source.tar
# Redirect transport only: Cargo.toml and Cargo.lock retain the upstream Git
# source and exact revision, including when that commit is not published yet.
RUN git config --global url.file:///opt/forge-spec.git.insteadOf https://github.com/daedal-one/forge-spec.git
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true CARGO_TARGET_DIR=/build

FROM spec-source AS spec-builder
WORKDIR /src/forge-spec
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    cargo build --manifest-path spec-cli/Cargo.toml --locked --release --bin spec \
    && /build/release/spec --version | grep -Fx 'spec 0.8.0'

FROM spec-builder AS intellect-builder
ARG FORGE_INTELLECT_REF
WORKDIR /src/forge-intellect
COPY --from=forge-intellect . .
RUN test -n "$FORGE_INTELLECT_REF" \
    && grep -F "rev = \"$FORGE_SPEC_REF\"" crates/spec-projector/Cargo.toml
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    cargo build --locked --release -p forge-intellect-cli -p forge-intellect-action-mcp

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        git \
        musl-tools \
        python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/deepseek-harness
COPY . .
RUN --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable \
    && corepack prepare pnpm@11.7.0 --activate \
    && pnpm install --frozen-lockfile \
    && pnpm --dir native/landlock-run run build:native \
    && pnpm run build
RUN --mount=type=cache,target=/root/.cache \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    find . -path '*/node_modules/*' -type l -print0 \
        | tar --null --files-from=- --create --file=/tmp/node-modules-links.tar \
    && CI=true pnpm prune --prod --ignore-scripts \
    && tar --extract --file=/tmp/node-modules-links.tar \
    && rm -rf .github .changeset containers docs scripts website \
    && find . -type f \( -name '*.tsbuildinfo' -o -name '*.map' \) -delete

FROM oven/bun:1.3.11@sha256:0733e50325078969732ebe3b15ce4c4be5082f18c4ac1a0f0ca4839c2e4e42a7 AS bun-tools
FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c AS python-tools

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        git \
        libssl-dev \
        libsqlite3-0 \
        libffi8 \
        libbz2-1.0 \
        liblzma5 \
        libreadline8 \
        libuuid1 \
        openssh-client \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/deepseek-harness /opt/deepseek-harness
COPY --from=intellect-builder /build/release/forge-intellect-action-mcp /usr/local/bin/forge-intellect-action-mcp
COPY --from=intellect-builder /build/release/forge-intellect /usr/local/bin/forge-intellect
COPY --from=spec-builder /build/release/spec /usr/local/bin/spec
COPY --from=spec-source /usr/local/rustup /usr/local/rustup
COPY --from=spec-source /usr/local/cargo/bin /usr/local/cargo/bin
COPY --from=bun-tools /usr/local/bin/bun /usr/local/bin/bun
COPY --from=python-tools /usr/local/bin/python3.12 /usr/local/bin/python3.12
COPY --from=python-tools /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=python-tools /usr/local/lib/libpython3.12.so.1.0 /usr/local/lib/libpython3.12.so.1.0
COPY --from=ghcr.io/astral-sh/uv:0.11.3@sha256:90bbb3c16635e9627f49eec6539f956d70746c409209041800a0280b93152823 /uv /uvx /usr/local/bin/
ENV RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/tmp/forge-cargo \
    BUN_INSTALL_CACHE_DIR=/tmp/forge-bun UV_CACHE_DIR=/tmp/forge-uv COREPACK_HOME=/usr/local/share/corepack
RUN ldconfig && ln -s python3.12 /usr/local/bin/python3 && ln -s python3.12 /usr/local/bin/python \
    && ln -s bun /usr/local/bin/bunx \
    && corepack enable && corepack prepare pnpm@11.7.0 --activate
RUN for tool in cargo rustc rustdoc rustfmt cargo-fmt cargo-clippy clippy-driver; do \
        printf '#!/bin/sh\nexport RUSTUP_HOME=/usr/local/rustup\nexport CARGO_HOME="${TMPDIR:-/tmp}/forge-cargo"\nexec /usr/local/cargo/bin/%s "$@"\n' "$tool" > "/usr/local/bin/$tool"; \
        chmod 0755 "/usr/local/bin/$tool"; \
    done \
    && rm /usr/local/bin/pnpm \
    && printf '#!/bin/sh\nexport COREPACK_HOME=/usr/local/share/corepack\nexec node /usr/local/lib/node_modules/corepack/dist/pnpm.js "$@"\n' > /usr/local/bin/pnpm \
    && chmod 0755 /usr/local/bin/pnpm \
    && spec --version && env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR=/tmp rustc --version \
    && env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR=/tmp cargo --version \
    && env -i PATH=/usr/local/bin:/usr/bin:/bin TMPDIR=/tmp pnpm --version \
    && bun --version && python --version && uv --version
RUN chmod 0755 /opt/deepseek-harness/apps/cli/lib/bin.js \
    && ln -s /opt/deepseek-harness/apps/cli/lib/bin.js /usr/local/bin/dsh

ARG VCS_REF=unknown
ARG FORGE_SPEC_REF
ARG FORGE_INTELLECT_REF
LABEL org.opencontainers.image.source="https://github.com/daedal-one/deepseek-harness" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.title="DeepSeek Harness Forge runtime" \
      io.daedal-one.forge-spec.revision="$FORGE_SPEC_REF" \
      io.daedal-one.forge-intellect.revision="$FORGE_INTELLECT_REF"

WORKDIR /opt/deepseek-harness/examples/forge-adapter
CMD ["node", "/opt/deepseek-harness/vendor/cordis/bin.js"]
