# Web Architecture

## Overview

A sleek web interface for mainframehub that's **tmux-centric** with discovery-based PR management.

## Core Insight

The web UI discovers sessions (like `mfh list`) and provides terminal access via xterm.js + WebSocket.

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

## Key Features

### 1. Discovery-Based UI

Instead of showing "My PRs" from GitHub, we show **discovered sessions**:

```
Sessions (3)
┌─────────────────────────────────────┐
│ ● mfh-17569                         │
│   PR #17569: Add dark mode          │
│   ad/feat/dark-mode → next          │
│   [Open Terminal] [GitHub]          │
└─────────────────────────────────────┘
```

This is tmux-centric: sessions are the source of truth.

### 2. Terminal View (xterm.js)

Full terminal access to tmux session:
- WebSocket connection to backend
- Backend spawns `tmux attach -t <session>`
- Real-time terminal in browser
- Scrollable on mobile

### 3. Input Modal (Mobile-Friendly)

xterm.js autocomplete doesn't work well on mobile, so:
- Button to open input modal
- Large textarea for typing
- Paste support
- Send to terminal

### 4. PR Operations

- **New PR**: Modal with prompt input → creates PR + session
- **Setup Existing**: Input PR number → clones + creates session
- **Close**: Closes PR + kills session + removes clone

### 5. Mobile Support

- Responsive grid layout
- Touch-friendly buttons
- Scrollable terminal
- Input modal for typing
- Bottom sheet for actions

## REST API

```typescript
GET  /api/discover          // List all sessions with PR info
POST /api/new               // Create new PR + session
POST /api/setup/:prNumber   // Setup existing PR
POST /api/close/:prNumber   // Close PR + cleanup
GET  /api/config            // Get server config
```

## WebSocket Protocol

```typescript
// Client → Server
{
  type: 'attach',
  sessionId: 'mfh-17569'
}

{
  type: 'input',
  data: 'ls\n'
}

{
  type: 'resize',
  cols: 80,
  rows: 24
}

// Server → Client
{
  type: 'output',
  data: '...' // terminal output
}

{
  type: 'exit',
  code: 0
}

{
  type: 'error',
  message: '...'
}
```

## Frontend Structure

```
web/
├── public/
│   ├── index.html          # Main page
│   ├── styles.css          # Sleek modern design
│   ├── app.js              # Discovery + PR operations
│   └── terminal.js         # xterm.js + WebSocket
└── server/
    ├── index.ts            # Express + WebSocket server
    ├── websocket.ts        # Terminal WebSocket handler
    └── api.ts              # REST API routes
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

## Mobile Considerations

### Terminal Scrolling

```css
.terminal-container {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  height: calc(100vh - 200px);
}
```

### Input Modal

```html
<div class="input-modal">
  <textarea placeholder="Type here..."></textarea>
  <button>Send</button>
  <button>Cancel</button>
</div>
```

Opens on mobile when user needs to type/paste.

### Bottom Sheet

```html
<div class="bottom-sheet">
  <button>New PR</button>
  <button>Setup</button>
  <button>Input</button>
</div>
```

Slide-up panel for actions on mobile.

## Development Mode

```bash
npm run dev        # Starts server with --mock flag
npm run dev:web    # Same but opens browser
npm test:web       # Playwright tests
```

Mock writes enabled in development to avoid GitHub spam.

## Testing Strategy

Playwright tests (`web/tests/web.spec.ts`):

```typescript
test('should discover sessions', async ({ page }) => {
  // Create a real session with mock PR
  await createMockSession();

  await page.goto('http://localhost:3000');

  // Should see discovered session
  await expect(page.locator('.session-card')).toBeVisible();
});

test('should connect to terminal', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.click('[data-session="mfh-17569"]');

  // Terminal should connect
  await expect(page.locator('.xterm')).toBeVisible();

  // Can send input
  await page.click('[data-action="open-input"]');
  await page.fill('textarea', 'echo hello');
  await page.click('[data-action="send"]');

  // Should see output
  await expect(page.locator('.xterm')).toContainText('hello');
});
```

Tests use:
- Real Express server
- Real WebSocket connections
- Real tmux sessions
- Mock GitHub writes

## Security Considerations

### WebSocket Authentication

```typescript
// Client sends token
ws.send({ type: 'auth', token: localStorage.getItem('token') });

// Server validates
if (!validateToken(token)) {
  ws.close(1008, 'Unauthorized');
}
```

### Session Isolation

Only allow access to sessions with our prefix (`mfh-`).

### Input Sanitization

All terminal input is escaped before sending to tmux.

## Performance

### Efficient Discovery

Cache discovery results for 5 seconds to avoid spamming tmux/git/GitHub.

### WebSocket Throttling

Throttle terminal output to 60fps to avoid overwhelming browser.

### Lazy Loading

Only load xterm.js when terminal view is opened.

## UI Design

### Color Scheme

- Dark theme by default
- Accent: Electric blue (#00D9FF)
- Success: Green (#00FF88)
- Warning: Orange (#FFB800)
- Error: Red (#FF4444)

### Typography

- Headings: Inter, sans-serif
- Body: Inter, sans-serif
- Terminal: JetBrains Mono, monospace

### Layout

- Sidebar (desktop): Session list
- Main: Terminal or discovery view
- Bottom sheet (mobile): Actions

This architecture is elegant, tmux-centric, and fully testable!
