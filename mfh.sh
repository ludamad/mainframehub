#!/usr/bin/env bash
set -euo pipefail

# MainframeHub — tmux-based PR orchestration with Claude Code.
#
# Starts the standalone HTTP server, creates an mfh-main tmux session
# with a controlling Claude, and manages focus switching between sessions.
#
# Usage:
#   ./mfh.sh /path/to/repo
#
# When Claude calls mfh_focus_session, this script automatically switches
# your terminal to that tmux session. Exiting a worker session returns
# you to mfh-main. Exiting mfh-main quits the script.
#
# Prerequisites:
#   - gh auth login (GitHub CLI authenticated)
#   - claude CLI installed and authenticated
#   - tmux installed
#   - npm dependencies installed (npm install)

REPO_PATH="${1:?Usage: $0 /path/to/repo}"
PORT="${PORT:-3002}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FOCUS_FILE="/tmp/mfh-focus-$$"
SERVER_PID=""

cleanup() {
  rm -f "$FOCUS_FILE"
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  tmux kill-session -t mfh-main 2>/dev/null || true
  echo ""
  echo "Goodbye!"
}
trap cleanup EXIT

# Build the standalone server
echo "=== Building standalone server ==="
npx esbuild "$SCRIPT_DIR/src/server/standalone.ts" \
  --bundle --outfile="$SCRIPT_DIR/dist/server.js" \
  --format=cjs --platform=node --sourcemap 2>&1 | tail -1

# Start the server with focus file support
echo "=== Starting server on port $PORT ==="
MFH_FOCUS_FILE="$FOCUS_FILE" PORT=$PORT node "$SCRIPT_DIR/dist/server.js" "$REPO_PATH" &
SERVER_PID=$!
sleep 3

# Verify server is running
if ! curl -sf "http://127.0.0.1:${PORT}/api/config" > /dev/null 2>&1; then
  echo "Error: Server failed to start on port $PORT"
  exit 1
fi
echo "Server running on http://127.0.0.1:${PORT}"

# Create mfh-main session
tmux kill-session -t mfh-main 2>/dev/null || true
tmux new-session -d -s mfh-main -c "$(cd "$REPO_PATH" && pwd)"

# Launch Claude in mfh-main with skills
tmux send-keys -t mfh-main \
  "unset CLAUDECODE && claude --add-dir ${SCRIPT_DIR}/skills/" Enter

echo ""
echo "=== Attaching to mfh-main ==="
echo "  Ctrl-B D to detach from any session"
echo "  Exiting a worker session returns to mfh-main"
echo "  Exiting mfh-main quits"
echo ""

# Main focus loop
CURRENT="mfh-main"
while true; do
  tmux attach -t "$CURRENT" || true

  # Check for server-requested focus change
  if [ -f "$FOCUS_FILE" ]; then
    CURRENT=$(cat "$FOCUS_FILE")
    rm -f "$FOCUS_FILE"

    # Verify target session exists
    if ! tmux has-session -t "$CURRENT" 2>/dev/null; then
      echo "Session $CURRENT no longer exists, returning to mfh-main"
      CURRENT="mfh-main"
    fi
  elif [ "$CURRENT" = "mfh-main" ]; then
    # Exited main — quit
    break
  else
    # Exited worker — back to main
    CURRENT="mfh-main"
  fi
done
