# MainframeHub Implementation Summary

## What Was Built

A **tmux-centric** CLI tool for managing PR workflows with full testability.

### Key Insight

**Sessions are the source of truth, not external state.**

Instead of tracking PRs and trying to match them to local state, we:
1. List tmux sessions
2. Get git repo info from working directory
3. Query GitHub for matching PR
4. Derive complete state

This eliminates complex synchronization and matches natural developer workflow.

## Architecture

### Real Services (No Mocking)

All services use real operations:

1. **TmuxService** (`src/services/tmux.ts`)
   - Wraps tmux CLI commands
   - No mocking - creates real sessions

2. **GitService** (`src/services/git.ts`)
   - Wraps git CLI commands
   - No mocking - real clones, branches, commits

3. **ClaudeService** (`src/services/claude.ts`)
   - Uses Claude CLI to generate PR metadata
   - Falls back gracefully if unavailable

### GitHub Service with Mock-Writes Mode

4. **GitHubService** (`src/services/github.ts`)
   - **Reads**: Always real (uses gh CLI)
   - **Writes**: Can be mocked (stored in memory)
   - Toggle with `{ mockWrites: true }`

### Core Services

5. **DiscoveryService** (`src/services/discovery.ts`)
   - The tmux-centric heart
   - Discovers sessions → git repos → PRs

6. **PRService** (`src/services/pr-service.ts`)
   - Orchestrates full workflows
   - createNew, setupExisting, close

7. **ClaudeHandoverService** (`src/services/handover.ts`)
   - Properly initializes Claude sessions
   - Sends user prompt with full context

## CLI Commands

```bash
mfh list              # List all sessions with PR info
mfh new <prompt>      # Create new PR and session
mfh setup <pr-num>    # Setup existing PR
mfh attach <session>  # Attach to session
mfh close <pr-num>    # Close PR and cleanup

# Flags
--mock                # Mock GitHub writes
--base <branch>       # Override base branch
```

## Testing Strategy

Tests in `tests/pr-service.test.ts` use:
- ✅ **Real tmux sessions** (created and destroyed)
- ✅ **Real git clones** (in /tmp)
- ✅ **Real file system** operations
- ❌ **Mocked GitHub writes** only

This makes tests:
- Fast (seconds, not minutes)
- Reliable (no flaky network issues)
- Realistic (actual sessions and repos)

### Test Coverage

1. **Full PR creation flow** - Real tmux + git + clones
2. **Session discovery** - Derives PR from git working directory
3. **Multiple PRs** - No conflicts, proper isolation
4. **Setup existing** - Clones PR branch correctly
5. **Close and cleanup** - Removes session + clone
6. **Hybrid mode** - Can read real GitHub PRs

## File Structure

```
mainframehub/
├── src/
│   ├── cli.ts                    # CLI entry point
│   └── services/
│       ├── tmux.ts               # Real tmux operations
│       ├── git.ts                # Real git operations
│       ├── github.ts             # Mock-writes mode
│       ├── claude.ts             # Claude AI metadata
│       ├── discovery.ts          # Tmux-centric discovery
│       ├── pr-service.ts         # Full workflows
│       └── handover.ts           # Claude session init
├── tests/
│   └── pr-service.test.ts        # Comprehensive tests
├── mfh.config.example.json       # Configuration template
├── package.json
├── tsconfig.json
├── jest.config.js
├── README.md
└── SPEC.md                       # Original specification
```

## How It Works

### 1. New PR Flow

```typescript
mfh new "Add dark mode"

1. Claude generates: branch name, title, body
2. GitHub PR created (mocked in test mode)
3. Git clone + branch creation (real)
4. Empty commit + push (real)
5. Tmux session created (real)
6. Claude initialized with prompt
7. Ready to work!
```

### 2. Discovery Flow

```typescript
mfh list

1. List tmux sessions with prefix 'mfh-'
2. For each session:
   - Get working directory from tmux
   - Run git commands → get repo URL and branch
   - Query GitHub → find PR for repo+branch
3. Display: session → git info → PR info
```

### 3. Close Flow

```typescript
mfh close 17569

1. Close PR on GitHub (mocked in test mode)
2. Kill tmux session mfh-17569
3. Remove clone directory pr-17569
```

## Key Differences from Previous App

| Previous App | MainframeHub |
|-------------|--------------|
| Complex session tracking | Sessions are discovered |
| pr-{branch} and pr-{number} | Always pr-{number} |
| Mock everything | Mock only GitHub writes |
| External state management | Git is the state |
| Slow/flaky tests | Fast/reliable tests |
| Branches with slashes broke filesystem | No filesystem issues |

## Configuration

Example `mfh.config.json`:

```json
{
  "repo": "https://github.com/AztecProtocol/aztec-packages",
  "repoName": "AztecProtocol/aztec-packages",
  "clonesDir": "./clones",
  "baseBranch": "next",
  "sessionPrefix": "mfh-",
  "guidelines": {
    "branchFormat": "ad/TYPE/description",
    "commitFormat": "type: description"
  }
}
```

## Usage Example

```bash
# Create new PR (mock mode for testing)
$ mfh --mock new "Add user authentication"

[1/7] Generating metadata with Claude...
[2/7] Creating PR on GitHub...
[MOCK] Created PR #10000
[3/7] Cloning repository...
[4/7] Creating branch...
[5/7] Empty commit + push...
[6/7] Creating tmux session...
[7/7] Initializing Claude...
✓ PR #10000 created!

# List sessions
$ mfh list

Found 1 session(s):

  mfh-10000
   PR #10000: ad/feat: add user authentication
   ad/feat/add-user-auth -> next

# Attach to work
$ mfh attach mfh-10000
# (enters tmux with Claude ready)
```

## Benefits

1. **Simpler** - No unnecessary abstractions
2. **Testable** - Real operations, only GitHub writes mocked
3. **Reliable** - Tmux/git are source of truth
4. **Fast** - Tests run in seconds
5. **Elegant** - Natural developer workflow

## What Makes This Elegant

The tmux-centric approach eliminates complexity:

**Before:**
```
External DB → Sync → Match sessions → Hope they align
```

**After:**
```
tmux ls → git info → derive everything
```

No synchronization. No stale state. Just discover what exists.

This is the elegant way to manage PR workflows.
