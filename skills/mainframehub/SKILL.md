---
name: mainframehub
description: Use when the user asks about PR workflows, managing Claude workers, creating PRs, checking PR status, or orchestrating multiple agents. MainframeHub manages tmux-based PR sessions where each PR gets its own git worktree and Claude Code instance.
user-invocable: false
---

# MainframeHub — PR Orchestration via MCP

You have access to MainframeHub MCP tools for managing GitHub PR workflows. Each PR gets:
- A **git worktree** (shallow clone of the repo on a feature branch)
- A **tmux session** named `pr-{number}`
- A **Claude Code instance** running inside that tmux session

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `mfh_list_prs` | List all PRs grouped by status: active session, has clone, not set up, closed with clone |
| `mfh_session_states` | Get tmux session details with git info and PR associations |
| `mfh_create_pr` | Create a new PR — clones repo, creates branch, opens draft PR, starts Claude |
| `mfh_setup_pr` | Set up a local worktree + tmux session for an existing GitHub PR |
| `mfh_close_pr` | Close a PR, kill its tmux session, remove the worktree |
| `mfh_merge_pr` | Merge a PR on GitHub (squash/merge/rebase) |
| `mfh_get_session_output` | Read recent terminal output from a worker's tmux session (ANSI-stripped) |
| `mfh_resume_session` | Resume Claude in a tmux session with `claude --resume <id>` |
| `mfh_send_keys` | Send text to a tmux session (followed by Enter) — talk to a worker Claude |
| `mfh_worker_status` | Check which workers are running vs finished (by inspecting tmux pane process) |
| `mfh_attach_session` | Get the `tmux attach` command for a session (informational for the user) |

## Key Concepts

- **Worker Claude**: A Claude Code instance running in a tmux session, working on a specific PR. Each worker has its own worktree and conversation.
- **Session ID**: Tmux session name, always `pr-{number}` (e.g. `pr-42`).
- **Supervisor pattern**: You (the supervisor) create PRs, monitor workers via `mfh_worker_status` and `mfh_get_session_output`, and give them instructions via `mfh_send_keys`.
- **Worker status**: A worker is "running" if its tmux pane shows `claude` or `node`. It's "finished" when the shell (`bash`/`zsh`) is the foreground process — meaning Claude exited.

## Workflow Patterns

### Creating work
1. Use `mfh_create_pr` with a clear prompt describing what to implement
2. The worker Claude starts automatically in the new tmux session
3. Monitor progress with `mfh_worker_status` or `mfh_get_session_output`

### Checking on workers
1. Use `mfh_worker_status` for a quick running/finished overview of all sessions
2. Use `mfh_get_session_output` with a session ID to read what a specific worker is doing
3. The output is clean prose (ANSI codes stripped) — you can understand it directly

### Giving instructions
1. Use `mfh_send_keys` to type a message into a worker's tmux session
2. The worker Claude will see your message and respond
3. Use this to redirect work, ask for changes, or provide clarification

### Finishing work
1. Use `mfh_merge_pr` when a PR is ready (default: squash merge)
2. Use `mfh_close_pr` to abandon a PR and clean up its worktree

### Orchestrating multiple workers
1. Use `/mfh-orchestrate` for guided multi-agent workflows
2. Or manually: create PRs with `mfh_create_pr`, poll with `mfh_worker_status`, read results with `mfh_get_session_output`
3. Maximum 5 concurrent workers recommended
