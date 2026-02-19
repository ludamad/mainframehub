---
name: mfh-monitor
description: Read terminal output from a MainframeHub worker session to see what it's doing
model: haiku
argument-hint: <session-id, e.g. pr-42>
---

Read the recent output from a worker Claude's tmux session. Call `mfh_get_session_output` with:
- `sessionId`: $ARGUMENTS (e.g. `pr-42`)
- `lines`: 100 (default, increase if needed)

Summarize what the worker is doing in 2-3 sentences:
- What task is it working on?
- Is it making progress or stuck?
- Has it committed anything?

If no session ID is provided, first call `mfh_list_prs` to show active sessions and ask which one to monitor.
