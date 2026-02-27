---
name: mfh-talk
description: Send a message to a MainframeHub worker Claude in a tmux session
model: haiku
argument-hint: <session-id> <message>
---

Send a message to a worker Claude. Parse $ARGUMENTS as:
- First word: session ID (e.g. `pr-42`)
- Remaining words: the message to send

Call `mfh_send_keys` with the session ID and message text. The message is sent to the tmux session followed by Enter, so the worker Claude will see it as user input.

After sending, briefly confirm what was sent and to which session.

If only a session ID is provided with no message, read the session output first with `mfh_get_session_output` and ask the user what they want to say.
