# MainframeHub TUI

Terminal User Interface for MainframeHub - runs entirely on the host machine with native tmux integration.

## Features

### ✅ All Web App Functionality
- View all sessions with PR associations
- Browse your open PRs
- Create new PRs
- Setup existing PRs
- Create PRs from branches
- Direct tmux attachment (no WebSocket!)

### ✅ Native Integration
- **Direct Service Calls** - No HTTP/REST overhead, calls services directly
- **Native Tmux** - Direct `tmux attach` instead of WebSocket forwarding
- **Mouse Support** - Click to navigate and select
- **Keyboard Navigation** - Vi-style keys + hotkeys (1-4 for tabs)

### ✅ Better Performance
- No network latency (direct service calls)
- No WebSocket overhead
- Native terminal performance
- Instant tmux attachment

## Architecture

```
┌─────────────────────────────────────────────────┐
│  TUI Layer (blessed)                            │
│  ┌──────────┬──────────┬──────────┬──────────┐ │
│  │ Sessions │  My PRs  │ Branches │  New PR  │ │
│  └──────────┴──────────┴──────────┴──────────┘ │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  Service Layer (direct calls, no HTTP!)         │
│  • TmuxService                                   │
│  • GitService                                    │
│  • GitHubService                                 │
│  • DiscoveryService                              │
│  • PRService                                     │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  System Layer                                    │
│  • tmux (direct attach!)                        │
│  • git                                           │
│  • gh CLI                                        │
└─────────────────────────────────────────────────┘
```

## Usage

```bash
# Build
npm run build

# Run TUI
npm run tui

# Or with custom config
npm run tui -- /path/to/mfh.config.json
```

## Navigation

### Keyboard Shortcuts
- `1-4` - Switch between tabs
- `q` or `Ctrl+C` - Quit
- `↑/↓` or `j/k` - Navigate lists
- `Enter` - Select item
- `Tab` - Navigate form fields
- `Esc` - Exit terminal back to tabs

### Mouse Support
- Click tabs to switch
- Click list items to select
- Scroll with mouse wheel
- Click buttons in forms

## Views

### 1. Sessions Tab (Hotkey: 1)
Lists all tmux sessions with:
- PR association (if any)
- Active status indicator (● = active, ○ = inactive)
- PR details (number, title, branch)

**Actions:**
- Press Enter or click to attach to session

### 2. My PRs Tab (Hotkey: 2)
Lists your open PRs with:
- PR number and title
- Status: `[ACTIVE]` if session exists, `[SETUP]` if needs setup

**Actions:**
- Press Enter or click to setup (if needed) and attach

### 3. Branches Tab (Hotkey: 3)
Lists your branches without PRs:
- Shows branch name
- Indicates if protected

**Actions:**
- Press Enter or click to create PR (prompts for title)

### 4. New PR Tab (Hotkey: 4)
Form to create a new PR:
- Prompt textarea (for Claude)
- Base branch input
- Create PR button

**Actions:**
- Fill form, press Enter on button to create

## Terminal View

When you attach to a session, the TUI **completely hands off** to native tmux:

```
TUI → Hide blessed screen → spawn tmux attach → Native tmux!
```

**Benefits:**
- Full tmux experience (all keybindings work)
- No performance overhead
- No WebSocket latency
- Copy/paste works natively
- Tmux status bar visible

**To Return:**
- Detach from tmux normally (`Ctrl+B d`)
- Or press `Esc` (TUI intercepts)
- TUI automatically returns

## File Structure

```
tui/
├── index.ts          # Entry point, service initialization
├── app.ts            # Main TUI application, screen management
├── views/
│   ├── sessions.ts   # Sessions list view
│   ├── my-prs.ts     # My PRs list view
│   ├── branches.ts   # Branches list view
│   ├── new-pr.ts     # New PR form view
│   └── terminal.ts   # Direct tmux attachment (!)
└── README.md         # This file
```

## Implementation Notes

### Direct Service Integration
Unlike the web app which uses HTTP/REST/WebSocket, the TUI calls services directly:

```typescript
// Web app (slow)
fetch('/api/discover') → HTTP → Server → Service

// TUI (fast!)
await discovery.discover() → Service directly!
```

### Native Tmux Attachment
The terminal view is elegantly simple:

```typescript
// Hide blessed UI
screen.program.normalBuffer();

// Spawn tmux attach directly
spawn('tmux', ['attach-session', '-t', sessionId], {
  stdio: 'inherit'  // Give tmux full terminal control!
});

// When user detaches, restore blessed UI
screen.program.alternateBuffer();
```

No WebSocket, no pty forwarding, no complexity - just native tmux!

### Why Blessed?
- Mature and stable
- Excellent mouse support
- Wide widget library
- Can directly spawn processes
- Good performance

## Comparison: TUI vs Web

| Feature | Web App | TUI |
|---------|---------|-----|
| **Deployment** | Server + Browser | Single process on host |
| **PR Calls** | HTTP REST | Direct function calls |
| **Terminal** | WebSocket + pty | Native tmux attach |
| **Latency** | Network latency | None (local) |
| **Performance** | Good | Excellent |
| **Mouse** | Yes | Yes |
| **Accessibility** | Browser required | Terminal required |
| **Best For** | Remote access, teams | Local development |

## Troubleshooting

### "Cannot find module 'blessed'"
```bash
npm install
npm run build
```

### TUI doesn't start
- Check config file exists: `mfh.config.json`
- Verify tmux is installed: `tmux -V`
- Verify gh CLI is installed: `gh --version`

### Mouse not working
- Ensure terminal supports mouse (most modern terminals do)
- Try iTerm2, kitty, or Alacritty for best experience

### Terminal view freezes
- Press `Esc` to force return to TUI
- Check tmux session exists: `tmux list-sessions`

## Future Enhancements

Potential additions:
- Search/filter functionality
- Bulk operations on sessions
- Settings view
- Session statistics
- Git status indicators
- PR review workflow
- Inline PR diff viewing
- Multi-select operations
