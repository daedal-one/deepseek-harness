# syntax=docker/dockerfile:1.7

# The action gateway is compiled from the exact Forge Intellect build context
# that introduced the command-wrapper contract used by this adapter.
FROM rust:1.97-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3 AS intellect-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        libssl-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY --from=forge-intellect . .
RUN cargo build --locked --release -p forge-intellect-action-mcp

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

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        git \
        openssh-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/deepseek-harness /opt/deepseek-harness
COPY --from=intellect-builder /src/target/release/forge-intellect-action-mcp /usr/local/bin/forge-intellect-action-mcp
RUN chmod 0755 /opt/deepseek-harness/apps/cli/lib/bin.js \
    && ln -s /opt/deepseek-harness/apps/cli/lib/bin.js /usr/local/bin/dsh

ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/daedal-one/deepseek-harness" \
      org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.title="DeepSeek Harness Forge runtime"

WORKDIR /opt/deepseek-harness/examples/forge-adapter
CMD ["node", "/opt/deepseek-harness/vendor/cordis/bin.js"]
