#!/usr/bin/env bash
# Claude Code WorktreeRemove hook. stdin JSON: { worktree_path, cwd, ... }.
# Best-effort cleanup; never force-destroy uncommitted work; never touch paths outside our container.
set -uo pipefail

log() { printf '[worktree-remove] %s\n' "$*" >&2; }

INPUT=$(cat)
field() { WT_INPUT="$INPUT" node -e 'process.stdout.write(String((JSON.parse(process.env.WT_INPUT||"{}")[process.argv[1]])||""))' "$1"; }
WT=$(field worktree_path)
CWD=$(field cwd)
[ -n "$WT" ] || { log "no worktree_path"; exit 0; }

# Safety: only ever remove inside .../mcp-worktrees/
case "$WT" in
  */mcp-worktrees/*) ;;
  *) log "refusing to remove non-container path: $WT"; exit 0 ;;
esac

REPO_ROOT=$(cd "${CWD:-$WT}" && git rev-parse --show-toplevel 2>/dev/null || echo "")
# No --force: if there are uncommitted tracked changes, git refuses and we leave it for the user.
if git ${REPO_ROOT:+-C "$REPO_ROOT"} worktree remove "$WT" >&2 2>/dev/null; then
  removed=1; log "removed $WT"
else
  removed=0; log "left $WT (uncommitted changes or committed work) — remove manually if needed"
fi
git ${REPO_ROOT:+-C "$REPO_ROOT"} worktree prune >&2 2>/dev/null || true

# git worktree remove can leave behind ignored dirs an IDE holds open (e.g. .idea), so the worktree
# folder lingers empty. If removal succeeded but the dir survives, drop the residual shell.
# Safe: $WT is verified inside .../mcp-worktrees/ above, and we only rm when git confirmed removal.
if [ "$removed" = 1 ] && [ -d "$WT" ]; then
  rm -rf "$WT" && log "cleaned residual dir $WT"
fi
exit 0
