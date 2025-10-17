# Feature Parity with ClaudePR - TODO List

## ✅ Completed
- [x] Retro terminal aesthetic (green monochrome theme)
- [x] Tab-based navigation
- [x] Button-driven interface (no command input)
- [x] Deep linking support (`/session/mfh-123`)
- [x] Sessions list (auto-refreshing)
- [x] New PR creation
- [x] Setup existing PR
- [x] xterm.js terminal with WebSocket
- [x] Toast notifications
- [x] Modal dialogs
- [x] Mobile responsive design

## 🚧 High Priority

### My PRs Tab
- [ ] Add "MY PRS" tab to list all open PRs (not just those with sessions)
- [ ] Fetch PRs from GitHub (`gh pr list --author @me --json number,title,url,headRefName,baseRefName,state,createdAt,updatedAt`)
- [ ] Display PR cards with:
  - PR number, title
  - Branch name
  - Created/updated time
  - Session indicator (if session exists)
  - "ATTACH" button (creates session if needed)
- [ ] Filter options (open/closed/all)
- [ ] Search/filter PRs

### Claude Handover (CRITICAL)
- [ ] **Test handover flow end-to-end**:
  1. Create new PR → session starts → Claude loads
  2. Setup existing PR → session starts → Claude loads with context
  3. Verify Claude receives PR context (number, branch, base, prompt)
- [ ] Verify `ClaudeHandoverService.initialize()` works correctly
- [ ] Test timing (wait 2s for Claude to start before sending context)
- [ ] Test chunking (500 char chunks with 100ms delay)
- [ ] Add guidelines injection from config
- [ ] Test with real PR workflow

### Branch-based PR Creation
- [ ] Add "FROM BRANCH" tab
- [ ] List all branches in repo (`gh api repos/:owner/:repo/branches`)
- [ ] Filter out already-merged branches
- [ ] Show branch cards with:
  - Branch name
  - Last commit info
  - "CREATE PR" button
- [ ] Generate PR title with Claude (like claudepr)
- [ ] Create PR from existing branch
- [ ] Add to API: `POST /api/from-branch` endpoint

## 🔄 Medium Priority

### Session Management
- [ ] Add session kill/cleanup button
- [ ] Show session uptime
- [ ] Show git status in session card (dirty, ahead, behind)
- [ ] Auto-refresh sessions every 10s
- [ ] Session search/filter

### PR Operations
- [ ] Close PR button on session card
- [ ] Reopen closed PR
- [ ] View PR on GitHub button (external link)
- [ ] PR status badges (draft, ready, merged)
- [ ] PR checks/CI status

### Terminal Enhancements
- [ ] Copy to clipboard button
- [ ] Clear terminal button
- [ ] Terminal themes (green/amber/blue)
- [ ] Font size controls
- [ ] Search in terminal output

## 📋 Low Priority

### Settings
- [ ] GitHub token configuration
- [ ] Base branch default
- [ ] Session prefix customization
- [ ] Guidelines editor
- [ ] Theme selector

### Keyboard Shortcuts
- [ ] `Cmd/Ctrl + K` - Quick search sessions
- [ ] `Cmd/Ctrl + N` - New PR
- [ ] `Cmd/Ctrl + T` - New tab
- [ ] `Esc` - Close terminal/modal

### Analytics
- [ ] Session duration tracking
- [ ] PR completion metrics
- [ ] Usage statistics

## 🐛 Known Issues to Fix
- [ ] Terminal doesn't re-attach if connection drops
- [ ] WebSocket doesn't handle reconnection
- [ ] Terminal resize on window resize might glitch
- [ ] Toast notifications stack on top of each other

## 🧪 Testing Requirements (see TESTING_PLAN.md)
- [ ] Manual flow testing (all paths)
- [ ] Playwright E2E tests
- [ ] Deep link testing
- [ ] Mobile testing
- [ ] Claude handover testing (critical)

## 📝 Documentation Needed
- [ ] User guide (how to use mainframehub)
- [ ] API documentation
- [ ] Development setup guide
- [ ] Deployment guide
