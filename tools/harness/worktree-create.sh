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

harness_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=tools/harness/worktree-common.sh
source "$harness_dir/worktree-common.sh"

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

resolve_harness_roots "$SOURCE"

case "$NAME" in
  feat/*|fix/*|chore/*|refactor/*|test/*|docs/*|perf/*|ci/*|build/*|revert/*) branch=$NAME ;;
  *) branch=feat/$NAME ;;
esac
branch_pattern='^(feat|fix|chore|refactor|test|docs|perf|ci|build|revert)/[a-z0-9]+(-[a-z0-9]+)*$'
[[ "$branch" =~ $branch_pattern ]] \
  || fail "branch must match <type>/<kebab-slug>: $branch"
resolve_worktree_container 1
slug=$(printf '%s' "$branch" | tr '/' '-')
target=$expected_parent/$slug

existing=$(registered_worktree_for_branch "$branch")
if [ -n "$existing" ]; then
  [ -d "$existing" ] || fail "registered worktree is unavailable: $existing"
  [ ! -L "$existing" ] || fail "registered worktree cannot be a symlink: $existing"
  existing=$(cd "$existing" && pwd -P)
  [ "$existing" = "$target" ] \
    || fail "registered worktree is outside the expected path: $existing (expected: $target)"
  log "reusing registered worktree $existing (branch $branch)"
  printf '%s\n' "$existing"
  exit 0
fi

if git -C "$main_root" show-ref --verify --quiet "refs/heads/$branch"; then
  log "branch $branch exists without a worktree; checking it out"
  git -C "$main_root" worktree add "$target" "$branch" >&2
else
  log "creating branch $branch from the hub revision"
  git -C "$main_root" worktree add -b "$branch" "$target" >&2
fi

created=1
ready=0
rollback_created_worktree() {
  local exit_status=$?
  local rollback_failed=0

  trap - EXIT
  if [ "$created" -eq 1 ] && [ "$ready" -ne 1 ]; then
    log "creation failed; rolling back $target"
    git -C "$main_root" worktree remove --force "$target" >&2 \
      || { log 'Git could not remove the failed worktree'; rollback_failed=1; }
    git -C "$main_root" worktree prune >&2 \
      || { log 'Git could not prune failed worktree registration'; rollback_failed=1; }
    if [ -e "$target" ] || worktree_path_is_registered "$target"; then
      log "rollback incomplete; inspect $target and its Git registration"
      rollback_failed=1
    fi
  fi
  if [ "$rollback_failed" -eq 1 ]; then
    exit 1
  fi
  exit "$exit_status"
}
trap rollback_created_worktree EXIT

for rel in "${HARNESS_LOCAL_FILES[@]}"; do
  if [ -f "$main_root/$rel" ]; then
    mkdir -p "$target/$(dirname "$rel")"
    cp -p "$main_root/$rel" "$target/$rel"
  fi
done

if ! (cd "$target" && pnpm install --frozen-lockfile) >&2; then
  log 'dependency installation failed'
  exit 1
fi

ready=1
trap - EXIT
printf '%s\n' "$target"
