#!/bin/sh
set -eu

if [ "${1:-}" = "--version" ]; then
  printf '%s\n' 'dsh-acp-paseo-replay 0.0.1'
  exit 0
fi

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIRECTORY/../../../../.." && pwd)

export DSH_SNAPSHOT=replay
export DSH_SNAPSHOT_FILE="$REPOSITORY_ROOT/snapshots/session/text-turn/session.v1.jsonl"
export DSH_SNAPSHOT_SESSIONS_ROOT="${PASEO_DSH_POC_STATE_DIR:-$REPOSITORY_ROOT/tmp/paseo-dsh-poc/dsh-sessions}"
export DSH_PERMISSION_MODE="${DSH_PERMISSION_MODE:-workspace-write}"

cd "$REPOSITORY_ROOT"
exec node \
  apps/cli/lib/bin.js \
  --profile acp \
  --config apps/cli/config/examples/paseo/cordis.yml
