@AGENTS.md

Use `EnterWorktree` or `claude --worktree <type>/<slug>` to create or re-enter worktrees; this runs
`.claude/hooks/worktree-create.sh`, which delegates to the shared lifecycle command. A name without a
conventional type prefix becomes `feat/<name>`.

Use `ExitWorktree(action: "remove")` for teardown. If the repository cleanup hook refuses dirty or
unmerged state, ask for the explicit discard decision and only then repeat with
`discard_changes: true`. The hook delegates to the shared containment-safe cleanup interface.
