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

REPO_ROOT=$(cd "$CWD" && git rev-parse --show-toplevel)
# Branch: honor a conventional type prefix if the name carries one, else default to feat/.
case "$NAME" in
  feat/*|fix/*|chore/*|refactor/*|test/*|docs/*|perf/*|ci/*|build/*|revert/*) BRANCH="$NAME" ;;
  *) BRANCH="feat/$NAME" ;;
esac
SLUG=$(printf '%s' "$BRANCH" | tr '/' '-')             # e.g. fix/login → fix-login (dir name)
WT="$(cd "$REPO_ROOT/.." && pwd)/mcp-worktrees/$SLUG"

# Local (gitignored) files to copy into the worktree. Add new local-only paths here.
ENV_FILES=( .env .env.local CLAUDE.local.md )

# Branch from current HEAD (main = hub per CLAUDE.md). git errors loudly if path/branch exists → aborts.
git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WT" >&2

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
