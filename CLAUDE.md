@AGENTS.md

Use `EnterWorktree` or `claude --worktree <type>/<slug>` to create or re-enter worktrees; this runs
`.claude/hooks/worktree-create.sh`, which delegates to the shared lifecycle command. A name without a
conventional type prefix becomes `feat/<name>`.

Use `ExitWorktree(action: "remove")` for teardown. If the repository cleanup hook refuses dirty or
unmerged state, the worktree remains available. Ask for the explicit discard decision and, only after
the session has left that worktree, run
`bash tools/harness/worktree-cleanup.sh --target PATH --source PATH --discard-changes` directly from
the hub or another registered worktree. `WorktreeRemove` has no discard input. The hook delegates only
safe automatic cleanup to the shared containment-safe interface.
