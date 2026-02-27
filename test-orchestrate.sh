#!/usr/bin/env bash
set -euo pipefail

# End-to-end test for multiagent orchestration via HTTP API.
#
# Validates that the standalone server can create PRs, launch worker
# Claudes in tmux sessions, and detect when they finish.
#
# Prerequisites:
#   - gh auth login (GitHub CLI authenticated)
#   - claude CLI installed and authenticated
#   - tmux installed
#
# Usage:
#   ./test-orchestrate.sh /path/to/local/repo
#
# The repo must have a GitHub origin remote. PRs are created as drafts.

REPO_PATH="${1:?Usage: $0 /path/to/repo}"
PORT="${PORT:-3005}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_PID=""

cleanup() {
  echo ""
  echo "=== Cleaning up ==="
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    echo "Server stopped."
  fi
}
trap cleanup EXIT

echo "=== Building standalone server ==="
npx esbuild "$SCRIPT_DIR/src/server/standalone.ts" \
  --bundle --outfile="$SCRIPT_DIR/dist/server.js" \
  --format=cjs --platform=node --sourcemap 2>&1 | tail -1

echo "=== Starting server on port $PORT ==="
PORT=$PORT node "$SCRIPT_DIR/dist/server.js" "$REPO_PATH" &
SERVER_PID=$!
sleep 3

echo "=== Verifying server ==="
CONFIG=$(curl -sf "http://127.0.0.1:${PORT}/api/config")
REPO_NAME=$(echo "$CONFIG" | python3 -c "import sys,json; print(json.load(sys.stdin)['repoName'])")
echo "Repo: $REPO_NAME"

echo ""
echo "=== Worker status (should be empty) ==="
curl -sf "http://127.0.0.1:${PORT}/api/worker-status" | python3 -m json.tool
echo ""

echo "=== Creating 3 PRs ==="
TASKS=(
  "Add a CONTRIBUTING.md file with basic contribution guidelines for this project"
  "Add an .editorconfig file for consistent code formatting across editors"
  "Add a simple CHANGELOG.md with an initial 0.1.0 entry"
)

PR_NUMBERS=()
for task in "${TASKS[@]}"; do
  echo "Creating: ${task:0:60}..."
  RESULT=$(curl -sf -X POST "http://127.0.0.1:${PORT}/api/create-pr" \
    -H 'Content-Type: application/json' \
    -d "$(python3 -c "import json; print(json.dumps({'prompt': '$task'}))")")

  PR_NUM=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['pr']['number'])")
  PR_TITLE=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['pr']['title'])")
  echo "  Created PR #${PR_NUM}: ${PR_TITLE}"
  PR_NUMBERS+=("$PR_NUM")
  sleep 2
done

echo ""
echo "=== PRs created: ${PR_NUMBERS[*]} ==="
echo ""

echo "=== Polling worker status ==="
MAX_POLLS=40  # 40 * 15s = 10 min max
for i in $(seq 1 "$MAX_POLLS"); do
  STATUS=$(curl -sf "http://127.0.0.1:${PORT}/api/worker-status")

  RUNNING=$(echo "$STATUS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
running = [w for w in data if w['status'] == 'running']
finished = [w for w in data if w['status'] == 'finished']
print(f'{len(running)} running, {len(finished)} finished')
for w in data:
    print(f\"  {w['sessionId']}: {w['status']} ({w['command']})\")
")

  echo "Poll $i: $RUNNING"

  ALL_DONE=$(echo "$STATUS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print('yes' if all(w['status'] == 'finished' for w in data) and len(data) > 0 else 'no')
")

  if [ "$ALL_DONE" = "yes" ]; then
    echo ""
    echo "All workers finished!"
    break
  fi

  sleep 15
done

echo ""
echo "=== Final output from each session ==="
SESSIONS=$(curl -sf "http://127.0.0.1:${PORT}/api/worker-status" | \
  python3 -c "import sys,json; [print(w['sessionId']) for w in json.load(sys.stdin)]")

for sid in $SESSIONS; do
  echo "--- $sid (last 30 lines) ---"
  curl -sf "http://127.0.0.1:${PORT}/api/session-output?id=${sid}&lines=30" | \
    python3 -c "import sys,json; print(json.load(sys.stdin).get('output','(no output)'))" 2>/dev/null || echo "(failed to read)"
  echo ""
done

echo "=== PR summary ==="
curl -sf "http://127.0.0.1:${PORT}/api/grouped-prs" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for group in ['activeSession', 'hasClone', 'notSetUp', 'closedWithClone']:
    prs = data.get(group, [])
    if prs:
        print(f'{group} ({len(prs)}):')
        for pr in prs:
            print(f\"  #{pr['number']} {pr['title']} [{pr['state']}]\")
"

echo ""
echo "=== Done ==="
echo "PRs created: ${PR_NUMBERS[*]}"
echo "To attach to a session: tmux attach -t pr-<number>"
echo "To close all test PRs: for n in ${PR_NUMBERS[*]}; do gh pr close \$n -R $REPO_NAME; done"
