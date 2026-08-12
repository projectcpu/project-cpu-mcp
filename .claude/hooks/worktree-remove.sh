#!/usr/bin/env bash
set -euo pipefail

log() { printf '[worktree-remove] %s\n' "$*" >&2; }
field() { WT_INPUT="$INPUT" node -e 'process.stdout.write(String((JSON.parse(process.env.WT_INPUT||"{}")[process.argv[1]])||""))' "$1"; }

INPUT=$(cat)
WT=$(field worktree_path)
CWD=$(field cwd)
DISCARD=$(field discard_changes)
DELETE_BRANCH=$(field delete_branch)
[ -n "$WT" ] || { log 'missing worktree_path'; exit 1; }

ROOT=$(cd "${CWD:-$WT}" && git rev-parse --show-toplevel)
args=(--source "$ROOT" --target "$WT")
case "$DISCARD" in true|1) args+=(--discard-changes) ;; esac
case "$DELETE_BRANCH" in true|1) args+=(--delete-branch) ;; esac
exec bash "$ROOT/tools/harness/worktree-cleanup.sh" "${args[@]}"
