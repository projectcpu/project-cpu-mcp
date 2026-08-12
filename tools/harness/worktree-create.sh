#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: worktree-create.sh --name NAME [--source PATH]

--source defaults to the current directory and may be the hub or any linked worktree.
EOF
}

log() { printf '[worktree-create] %s\n' "$*" >&2; }
fail() { log "refusing: $*"; exit 2; }

SOURCE=$PWD
NAME=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || { usage; exit 2; }; SOURCE=$2; shift 2 ;;
    --name) [ "$#" -ge 2 ] || { usage; exit 2; }; NAME=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "unknown argument: $1" ;;
  esac
done

[ -n "$NAME" ] || { usage; fail 'name is required'; }
[ -d "$SOURCE" ] || fail "source does not exist: $SOURCE"

common_dir=$(git -C "$SOURCE" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
  || fail "source is not a Git worktree: $SOURCE"
case "$common_dir" in
  /*) ;;
  *) common_dir=$(cd "$SOURCE/$common_dir" && pwd -P) ;;
esac
main_root=$(dirname "$common_dir")
main_root=$(cd "$main_root" && pwd -P)
expected_parent=$(cd "$(dirname "$main_root")" && pwd -P)/mcp-worktrees

case "$NAME" in
  feat/*|fix/*|chore/*|refactor/*|test/*|docs/*|perf/*|ci/*|build/*|revert/*) branch=$NAME ;;
  *) branch=feat/$NAME ;;
esac
git check-ref-format --branch "$branch" >/dev/null 2>&1 || fail "invalid branch name: $branch"
slug=$(printf '%s' "$branch" | tr '/' '-')
target=$expected_parent/$slug

existing=$(git -C "$main_root" worktree list --porcelain |
  awk -v branch="refs/heads/$branch" '$1 == "worktree" { path = $2 } $1 == "branch" && $2 == branch { print path; exit }')
if [ -n "$existing" ]; then
  log "reusing registered worktree $existing (branch $branch)"
  printf '%s\n' "$existing"
  exit 0
fi

mkdir -p "$expected_parent"
if git -C "$main_root" show-ref --verify --quiet "refs/heads/$branch"; then
  log "branch $branch exists without a worktree; checking it out"
  git -C "$main_root" worktree add "$target" "$branch" >&2
else
  log "creating branch $branch from the hub revision"
  git -C "$main_root" worktree add -b "$branch" "$target" >&2
fi

ENV_FILES=(.env .env.local CLAUDE.local.md)
for rel in "${ENV_FILES[@]}"; do
  if [ -f "$main_root/$rel" ]; then
    mkdir -p "$target/$(dirname "$rel")"
    cp -p "$main_root/$rel" "$target/$rel"
  fi
done

if ! (cd "$target" && pnpm install --frozen-lockfile) >&2; then
  log "dependency installation failed; rolling back $target"
  git -C "$main_root" worktree remove --force "$target" >&2 || true
  exit 1
fi

printf '%s\n' "$target"
