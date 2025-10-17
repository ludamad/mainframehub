# MainframeHub (mfh)

A **tmux-centric** CLI tool for managing PR workflows.

## Philosophy

Sessions are the source of truth. PRs are discovered from git repos in session working directories.

Instead of:
```
GitHub PR → Try to match to local state → Complex sync
```

We do:
```
Tmux sessions → Git repos → Derive PRs from GitHub
```

This is elegant because:
- `tmux ls` tells us all active work
- Git working directory provides PR context
- No external state to sync
- Natural developer workflow

## Installation

```bash
cd mainframehub
npm install
npm run build
npm link  # Makes 'mfh' available globally
```

## Configuration

Create `mfh.config.json` in your project or `~/.mfh.config.json`:

```json
{
  "repo": "https://github.com/owner/repo",
  "repoName": "owner/repo",
  "clonesDir": "./clones",
  "baseBranch": "main",
  "sessionPrefix": "mfh-",
  "guidelines": {
    "branchFormat": "prefix/type/description",
    "commitFormat": "type: description"
  }
}
```

## Usage

### List all sessions

```bash
mfh list
```

Shows all tmux sessions with our prefix, their PRs, and git state.

### Create new PR

```bash
mfh new "Add dark mode"
```

Full flow:
1. Generates branch name and PR metadata with Claude
2. Creates PR on GitHub
3. Clones repository
4. Creates branch and empty commit
5. Pushes to GitHub
6. Creates tmux session
7. Starts Claude with your prompt

### Setup existing PR

```bash
mfh setup 17569
```

Clones an existing PR and creates a tmux session for it.

### Attach to session

```bash
mfh attach mfh-17569
```

Attaches to a tmux session (blocking).

### Close PR

```bash
mfh close 17569
```

Closes the PR on GitHub, kills the tmux session, and removes the clone.

## Mock Mode

For testing without hitting GitHub:

```bash
mfh --mock new "Test feature"
```

- **Reads are real** - Lists real PRs from GitHub
- **Writes are mocked** - createPR, updatePR, closePR are stored in memory
- **Everything else is real** - Real tmux, real git, real clones

## Testing

```bash
npm test
```

Tests use:
- **Real tmux sessions** (created and destroyed)
- **Real git clones** (in /tmp)
- **Real file system** operations
- **Mocked GitHub writes** only

Tests are comprehensive but fast because only GitHub API calls are mocked.

## Architecture

### Services

- **TmuxService** - Wraps tmux CLI (real, not mocked)
- **GitService** - Wraps git CLI (real, not mocked)
- **GitHubService** - Wraps gh CLI with mock-writes mode
- **ClaudeService** - Claude AI for generating PR metadata
- **DiscoveryService** - Tmux-centric session discovery
- **PRService** - Orchestrates full PR workflows
- **ClaudeHandoverService** - Initializes Claude sessions with context

### Discovery Flow

```typescript
1. List tmux sessions with prefix 'mfh-'
2. For each session:
   a. Get working directory from tmux
   b. Run git commands to get repo URL and branch
   c. Query GitHub for PR matching repo+branch
3. Return complete session states
```

### Clone Directory Structure

Always uses `pr-{number}`:

```
clones/
  pr-17569/
  pr-17620/
  pr-17696/
```

Simple, consistent, no special characters.

## Key Differences from Previous Implementation

1. **No abstractions for tmux/git** - Use them directly
2. **Only mock GitHub writes** - Everything else is real
3. **Tmux-centric discovery** - Sessions tell us what PRs exist
4. **Simple clone naming** - Always `pr-{number}`
5. **Real tests** - Create real sessions and clones
6. **Clean separation** - Services are independent, composable

## Example Session

```bash
$ mfh --mock new "Add user authentication"

[1/7] Generating metadata with Claude...
[2/7] Creating PR on GitHub: ad/feat: add user authentication...
[MOCK] Created PR #10000: ad/feat: add user authentication
[3/7] Cloning repository (PR #10000)...
[4/7] Creating and checking out branch...
[5/7] Creating empty commit and pushing...
[6/7] Creating tmux session...
[7/7] Initializing Claude session...
✓ PR #10000 created and session started!

PR created: https://github.com/owner/repo/pull/10000
Session: mfh-10000

Attach with: mfh attach mfh-10000

$ mfh list

Found 1 session(s):

  mfh-10000
   PR #10000: ad/feat: add user authentication
   ad/feat/add-user-auth -> main

$ mfh attach mfh-10000
# (enters tmux session with Claude ready)
```

## Benefits

1. **Testable** - All tests use real operations, only GitHub writes mocked
2. **Simple** - No complex abstractions, just thin wrappers
3. **Reliable** - Tmux and git are the source of truth
4. **Fast** - Tests run in seconds with real tmux/git
5. **Realistic** - Tests create actual sessions and clones

## Next Steps

- Add more commands (sync, status, diff)
- Add better error handling
- Add logging/debugging flags
- Add tab completion
- Add session templates
