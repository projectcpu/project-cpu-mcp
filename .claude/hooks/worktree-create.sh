#!/usr/bin/env bash
set -euo pipefail

log() { printf '[worktree-create] %s\n' "$*" >&2; }
field() { WT_INPUT="$INPUT" node -e 'process.stdout.write(String((JSON.parse(process.env.WT_INPUT||"{}")[process.argv[1]])||""))' "$1"; }

INPUT=$(cat)
NAME=$(field name)
CWD=$(field cwd)
[ -n "$NAME" ] && [ -n "$CWD" ] || { log 'missing name/cwd'; exit 1; }

ROOT=$(cd "$CWD" && git rev-parse --show-toplevel)
exec bash "$ROOT/tools/harness/worktree-create.sh" --name "$NAME" --source "$CWD"
