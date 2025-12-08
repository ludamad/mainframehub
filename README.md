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

## Interfaces

### Web UI

Browser-based interface accessible from anywhere.

```bash
npm run web
# Open http://localhost:3000
```

**Features:**
- 🌐 Remote access
- 📱 Works in any browser
- 👥 Multi-user support
- 🔒 GitHub token auth

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
- Add tab completion
- Add session templates
