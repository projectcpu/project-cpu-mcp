#!/usr/bin/env bash
set -euo pipefail

log() { printf '[worktree-remove] %s\n' "$*" >&2; }
field() { WT_INPUT="$INPUT" node -e 'process.stdout.write(String((JSON.parse(process.env.WT_INPUT||"{}")[process.argv[1]])||""))' "$1"; }

INPUT=$(cat)
WT=$(field worktree_path)
CWD=$(field cwd)
[ -n "$WT" ] || { log 'missing worktree_path'; exit 1; }

ROOT=$(cd "${CWD:-$WT}" && git rev-parse --show-toplevel)
exec bash "$ROOT/tools/harness/worktree-cleanup.sh" --source "$ROOT" --target "$WT"
