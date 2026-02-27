# MainframeHub

A **VS Code extension** for managing tmux-based PR workflows with Claude Code.

## Philosophy

Sessions are the source of truth. PRs are discovered from git repos in session working directories.

```
Tmux sessions -> Git repos -> Derive PRs from GitHub
```

This is elegant because:
- `tmux ls` tells us all active work
- Git working directory provides PR context
- No external state to sync
- Natural developer workflow

## Installation

1. Open the repo in VS Code on a remote Linux server (via SSH Remote)
2. Run `npm install && npm run compile`
3. Press F5 to launch the Extension Development Host
4. Or: `npm run package` to create a `.vsix` and install it

## Configuration

On first launch, run **MFH: Setup Wizard** from the command palette. It asks for your GitHub repo URL and auto-detects everything else.

Settings are stored in VS Code's `settings.json` under the `mfh.*` namespace.

## Usage

### VS Code Dashboard

Open the dashboard via:
- Click the **MainframeHub** status bar item
- Run **MFH: Open Dashboard** from the command palette
- Click the MainframeHub icon in the Activity Bar

The dashboard has two tabs:
- **My PRs**: Grouped PR cards (active sessions, has clone, not set up, closed) with contextual action buttons
- **New PR**: Form to create a new PR with Claude Code

### Browser Access

The extension starts a lightweight HTTP server on port 3000. Open `http://127.0.0.1:3000` in any browser to access the dashboard.

Or run **MFH: Open Dashboard in Browser** from the command palette.

Note: Terminal and folder operations require VS Code.

### Tree View

The sidebar tree view shows PRs grouped by status with inline actions and context menus.

### Key Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| MFH: Open PR | `Cmd+Shift+M` | Quick pick PR switcher |
| MFH: Create New PR | `Cmd+Shift+N` | Create PR with Claude metadata |
| MFH: Fix This Error | `Cmd+Shift+F` | Send error to Claude session |

## Development

```bash
npm install
npm run compile    # Build extension + webview bundles
npm run lint       # Type check
npm test           # Run vitest tests
npm run watch      # Watch mode for development
```

## Requirements

- VS Code ^1.93.0
- tmux, git, claude CLI on PATH
- GitHub authentication via VS Code
