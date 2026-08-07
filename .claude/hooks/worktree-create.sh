#!/usr/bin/env bash
# Claude Code WorktreeCreate hook — pnpm single-package repo.
# stdin JSON: { name, cwd, ... }. stdout: ABSOLUTE worktree path ONLY (everything else → stderr).
# Non-zero exit aborts worktree creation.
set -euo pipefail

# All stdout → stderr; restore real stdout on fd 3 for the final path emit.
exec 3>&1 1>&2

log() { printf '[worktree-create] %s\n' "$*" >&2; }

# JSON parsing via node (guaranteed runtime — no jq dependency).
field() { WT_INPUT="$INPUT" node -e 'process.stdout.write(String((JSON.parse(process.env.WT_INPUT||"{}")[process.argv[1]])||""))' "$1"; }

INPUT=$(cat)
NAME=$(field name); CWD=$(field cwd)
[ -n "$NAME" ] && [ -n "$CWD" ] || { log "missing name/cwd"; exit 1; }

# Hub root — resolved so it is the hub whether the hook runs from the hub or from inside a worktree.
# --show-toplevel would return the worktree's own root there, doubling the mcp-worktrees/ segment below.
# --git-common-dir points at the hub's .git from both, and may be relative — cd resolves either form.
REPO_ROOT=$(cd "$CWD" && cd "$(git rev-parse --git-common-dir)/.." && pwd)
# Branch: honor a conventional type prefix if the name carries one, else default to feat/.
case "$NAME" in
  feat/*|fix/*|chore/*|refactor/*|test/*|docs/*|perf/*|ci/*|build/*|revert/*) BRANCH="$NAME" ;;
  *) BRANCH="feat/$NAME" ;;
esac
SLUG=$(printf '%s' "$BRANCH" | tr '/' '-')             # e.g. fix/login → fix-login (dir name)
WT="$(cd "$REPO_ROOT/.." && pwd)/mcp-worktrees/$SLUG"

# Local (gitignored) files to copy into the worktree. Add new local-only paths here.
ENV_FILES=( .env .env.local CLAUDE.local.md )

# Re-entry: `claude --worktree <branch>` calls this hook on every launch, so a registered worktree for the
# branch is reused as-is (no add, no reinstall) — that is what lets a restarted session land inside it.
EXISTING=$(git -C "$REPO_ROOT" worktree list --porcelain |
  awk -v b="refs/heads/$BRANCH" '$1=="worktree"{p=$2} $1=="branch" && $2==b {print p; exit}')
if [ -n "$EXISTING" ]; then
  log "reusing registered worktree $EXISTING (branch $BRANCH)"
  printf '%s\n' "$EXISTING" >&3
  exit 0
fi

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  # Branch survived its deleted checkout: check it out instead of branching, or -b aborts and the
  # branch's commits stay stranded with no working tree.
  log "branch $BRANCH exists without a worktree — checking it out"
  git -C "$REPO_ROOT" worktree add "$WT" "$BRANCH" >&2
else
  # Branch from current HEAD (main = hub per CLAUDE.md). git errors loudly if the path exists → aborts.
  git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WT" >&2
fi

for rel in "${ENV_FILES[@]}"; do
  [ -f "$REPO_ROOT/$rel" ] && { mkdir -p "$WT/$(dirname "$rel")"; cp -p "$REPO_ROOT/$rel" "$WT/$rel"; }
done

# Install deps so the worktree is buildable. Frozen: branch is off the committed lockfile.
# On failure, drop the half-made worktree and abort.
if ! (cd "$WT" && pnpm install --frozen-lockfile) >&2; then
  git -C "$REPO_ROOT" worktree remove --force "$WT" >&2 || true
  exit 1
fi

printf '%s\n' "$WT" >&3
