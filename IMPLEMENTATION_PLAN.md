# MainframeHub VS Code Extension Migration Plan

## Overview

Migrate MainframeHub from a standalone web app (Express + xterm.js) to a **VS Code extension** while keeping tmux as the core workflow engine and maintaining the strong GitHub PR focus. The existing service layer is well-separated and can be reused with minimal changes.

**Runtime environment**: Always a remote Linux server via VS Code SSH Remote. This simplifies PATH handling, guarantees tmux/git/gh availability, and means the extension host runs on the same machine as tmux sessions.

**Migration strategy**: Web app and extension coexist during migration. They share no conflicting state — both read from the same tmux sessions, git repos, and GitHub API. Users can fall back to the web app for anything not yet implemented. Web app is removed after Stage 3 is complete.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Remote Linux Server (via SSH Remote)                │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   VS Code Extension Host                      │  │
│  │                                                               │  │
│  │  ┌────────────────┐  ┌─────────────────────────────────────┐  │  │
│  │  │  Unified Tree  │  │  Command Palette / Quick Picks      │  │  │
│  │  │  View (sidebar)│  │  (create PR, open PR, setup, etc.)  │  │  │
│  │  │  PR + Session  │  │                                     │  │  │
│  │  │  toggle mode   │  │  Status Bar (active count, click    │  │  │
│  │  │                │  │  to open Quick Pick)                 │  │  │
│  │  └───────┬────────┘  └──────────────┬──────────────────────┘  │  │
│  │          │                          │                         │  │
│  │  ┌───────┴──────────────────────────┴──────────────────────┐  │  │
│  │  │              Service Layer (reused)                      │  │  │
│  │  │                                                         │  │  │
│  │  │  TmuxService    → spawn('tmux', [...args])              │  │  │
│  │  │  GitService     → spawn('git', [...args])               │  │  │
│  │  │  GitHubService  → Octokit (reads) + spawn('gh', [...])  │  │  │
│  │  │  ClaudeService  → spawn('claude', [...args])            │  │  │
│  │  │  PRService      → orchestrates all above                │  │  │
│  │  │  DiscoveryService, PRCache, SessionCache                │  │  │
│  │  │  HandoverService → tmux send-keys for Claude init       │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  VS Code Integrated Terminal                             │  │  │
│  │  │  createTerminal({ shellPath: '/usr/bin/tmux',            │  │  │
│  │  │    shellArgs: ['attach-session', '-t', 'pr-123'] })      │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│         │              │              │              │               │
│    ┌────┴───┐    ┌─────┴────┐   ┌────┴────┐   ┌────┴─────┐        │
│    │  tmux  │    │   git    │   │ gh CLI  │   │  claude  │        │
│    └────────┘    └──────────┘   └─────────┘   └──────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

1. **VS Code Terminal replaces xterm.js + WebSocket + node-pty** — `vscode.window.createTerminal()` with `tmux attach-session`. The entire custom terminal infrastructure is deleted.
2. **Unified sidebar tree view** with PR/Session toggle — single view, two modes. PRs are the default lens (users think in PRs), Sessions mode is a toggle for power users.
3. **Native UI first** — Quick Picks + Input Boxes + `withProgress` for all workflows. No webviews unless native UI proves inadequate.
4. **`vscode.authentication` + Octokit for GitHub reads** — eliminates most `gh` CLI shell-outs. Keep `gh` only for complex writes (`pr create`, which handles forks/cross-repo).
5. **`spawn` with argument arrays** — replace all `execSync` string interpolation with `spawn(cmd, [...args])`. Fixes shell injection vulnerabilities and makes everything async.
6. **Extension settings replace mfh.config.json** — `vscode.workspace.getConfiguration('mfh')` with proper schema.
7. **Disposable everything** — every interval, listener, terminal, and provider pushed to `context.subscriptions`.
8. **Output Channel for logging** — `vscode.window.createOutputChannel('MainframeHub')` replaces `console.log`. Errors include "See Output > MainframeHub for details".

---

## Stage 1: Extension Scaffold and Service Layer Port

**Goal**: Bootable VS Code extension with the existing service layer running async inside it.

**Success Criteria**:
- Extension activates on remote Linux server via SSH Remote without errors
- All services instantiate and call tmux/git/gh/claude successfully
- `mfh.discover` command returns session data in Output Channel
- Prerequisite check runs at activation (tmux, git, gh, claude)
- Services use `spawn` with argument arrays (no shell injection)
- Unit tests pass for ported services

**Checks**:
- `npm run compile` succeeds
- Extension loads in Extension Development Host (remote SSH)
- Services produce correct output with real tmux/git/gh
- Output Channel shows structured logs with timestamps

**Tasks**:
1. **Scaffold extension project**
   - TypeScript, esbuild bundler, `format: 'cjs'`
   - Fresh `package.json` (do NOT inherit `node-pty`, `express`, `ws` dependencies)
   - Add `@octokit/rest` for GitHub reads
   - `tsconfig.json` targeting ES2020 + Node
   - `.vscodeignore` excluding source, tests, web/

2. **Port service layer** — copy `src/services/*` and `src/interfaces.ts`
   - Convert **one service at a time** (TmuxService → GitService → GitHubService → ClaudeService → higher-level services)
   - Replace all `execSync` with async `spawn` using argument arrays:
     ```typescript
     // Before (shell injection risk):
     execSync(`git commit -m "${message}"`, { cwd })
     // After (safe):
     await run('git', ['commit', '-m', message], { cwd })
     ```
   - Validate each service independently before moving to the next
   - GitHubService becomes hybrid: Octokit for reads (`listPRs`, `getPR`, `findPR`), `gh` CLI via spawn for writes (`createPR`)

3. **Add progress callback support to PRService**
   - `createNew()`, `setupExisting()`, `createFromBranch()` accept an optional `onProgress: (step: string, increment: number) => void` callback
   - This enables `withProgress` integration in later stages

4. **Create infrastructure**
   - `OutputChannel` — created at activation, used by all services
   - `ExtensionConfig` — reads from `vscode.workspace.getConfiguration('mfh')`, maps to existing config shape
   - `ServiceContainer` — wires all services, implements `Disposable`
   - `onDidChangeConfiguration` listener to reconfigure services when settings change

5. **Prerequisite check at activation**
   - Verify `tmux`, `git`, `gh`, `claude` are available (run `which` + `--version`)
   - Log results to Output Channel
   - Set `mfh.isConfigured` context for `when` clauses

6. **Register `mfh.discover` smoke-test command**
   - Runs `DiscoveryService.discover()`, logs results to Output Channel

7. **Port and adapt unit tests**
   - Use `vitest` (faster than Jest, native ESM support)
   - Mock `spawn` calls, not the services themselves
   - Test each service independently

**Extension Settings Schema** (registered in `contributes.configuration`):
```jsonc
{
  "mfh.repo": { "type": "string", "description": "Full git URL of the repository" },
  "mfh.repoName": { "type": "string", "description": "owner/repo format" },
  "mfh.referenceGitPath": { "type": "string", "description": "Path to local reference repo for branch detection" },
  "mfh.clonesDir": { "type": "string", "description": "Directory where PR clones are stored" },
  "mfh.baseBranch": { "type": "string", "default": "main", "description": "Default base branch" },
  "mfh.sessionPrefix": { "type": "string", "default": "pr-", "description": "Tmux session name prefix" },
  "mfh.dangerouslySkipPermissions": { "type": "boolean", "default": false },
  "mfh.guidelines.branchFormat": { "type": "string" },
  "mfh.guidelines.commitFormat": { "type": "string" }
}
```

**Status**: Complete

---

## Stage 2: Unified Sidebar Tree View + Terminal Integration (MVP)

**Goal**: The user can see all their PRs, see session status, open terminals, and manage sessions — the first complete user journey.

**Success Criteria**:
- "MainframeHub" Activity Bar icon with a single unified tree view
- **PR mode** (default): PRs grouped by status — Active Session / Has Clone / Not Set Up / Closed with Clone
- **Session mode** (toggle): tmux sessions grouped by Attached / Detached / Orphaned (no PR)
- Each tree item shows rich info: icon + label (`#123 title`) + description (`branch -> base`) + markdown tooltip (full details)
- Inline actions: max 2 per item (primary action + GitHub link). Destructive actions in context menu only.
- Terminal opens in VS Code via `tmux attach-session`, named `MFH: PR #123 - title`
- Re-opening terminal for same session focuses existing terminal
- Closing VS Code terminal detaches cleanly (tmux session persists)
- Welcome view with prerequisite status when unconfigured
- Auto-refresh on 30s interval (sessions) with manual refresh button
- "Open Clone Folder" action opens clone as workspace folder or in new window

**Checks**:
- Tree view populates with real GitHub data on remote server
- Status icons correctly reflect tmux session and clone state
- Terminal attaches to correct tmux session, typing works
- Closing terminal does not kill tmux session
- Toggle between PR and Session modes works
- PR matching works for both `pr-X` and `mfh-X` naming
- Welcome view shows when `mfh.repo` is not set

**Tasks**:

1. **Tree Data Provider** — single `MfhTreeDataProvider` with mode toggle
   - Implements `vscode.TreeDataProvider<MfhTreeItem>`
   - PR mode: reuses grouping logic from `web/server/api.ts` `/api/prs` endpoint
   - Session mode: uses `DiscoveryService` + `SessionCacheService`
   - Mode toggle via view title action button (`$(list-tree)` / `$(terminal)`)
   - Uses `contextValue` for conditional menu items: `prWithSession`, `prWithClone`, `prNotSetUp`, `prClosed`, `sessionAttached`, `sessionDetached`

2. **Rich tree items**
   - **Label**: `#number short-title` (truncated ~35 chars)
   - **Description**: `branch -> baseBranch` (+ `+2/-1` for ahead/behind when available)
   - **Icon**: `$(terminal)` active, `$(folder)` cloned, `$(cloud)` remote-only, `$(archive)` closed
   - **Tooltip** (MarkdownString):
     ```markdown
     **#17569: Add OAuth login with GitHub integration**

     Branch: `feat/oauth-login` → `next`
     Status: Active (tmux session attached)
     Clone: `/home/user/clones/pr-17569`
     Session: `pr-17569`
     Git: 2 ahead, 1 behind
     Created: 2 hours ago
     ```

3. **Register view container and menus**
   ```jsonc
   // Activity Bar icon + view
   "viewsContainers.activitybar": [{ "id": "mfh-explorer", "title": "MainframeHub", "icon": "..." }]
   "views.mfh-explorer": [{ "id": "mfh.treeView", "name": "MainframeHub" }]

   // Inline actions (max 2 per item)
   "view/item/context" inline group: openTerminal (when prWithSession), setupPR (when prNotSetUp)
   // Context menu: closePR, deleteClone, killSession, openPRInBrowser, openCloneFolder

   // View title: refresh button, create PR button, mode toggle
   "view/title" navigation group: refreshAll, createPR, toggleMode
   ```

4. **Welcome view** — `contributes.viewsWelcome` when `!mfh.isConfigured`
   - Shows prerequisite check results
   - "Configure MainframeHub" button that opens settings

5. **Terminal Manager**
   - `TerminalManager` class tracks open terminals by session ID in a `Map<string, vscode.Terminal>`
   - `openTerminal(sessionId, prContext?)`: creates or focuses terminal
   - Uses `vscode.window.createTerminal({ shellPath: '/usr/bin/tmux', shellArgs: ['attach-session', '-t', sessionId] })`
   - Listens to `vscode.window.onDidCloseTerminal` to clean up tracking (check `terminal.exitStatus` before reuse)
   - Names: `MFH: PR #123 - short title` or `MFH: session-name` for orphans

6. **"Open Clone Folder" action**
   - Context menu on any PR with a clone
   - `vscode.commands.executeCommand('vscode.openFolder', Uri.file(clonePath), { forceNewWindow: true })`
   - Also offer "Add to Workspace" variant for multi-root

7. **Auto-refresh**
   - 30s `setInterval` for session refresh, wrapped in a disposable
   - `EventEmitter`-based refresh for tree view after operations
   - PR cache uses existing 60-min TTL with manual refresh button

**Disposables checklist** — all of the following pushed to `context.subscriptions`:
- Tree view registration
- All command registrations
- Terminal close event listener
- Auto-refresh interval
- Configuration change listener

**Status**: Complete

---

## Stage 3: PR Creation and Setup Flows

**Goal**: Create new PRs with Claude metadata and set up existing PRs — all via native VS Code UI. The core differentiator.

**Success Criteria**:
- **Quick Create** (`mfh.createPR`): InputBox → QuickPick → `withProgress` (8 steps) → auto-open terminal
- **Setup Existing** (`mfh.setupPR`): QuickPick of unset-up PRs → `withProgress` → auto-open terminal
- **Create from Branch** (`mfh.createFromBranch`): QuickPick of user's branches → InputBox for title → `withProgress` → auto-open terminal
- **Resume Session** (`mfh.resumeSession`): opens terminal for existing session WITHOUT re-initializing Claude
- **Initialize Claude** (`mfh.initClaude`): separate explicit command to send Claude handover to a session
- `withProgress` shows step-by-step updates: `[1/8] Generating metadata with Claude...`
- Tree view auto-refreshes after creation/setup
- Success notification includes action buttons: `[Open Terminal] [Open Clone Folder]`

**Checks**:
- Claude metadata generation works via spawn on remote server
- PR created on GitHub matches expectations
- Clone directory created correctly in `clonesDir`
- Tmux session created with correct working directory
- Tree view refreshes showing new PR
- Resume vs Init Claude are distinct operations

**Tasks**:

1. **Quick Create flow** (`mfh.createPR`)
   ```
   1. InputBox: "Describe what this PR should do"
   2. QuickPick: "Select base branch" (populated from config + common branches)
   3. withProgress (Notification location):
      [1/8] Generating PR metadata with Claude...
      [2/8] Cloning repository...
      [3/8] Creating branch...
      [4/8] Creating empty commit...
      [5/8] Pushing to remote...
      [6/8] Creating PR on GitHub...
      [7/8] Setting up clone directory...
      [8/8] Creating tmux session...
   4. Success notification: "PR #123 created! [Open Terminal] [View on GitHub]"
   5. Auto-refresh tree view
   ```
   - Wires directly to `PRService.createNew()` with progress callback
   - If Claude metadata generation fails, show error with "Retry" and "Create Manually" buttons

2. **Setup Existing flow** (`mfh.setupPR`)
   - QuickPick populated with PRs that have status "Not Set Up" (from tree data)
   - Each item shows: `#number title  branch -> base`
   - Wires to `PRService.setupExisting()` with progress callback
   - Also supports direct input of PR number (for PRs not in the list)

3. **Create from Branch flow** (`mfh.createFromBranch`)
   - QuickPick of user's remote branches (from `referenceGitPath`, filtered to exclude branches with existing PRs)
   - InputBox for PR title
   - Wires to `PRService.createFromBranch()` with progress

4. **Resume Session** (`mfh.resumeSession`)
   - Opens terminal for existing session — NO Claude handover
   - Used when a PR already has a session (clone exists, tmux session exists)
   - This is the default action when clicking a "Has Session" PR in the tree view

5. **Initialize Claude** (`mfh.initClaude`)
   - Separate command to send Claude handover context to an existing session
   - InputBox for the task prompt (what should Claude work on)
   - Wires to `HandoverService.initialize()`
   - Available in context menu for PRs with active sessions

6. **Close PR flow** (`mfh.closePR`)
   - Confirmation dialog: "Close PR #123 and delete local clone?"
   - Wires to `PRService.close()` with progress
   - Invalidates caches, refreshes tree view

7. **Delete Clone** (`mfh.deleteClone`)
   - For closed PRs with lingering clones
   - Confirmation dialog
   - Kills tmux session (if any), deletes clone directory

8. **Cleanup notification** (proactive)
   - On activation, check for closed PRs with existing clones
   - If found: `showInformationMessage("N closed PRs have local clones. [Clean Up All] [Dismiss]")`

**Status**: Complete

---

## Stage 4: Commands, Status Bar, and Polish

**Goal**: Full command palette integration, keyboard-driven workflows, status bar, and polish.

**Success Criteria**:
- All operations available via Command Palette with `MFH:` prefix
- **QuickPick PR switcher** (`mfh.openPR`) — searchable list of all PRs with status badges, the primary keyboard-driven navigation
- Status bar shows active session count, clickable to open QuickPick
- `when` clause contexts control command availability
- Settings changes trigger service reconfiguration
- Error messages include "Show Log" action button

**Checks**:
- Every tree view action also works from Command Palette
- Status bar updates reactively when sessions change
- QuickPick shows correct PR status badges
- Commands are disabled when preconditions not met (e.g., `mfh.closePR` disabled when no PR selected)

**Tasks**:

1. **Register all commands** in `contributes.commands`:
   | Command | Title | Context |
   |---------|-------|---------|
   | `mfh.createPR` | MFH: Create New PR | Always |
   | `mfh.setupPR` | MFH: Setup Existing PR | Always |
   | `mfh.createFromBranch` | MFH: Create PR from Branch | Always |
   | `mfh.openPR` | MFH: Open PR (Quick Pick) | Always |
   | `mfh.resumeSession` | MFH: Resume Session | When has sessions |
   | `mfh.initClaude` | MFH: Initialize Claude in Session | When has sessions |
   | `mfh.closePR` | MFH: Close PR | When has PRs |
   | `mfh.deleteClone` | MFH: Delete Clone | When has clones |
   | `mfh.killSession` | MFH: Kill Session | When has sessions |
   | `mfh.openPRInBrowser` | MFH: Open PR on GitHub | When has PRs |
   | `mfh.openCloneFolder` | MFH: Open Clone Folder | When has clones |
   | `mfh.refreshAll` | MFH: Refresh | Always |
   | `mfh.toggleViewMode` | MFH: Toggle PR/Session View | Always |

2. **QuickPick PR Switcher** (`mfh.openPR`)
   ```
   [$(terminal)] #17569 Add OAuth login           feat/oauth -> next       Active
   [$(terminal)] #17432 Fix CI pipeline            fix/ci -> main           Active
   [$(folder)]   #17501 Refactor service layer     refactor/svc -> next     Cloned
   [$(cloud)]    #17488 Update documentation       docs/update -> next      Remote
   ```
   - Selecting an active PR opens its terminal
   - Selecting a cloned PR offers: Resume Session / Init Claude / Open Clone
   - Selecting a remote PR offers: Setup
   - Bound to a keybinding (e.g., `Ctrl+Shift+P` then type "MFH: Open PR")

3. **Status Bar**
   - `StatusBarManager` creates a status bar item
   - Shows: `$(terminal) 3 PRs active` (or `$(circle-slash) MFH: not configured`)
   - Clicking opens the QuickPick PR Switcher
   - Updates on tree refresh events
   - Spinning icon `$(sync~spin)` during background refreshes

4. **`when` clause contexts**
   ```typescript
   vscode.commands.executeCommand('setContext', 'mfh.isConfigured', !!config.repo);
   vscode.commands.executeCommand('setContext', 'mfh.hasActiveSessions', sessionCount > 0);
   vscode.commands.executeCommand('setContext', 'mfh.hasPRs', prCount > 0);
   ```
   - Commands use `enablement` in `package.json` for greyed-out state

5. **Error handling pattern**
   ```typescript
   try {
     await prService.createNew({ prompt });
   } catch (error) {
     const action = await vscode.window.showErrorMessage(
       `Failed to create PR: ${error.message}`,
       'Show Log', 'Retry'
     );
     if (action === 'Show Log') outputChannel.show();
     if (action === 'Retry') { /* retry */ }
   }
   ```

6. **Configuration change handling**
   - `onDidChangeConfiguration` listener triggers `ServiceContainer.reconfigure()`
   - Tree view refreshes
   - Status bar updates

**Status**: Complete

---

## Stage 5: Testing and Packaging

**Goal**: Comprehensive tests and installable `.vsix` package.

**Success Criteria**:
- Unit tests for all services (async spawn-based)
- Integration tests for tree data providers and command handlers
- VS Code extension tests via `@vscode/test-cli`
- `vsce package` produces valid `.vsix`
- Extension installs from `.vsix` on remote Linux server
- All features work end-to-end after install

**Checks**:
- `npm test` passes all tests
- `vsce package` produces valid `.vsix` under 500KB
- Extension activates cleanly on fresh remote server
- All workflows functional: create PR, setup, open terminal, close PR

**Tasks**:

1. **Test infrastructure**
   - `vitest` for unit tests (no VS Code dependency)
   - `@vscode/test-cli` for VS Code integration tests
   - Mock `spawn` calls for unit tests, mock service layer for integration tests

2. **Tier 1: Unit tests** (run fast, no VS Code)
   - `TmuxService` — mock spawn, test argument construction
   - `GitService` — mock spawn, test argument construction
   - `GitHubService` — mock Octokit and spawn, test read/write paths
   - `PRService` — mock all sub-services, test orchestration and progress callbacks
   - `DiscoveryService` — mock sub-services, test session-to-PR matching
   - `PRCacheService` / `SessionCacheService` — test TTL, stale-while-revalidate, invalidation

3. **Tier 2: VS Code integration tests** (need VS Code API)
   - `MfhTreeDataProvider` — test grouping logic, tree item construction, mode toggle
   - `TerminalManager` — test create/focus/cleanup lifecycle
   - Command handlers — test Quick Pick flows (mock user input)
   - `StatusBarManager` — test updates on events

4. **Tier 3: End-to-end tests** (need real tmux/git/gh on Linux)
   - Full create PR → open terminal → close PR flow
   - Setup existing PR → resume session flow
   - Discovery with multiple sessions

5. **Packaging**
   - `vsce package` with clean `.vscodeignore`
   - Verify `.vsix` size (target < 500KB)
   - Test installation on clean remote server

6. **CI pipeline** (GitHub Actions)
   - Build + lint + unit tests on every push
   - Integration tests on PR
   - Package `.vsix` as artifact

**Status**: Not Started

---

## Migration Notes

### What Gets Reused
- `TmuxService` — async-ified, spawn with arg arrays
- `GitService` — async-ified, spawn with arg arrays
- `GitHubService` — reads migrated to Octokit, writes stay as `gh` CLI via spawn
- `ClaudeService` — async-ified, spawn with arg arrays
- `PRService` — orchestration logic reused, progress callback added
- `DiscoveryService` — session discovery logic reused
- `HandoverService` — Claude context initialization reused
- `PRCacheService` — 60-min per-user cache reused
- `SessionCacheService` — 30s cache reused
- `interfaces.ts` — all domain types reused

### What Gets Replaced
| Web App Component | VS Code Replacement |
|---|---|
| Express server | Extension host (direct service calls) |
| REST API routes | VS Code commands |
| xterm.js + WebSocket + node-pty | `vscode.window.createTerminal()` |
| HTML/CSS/JS frontend | Tree view + Quick Picks + `withProgress` |
| GitHub token auth middleware | `vscode.authentication` + `gh auth` |
| `mfh.config.json` | `vscode.workspace.getConfiguration('mfh')` |
| Browser fetch() calls | Direct TypeScript service calls |
| Toast notifications | `vscode.window.showInformationMessage` |
| Progress indicators | `vscode.window.withProgress` |
| `console.log` | `OutputChannel` |
| `localStorage` settings | `ExtensionContext.globalState` |

### What Gets Removed
- `web/` directory entirely (Express, WebSocket, terminal handler, static files)
- `src/cli.ts` (CLI entry point)
- Auth middleware (replaced by `vscode.authentication`)
- Custom terminal infrastructure (`node-pty`, `ws`)
- `express`, `node-pty`, `ws`, `cors` dependencies

### Key Simplifications
1. **No HTTP layer** — extension host calls services directly
2. **No WebSocket terminal** — VS Code terminal API handles everything
3. **No auth management** — `vscode.authentication` provides GitHub tokens
4. **No static file serving** — native VS Code UI components
5. **No custom terminal** — `createTerminal` + tmux attach is all we need
6. **No PATH issues** — always Linux via SSH Remote, tools always in PATH
7. **Resume vs Init are separate** — opening a terminal doesn't force Claude handover

---

## Stage 6: Unified Webview Dashboard

**Goal**: WebviewPanel in VS Code with a postMessage bridge to the ServiceContainer, providing a discoverable landing page with tabs and action buttons.

**Success Criteria**:
- `mfh.openDashboard` command opens a WebviewPanel
- Status bar click opens the dashboard
- My PRs tab shows grouped PR cards with action buttons
- New PR tab with form and progress reporting
- "Open Terminal" uses native VS Code terminal (not xterm.js)
- Both extension host and webview bundles compile
- All 94 existing tests pass

**Files Created**:
- `extension/src/webview/bridge.ts` — MfhBridge interface, postMessage protocol types
- `extension/src/webview/postmessage-bridge.ts` — VS Code webview adapter with correlation IDs
- `extension/src/webview/app.ts` — Webview entry point (2 tabs: My PRs, New PR)
- `extension/src/webview/styles.css` — Retro terminal theme (CSP-compliant)
- `extension/src/views/webview-panel.ts` — WebviewPanelManager + BridgeHandler

**Status**: In Progress (Stage 1 complete, Stages 2-4 pending)

### Stage 6.1: Webview Infrastructure + Bridge
- WebviewPanel with retainContextWhenHidden
- CSP-compliant HTML with nonce-based scripts
- postMessage bridge with correlation IDs (30s query timeout, 5min progress timeout)
- BridgeHandler dispatches to ServiceContainer
- Dual esbuild config (CJS/node + IIFE/browser)
- Status bar click opens dashboard
- **Status**: Complete

### Stage 6.2: Full Webview UI
- All 4 tabs (My PRs, Clones, Branches, New PR)
- Toast notifications, loading/empty states
- Action buttons wired to bridge calls
- Progress display during mutations
- **Status**: Not Started

### Stage 6.3: Browser Host (HTTP Bridge)
- HTTP/fetch bridge adapter for browser context
- Express server serves webview bundle
- Token auth modal for browser
- **Status**: Not Started

### Stage 6.4: Consolidation + Cleanup
- Delete duplicate src/services/
- Simplify tree view
- Reduce commands/index.ts
- **Status**: Not Started

---

### Exec Migration Guide
Every `execSync` call becomes an async `spawn` with argument arrays:

```typescript
// Utility function used by all services
function run(cmd: string, args: string[], options?: { cwd?: string; timeout?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: options?.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options?.timeout ?? 30000,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${cmd} ${args[0]} failed (exit ${code}): ${stderr.trim()}`));
    });
  });
}

// Example migrations:
// Before: execSync(`tmux list-sessions -F "#{session_name}|..."`)
// After:  await run('tmux', ['list-sessions', '-F', '#{session_name}|...'])

// Before: execSync(`git commit -m "${message}"`, { cwd })
// After:  await run('git', ['commit', '-m', message], { cwd })

// Before: execSync(`gh pr list -R ${repo} --json ...`)
// After:  octokit.pulls.list({ owner, repo, state: 'open' })
```
