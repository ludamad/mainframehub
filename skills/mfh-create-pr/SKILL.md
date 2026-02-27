---
name: mfh-create-pr
description: Create a new GitHub PR with a worker Claude agent
model: haiku
argument-hint: <description of what the PR should do>
---

Create a new PR using MainframeHub. Call the `mfh_create_pr` MCP tool with:
- `prompt`: $ARGUMENTS (the user's description of what to implement)
- `baseBranch`: optional, defaults to `main`

After creating, report:
1. The PR number and URL
2. The tmux session ID (e.g. `pr-42`)
3. Confirm that the worker Claude has started

If the user wants multiple PRs, create them sequentially and report each one.
