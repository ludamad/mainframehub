---
name: mfh-status
description: Show status of all MainframeHub PRs and worker sessions
model: haiku
---

Check the status of all PRs and worker sessions. Call `mfh_list_prs` and `mfh_session_states` MCP tools.

Present a concise summary:
- **Active workers**: PRs with running tmux sessions — show PR number, title, branch
- **Cloned (idle)**: PRs with worktrees but no active session
- **Not set up**: PRs on GitHub with no local worktree
- **Stale**: Closed PRs that still have local worktrees (suggest cleanup)

Keep the output brief — one line per PR.
