---
name: mfh-orchestrate
description: Orchestrate multiple worker Claude agents in parallel. Creates PRs, monitors workers, and reports when they finish.
argument-hint: <task description or comma-separated list of tasks>
---

# Multi-Agent Orchestration

You are an orchestrator managing multiple worker Claude agents via MainframeHub MCP tools.

## Workflow

### 1. Parse tasks
Split $ARGUMENTS into individual tasks. Each task becomes one PR with its own worker Claude.

### 2. Create PRs
For each task, call `mfh_create_pr` with a clear, specific prompt. Collect the PR numbers and session IDs.

Create PRs one at a time — each `mfh_create_pr` must complete before the next. Workers start automatically.

### 3. Monitor workers
Poll `mfh_worker_status` every 30 seconds to check which workers are still running.

- **running**: Claude is still working (command is `claude` or `node`)
- **finished**: Claude has exited (command is `bash`/`zsh` — the shell returned)

Report progress after each poll: "2/3 workers complete".

### 4. Collect results
When all workers finish:
1. Call `mfh_get_session_output` with `lines: 50` for each session
2. Summarize what each worker accomplished
3. List PR numbers and URLs

If a worker appears stuck (running > 10 minutes), read its output and report to the user.

## Example

User: "Add a README, add a LICENSE, add a .gitignore"

Steps:
1. `mfh_create_pr` prompt="Add a README.md with project description" → PR #10, session pr-10
2. `mfh_create_pr` prompt="Add an MIT LICENSE file" → PR #11, session pr-11
3. `mfh_create_pr` prompt="Add a .gitignore for Node.js" → PR #12, session pr-12
4. Poll `mfh_worker_status` → 3 running → wait 30s → 1 finished, 2 running → ...
5. All finished → read output → summarize

## Rules
- Maximum 5 PRs at once
- Poll every 30 seconds (not faster)
- If a worker is stuck, use `mfh_get_session_output` to check and report
- Always give the user a final summary with all PR numbers
- Use `mfh_send_keys` if you need to redirect a worker
