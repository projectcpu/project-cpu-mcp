#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: worktree-cleanup.sh --target PATH [--source PATH] [--discard-changes] [--delete-branch]

--source defaults to the current directory and may be the hub or any linked worktree.
--discard-changes is required when tracked, untracked, or ignored work or an unmerged tree would be lost.
EOF
}

log() { printf '[worktree-cleanup] %s\n' "$*" >&2; }
fail() { log "refusing: $*"; exit 2; }

SOURCE=$PWD
TARGET=
DISCARD=0
DELETE_BRANCH=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || { usage; exit 2; }; SOURCE=$2; shift 2 ;;
    --target) [ "$#" -ge 2 ] || { usage; exit 2; }; TARGET=$2; shift 2 ;;
    --discard-changes) DISCARD=1; shift ;;
    --delete-branch) DELETE_BRANCH=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "unknown argument: $1" ;;
  esac
done

[ -n "$TARGET" ] || { usage; fail 'target is required'; }
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

if [ -e "$TARGET" ]; then
  [ -d "$TARGET" ] || fail "target is not a directory: $TARGET"
  target=$(cd "$TARGET" && pwd -P)
else
  target_parent=$(dirname "$TARGET")
  target_name=$(basename "$TARGET")
  [ "$target_name" != . ] && [ "$target_name" != .. ] || fail "target is unresolved: $TARGET"
  if [ -d "$target_parent" ]; then
    target=$(cd "$target_parent" && pwd -P)/$target_name
  else
    target_grandparent=$(dirname "$target_parent")
    [ -d "$target_grandparent" ] || fail "target parent does not exist: $target_parent"
    resolved_parent=$(cd "$target_grandparent" && pwd -P)/$(basename "$target_parent")
    [ "$resolved_parent" = "$expected_parent" ] || fail "target parent does not exist: $target_parent"
    target=$expected_parent/$target_name
  fi
fi

[ "$(dirname "$target")" = "$expected_parent" ] \
  || fail "target must be a direct child of $expected_parent (resolved: $target)"
[ "$target" != "$main_root" ] || fail 'the main checkout cannot be removed'
[ "$target" != "$expected_parent" ] || fail 'the worktree container cannot be removed'

record=$(git -C "$main_root" worktree list --porcelain | awk -v target="$target" '
  $1 == "worktree" { active = ($2 == target); block = $0 ORS; next }
  active { block = block $0 ORS }
  active && NF == 0 { printf "%s", block; active = 0; exit }
  END { if (active) printf "%s", block }
')

if printf '%s\n' "$record" | grep -Eq '^locked([[:space:]]|$)'; then
  fail 'target worktree is locked'
fi

if [ ! -e "$target" ]; then
  git -C "$main_root" worktree prune
  if git -C "$main_root" worktree list --porcelain | grep -Fqx "worktree $target"; then
    fail 'registration survived cleanup'
  fi
  log "target already absent; pruned any stale registration: $target"
  exit 0
fi

[ -n "$record" ] || fail 'target exists but is not a registered worktree'
target_root=$(git -C "$target" rev-parse --show-toplevel 2>/dev/null) \
  || fail 'target is not a usable Git worktree'
[ "$(cd "$target_root" && pwd -P)" = "$target" ] || fail 'target resolves to a nested repository'

branch=$(printf '%s\n' "$record" | sed -n 's#^branch refs/heads/##p' | head -n 1)
[ "$branch" != main ] || fail 'the main branch worktree cannot be removed'

dirty=$(git -C "$target" status --porcelain --untracked-files=all)
ignored=$(git -C "$target" ls-files --others --ignored --exclude-standard)
if { [ -n "$dirty" ] || [ -n "$ignored" ]; } && [ "$DISCARD" -ne 1 ]; then
  fail 'worktree has tracked, untracked, or ignored files; repeat with --discard-changes only after an explicit discard decision'
fi

base_ref=refs/heads/main
if git -C "$main_root" show-ref --verify --quiet refs/remotes/origin/main; then
  base_ref=refs/remotes/origin/main
fi
content_safe=1
if [ -n "$branch" ]; then
  content_ref=refs/heads/$branch
  content_label="branch $branch"
else
  content_ref=$(git -C "$target" rev-parse HEAD)
  content_label="detached HEAD $content_ref"
fi
if ! git -C "$main_root" merge-base --is-ancestor "$content_ref" "$base_ref" 2>/dev/null; then
  if git -C "$main_root" diff --quiet "$base_ref" "$content_ref" --; then
    log "$content_label is not ancestry-merged but its tree matches $base_ref"
  else
    content_safe=0
    [ "$DISCARD" -eq 1 ] \
      || fail "$content_label has unmerged content; repeat with --discard-changes only after an explicit discard decision"
  fi
fi

cd "$main_root"
remove_args=(worktree remove "$target")
if [ "$DISCARD" -eq 1 ]; then
  remove_args=(worktree remove --force "$target")
fi
if ! git -C "$main_root" "${remove_args[@]}"; then
  fail 'Git could not remove the worktree; target was preserved'
fi
git -C "$main_root" worktree prune

if git -C "$main_root" worktree list --porcelain | grep -Fqx "worktree $target"; then
  fail 'registration survived cleanup'
fi
[ ! -e "$target" ] || fail 'target directory survived cleanup'

if [ "$DELETE_BRANCH" -eq 1 ] && [ -n "$branch" ] \
  && git -C "$main_root" show-ref --verify --quiet "refs/heads/$branch"; then
  if [ "$content_safe" -eq 1 ] || [ "$DISCARD" -eq 1 ]; then
    git -C "$main_root" branch -D "$branch" >/dev/null
  else
    fail "branch $branch was preserved because its content is not merged"
  fi
fi

log "removed $target${branch:+ (branch $branch)}"
