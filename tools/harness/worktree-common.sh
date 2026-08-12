#!/usr/bin/env bash

# This inventory is consumed by scripts that source this file.
# shellcheck disable=SC2034
HARNESS_LOCAL_FILES=(.env .env.local CLAUDE.local.md)

resolve_harness_roots() {
  local source=$1
  local common_dir

  common_dir=$(git -C "$source" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || fail "source is not a Git worktree: $source"
  case "$common_dir" in
    /*) ;;
    *) common_dir=$(cd "$source/$common_dir" && pwd -P) ;;
  esac
  main_root=$(dirname "$common_dir")
  main_root=$(cd "$main_root" && pwd -P)
  expected_parent=$(cd "$(dirname "$main_root")" && pwd -P)/mcp-worktrees
}

resolve_worktree_container() {
  local create=$1
  local resolved_parent

  [ ! -L "$expected_parent" ] || fail "worktree container cannot be a symlink: $expected_parent"
  if [ -e "$expected_parent" ]; then
    [ -d "$expected_parent" ] || fail "worktree container is not a directory: $expected_parent"
  elif [ "$create" -eq 1 ]; then
    mkdir -p "$expected_parent"
  fi

  if [ -d "$expected_parent" ]; then
    resolved_parent=$(cd "$expected_parent" && pwd -P)
    [ "$resolved_parent" = "$expected_parent" ] \
      || fail "worktree container resolves outside its expected path: $expected_parent"
    expected_parent=$resolved_parent
  fi
}

registered_worktree_for_branch() {
  local branch=$1

  git -C "$main_root" worktree list --porcelain | awk -v branch="refs/heads/$branch" '
    $1 == "worktree" { path = substr($0, 10) }
    $1 == "branch" && $2 == branch { print path; exit }
  '
}

worktree_path_is_registered() {
  local target=$1

  git -C "$main_root" worktree list --porcelain | grep -Fqx "worktree $target"
}
