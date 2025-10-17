# MainframeHub Web UI

A sleek, tmux-centric web interface for managing PR workflows with real-time terminal access.

## Features

### Discovery-Based UI
- Displays discovered tmux sessions (not GitHub PRs) as the source of truth
- Automatically derives PR information from git working directories
- Real-time session status (active/inactive)

### Terminal Access
- Full xterm.js terminal with WebSocket connection
- Real-time bidirectional communication with tmux sessions
- Scrollable terminal on mobile devices
- Input modal for mobile (autocomplete doesn't work in xterm.js)

### PR Operations
- **New PR**: Create PR with Claude-generated metadata + session
- **Setup Existing**: Clone existing PR and create session
- **Close**: Close PR, kill session, and cleanup clone

### Mobile Support
- Responsive grid layout
- Touch-friendly buttons (minimum 44px)
- Scrollable terminal with momentum scrolling
- Input modal for typing/pasting commands
- Bottom sheet for actions

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │   Discovery    │  │   Terminal   │  │   Input     │ │
│  │   View         │  │   View       │  │   Modal     │ │
│  │  (PR List)     │  │  (xterm.js)  │  │  (Mobile)   │ │
│  └────────────────┘  └──────────────┘  └─────────────┘ │
│         │                    │                          │
│         │ REST API           │ WebSocket                │
└─────────┼────────────────────┼──────────────────────────┘
          │                    │
          ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│                  Express Server                         │
│  ┌────────────────┐  ┌──────────────┐                  │
│  │   REST API     │  │  WebSocket   │                  │
│  │   /api/...     │  │   Server     │                  │
│  └────────────────┘  └──────────────┘                  │
│         │                    │                          │
│         ▼                    ▼                          │
│  ┌────────────────────────────────────┐                │
│  │   MainframeHub Services            │                │
│  │  - DiscoveryService                │                │
│  │  - PRService                       │                │
│  │  - TmuxService                     │                │
│  └────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────┘
          │                    │
          ▼                    ▼
    GitHub API            tmux sessions
  (mock writes)          (real terminals)
```

## Getting Started

### Prerequisites
- Node.js 18+
- tmux installed
- gh CLI configured (for GitHub operations)
- claude CLI (optional, for PR metadata generation)

### Installation

```bash
cd /path/to/mainframehub
npm install
npm run build
```

### Configuration

Create `mfh.config.json`:

```json
{
  "repo": "https://github.com/owner/repo",
  "repoName": "owner/repo",
  "clonesDir": "./clones",
  "baseBranch": "main",
  "sessionPrefix": "mfh-",
  "guidelines": {
    "branchFormat": "prefix/TYPE/description",
    "commitFormat": "type: description"
  }
}
```

### Running

#### Development Mode (with mock GitHub writes)
```bash
npm run web
```

Then open http://localhost:3000

#### Production Mode (real GitHub writes)
```bash
npm run web:prod
```

### Testing

Run Playwright tests:

```bash
npm run test:web
```

Tests include:
- UI interaction tests
- Session discovery
- Terminal connection
- Modal interactions
- Mobile responsiveness
- API error handling

All tests use:
- Real tmux sessions
- Real git clones
- Mock GitHub writes (safe for testing)

## API Endpoints

### GET /api/discover
List all sessions with PR info

**Response:**
```json
{
  "sessions": [
    {
      "sessionId": "mfh-17569",
      "workingDir": "/path/to/clone",
      "isActive": true,
      "hasGit": true,
      "hasPR": true,
      "git": {
        "repo": "owner/repo",
        "branch": "feature-branch",
        "remote": "https://github.com/owner/repo",
        "isDirty": false,
        "ahead": 0,
        "behind": 0
      },
      "pr": {
        "number": 17569,
        "title": "Add dark mode",
        "url": "https://github.com/owner/repo/pull/17569",
        "state": "OPEN",
        "isDraft": false,
        "branch": "feature-branch",
        "baseBranch": "main"
      }
    }
  ]
}
```

### POST /api/new
Create new PR + session

**Request:**
```json
{
  "prompt": "Add dark mode toggle",
  "baseBranch": "main"
}
```

**Response:**
```json
{
  "success": true,
  "pr": { "number": 17569, "title": "...", "url": "...", "branch": "...", "baseBranch": "..." },
  "session": { "id": "mfh-17569", "workingDir": "/path/to/clone" },
  "clonePath": "/path/to/clone"
}
```

### POST /api/setup/:prNumber
Setup existing PR

**Request:**
```json
{
  "baseBranch": "main"
}
```

**Response:**
```json
{
  "success": true,
  "pr": { "number": 17569, "title": "...", "url": "...", "branch": "...", "baseBranch": "..." },
  "session": { "id": "mfh-17569", "workingDir": "/path/to/clone" },
  "clonePath": "/path/to/clone"
}
```

### POST /api/close/:prNumber
Close PR + cleanup

**Response:**
```json
{
  "success": true,
  "message": "PR #17569 closed and cleaned up"
}
```

### GET /api/config
Get server configuration

**Response:**
```json
{
  "repo": "https://github.com/owner/repo",
  "repoName": "owner/repo",
  "baseBranch": "main",
  "sessionPrefix": "mfh-",
  "guidelines": {}
}
```

## WebSocket Protocol

### Client → Server

**Attach to session:**
```json
{
  "type": "attach",
  "sessionId": "mfh-17569"
}
```

**Send input:**
```json
{
  "type": "input",
  "data": "ls\n"
}
```

**Resize terminal:**
```json
{
  "type": "resize",
  "cols": 80,
  "rows": 24
}
```

### Server → Client

**Output:**
```json
{
  "type": "output",
  "data": "terminal output..."
}
```

**Exit:**
```json
{
  "type": "exit",
  "code": 0
}
```

**Error:**
```json
{
  "type": "error",
  "message": "error message"
}
```

## File Structure

```
web/
├── server/
│   ├── index.ts            # Express + WebSocket server
│   ├── api.ts              # REST API routes
│   └── websocket.ts        # Terminal WebSocket handler
├── static/
│   ├── index.html          # Main page
│   ├── styles.css          # Sleek modern design
│   └── app.js              # Discovery + PR operations + terminal
├── tests/
│   └── web.spec.ts         # Playwright tests
├── ARCHITECTURE.md         # Detailed architecture
└── README.md               # This file
```

## Design Principles

### 1. Tmux-Centric
Sessions are the primary view, not PRs. Discovery shows what's actually running.

### 2. Mobile-First
- Touch targets ≥ 44px
- Scrollable terminal
- Input modal for typing
- Responsive layout

### 3. Real-Time
WebSocket updates for terminal output, instant feedback.

### 4. Testable
Playwright tests with:
- Mock GitHub writes
- Real tmux sessions
- Real terminal connections

## Development

### Start development server
```bash
npm run build
npm run web
```

### Watch mode (rebuild on changes)
```bash
npm run dev
```

In another terminal:
```bash
npm run web
```

### Run tests
```bash
npm run test:web
```

## Security Considerations

- Only allow access to sessions with configured prefix (e.g., `mfh-`)
- All terminal input is passed directly to tmux (no additional escaping needed)
- WebSocket connections are bound to the same origin
- Mock writes enabled by default for development safety

## Performance

- Discovery results cached (5 seconds) to avoid tmux/git/GitHub spam
- Terminal output throttled (60fps) to avoid overwhelming browser
- xterm.js lazy loaded when terminal view opens

## Troubleshooting

### Terminal won't connect
- Check that tmux session exists: `tmux ls`
- Check WebSocket connection in browser devtools
- Verify server is running with `curl http://localhost:3000/health`

### Sessions not discovered
- Verify sessions have correct prefix: `tmux ls | grep mfh-`
- Check that working directories are git repositories
- Ensure gh CLI is authenticated: `gh auth status`

### Playwright tests fail
- Run `npx playwright install` to install browsers
- Check that port 3001 is available
- Verify tmux is installed and working

## Contributing

When adding new features:
1. Update ARCHITECTURE.md with design decisions
2. Add Playwright tests for new functionality
3. Ensure mobile compatibility
4. Test with mock writes enabled

## License

ISC
