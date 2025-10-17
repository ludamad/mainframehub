# MainframeHub Testing Plan

## 🎯 Critical Path Testing

### 1. Claude Handover Flow (MOST IMPORTANT)

This is the core functionality - ensuring Claude receives proper context in tmux.

#### Test A: New PR → Claude Handover
```bash
# Setup
cd /path/to/mainframehub
npm run web

# Steps
1. Open http://localhost:3000
2. Click "NEW PR" tab
3. Enter prompt: "Add a feature that displays user stats"
4. Enter base branch: "main"
5. Click "CREATE PR + SESSION"
6. Wait for toast: "Created PR #XXX: ..."
7. Terminal should open automatically
8. VERIFY: Terminal shows Claude starting
9. VERIFY: Claude receives context about the PR
10. VERIFY: Claude responds with understanding of the task

# Expected Behavior
- Terminal opens and shows `claude` command execution
- After 2 seconds, context is sent in chunks:
  - "I'm working on PR #XXX (branch-name -> main)"
  - "User's request: Add a feature that displays user stats"
  - Guidelines (if configured)
- Claude acknowledges and starts working

# What to Check
✓ Claude session starts successfully
✓ Context is properly formatted
✓ No timeout errors
✓ Claude understands the PR context
✓ Session is saved and discoverable
```

#### Test B: Setup Existing PR → Claude Handover
```bash
# Prerequisites
# - Have an existing open PR (e.g., #17569)

# Steps
1. Open http://localhost:3000
2. Click "SESSIONS" tab
3. Click "SETUP PR" button
4. Enter PR number: 17569
5. Click "SETUP + ATTACH"
6. Wait for toast: "Setup complete: ..."
7. Terminal should open
8. VERIFY: Claude starts with PR context

# Expected Behavior
- Clone is created in ./clones/pr-17569/
- Tmux session mfh-17569 is created
- Terminal opens and connects
- Claude receives existing PR context
- Session appears in Sessions tab

# What to Check
✓ Clone directory exists
✓ Tmux session created
✓ Claude handover works
✓ Can return to session later
```

#### Test C: Reattach to Existing Session
```bash
# Prerequisites
# - Have a session from Test A or B

# Steps
1. Close terminal (click CLOSE button)
2. Verify you're back on Sessions tab
3. Click on the session card
4. VERIFY: Terminal reconnects
5. VERIFY: You can interact with Claude
6. VERIFY: History is preserved

# What to Check
✓ WebSocket reconnects
✓ Terminal shows previous output
✓ Can send new input
✓ Session state preserved
```

---

## 🔗 Deep Linking Tests

### Test D: Direct Session URL
```bash
# Steps
1. Get a session ID (e.g., mfh-17569)
2. Open http://localhost:3000/session/mfh-17569
3. VERIFY: Goes directly to terminal view
4. VERIFY: Connected to correct session

# What to Check
✓ URL routing works
✓ Terminal opens directly
✓ No flash of other content
✓ Session info loads correctly
```

### Test E: Tab URLs
```bash
# Steps
1. Navigate to http://localhost:3000/new-pr
2. VERIFY: NEW PR tab is active
3. Navigate to http://localhost:3000
4. VERIFY: SESSIONS tab is active

# What to Check
✓ Tab state matches URL
✓ Browser back button works
✓ URLs are sharable
```

---

## 🎨 UI/UX Tests

### Test F: Tab Navigation
```bash
# Steps
1. Click "SESSIONS" tab
2. Click "NEW PR" tab
3. Click "SESSIONS" tab again
4. VERIFY: Sessions reload

# What to Check
✓ Tab buttons update
✓ Content switches correctly
✓ Active tab highlighted
✓ Data refreshes when needed
```

### Test G: Modal Interactions
```bash
# Steps
1. Click "SETUP PR" button
2. VERIFY: Modal opens
3. Click outside modal (on backdrop)
4. VERIFY: Modal stays open
5. Click "CANCEL"
6. VERIFY: Modal closes

# What to Check
✓ Modal centers correctly
✓ Focus goes to input
✓ Form validation works
✓ Close button works
```

### Test H: Toast Notifications
```bash
# Steps
1. Trigger various actions
2. VERIFY: Toasts appear
3. VERIFY: Toasts auto-dismiss after 5s
4. VERIFY: Multiple toasts stack

# What to Check
✓ Success toast (green border)
✓ Error toast (red)
✓ Info toast
✓ Animation smooth
```

---

## 📱 Mobile Tests

### Test I: Mobile Layout
```bash
# Steps
1. Open in mobile viewport (375x667)
2. VERIFY: Tabs stack properly
3. VERIFY: Buttons are touch-friendly (≥44px)
4. VERIFY: Terminal scrolls with momentum
5. Try terminal input

# What to Check
✓ No horizontal scroll
✓ Text readable
✓ Buttons tappable
✓ Terminal usable
```

---

## 🔄 Session Discovery Tests

### Test J: Session List
```bash
# Steps
1. Create multiple sessions (3-5)
2. Open Sessions tab
3. VERIFY: All sessions listed
4. VERIFY: Active sessions marked
5. VERIFY: PR info shown

# What to Check
✓ Discovery API works
✓ Session cards render
✓ Active indicator correct
✓ PR details accurate
✓ Click opens terminal
```

### Test K: No Sessions
```bash
# Steps
1. Kill all mfh-* sessions (tmux kill-session -t mfh-*)
2. Open Sessions tab
3. VERIFY: Empty state shown
4. VERIFY: "CREATE NEW PR" button works

# What to Check
✓ Empty message displays
✓ No error thrown
✓ CTA button present
```

---

## 🐛 Error Handling Tests

### Test L: Network Errors
```bash
# Steps
1. Stop web server
2. Try to create new PR
3. VERIFY: Error toast shows
4. Start server
5. Try again
6. VERIFY: Works now

# What to Check
✓ Errors caught gracefully
✓ User-friendly messages
✓ No crashes
✓ Recovery possible
```

### Test M: Invalid PR Number
```bash
# Steps
1. Click "SETUP PR"
2. Enter: 999999999
3. Click "SETUP + ATTACH"
4. VERIFY: Error toast shows
5. VERIFY: Modal closes
6. VERIFY: Can try again

# What to Check
✓ Validation works
✓ Error message clear
✓ Form resets
```

### Test N: Session Not Found
```bash
# Steps
1. Navigate to http://localhost:3000/session/mfh-nonexistent
2. VERIFY: Error shown
3. VERIFY: Doesn't crash

# What to Check
✓ Handles missing session
✓ Error message shown
✓ Can navigate back
```

---

## 🔐 Terminal Tests

### Test O: Terminal Input/Output
```bash
# Steps
1. Open any session
2. Type: ls
3. Press Enter
4. VERIFY: Output appears
5. Type: echo "test"
6. VERIFY: Output correct

# What to Check
✓ Input echoes
✓ Output streams correctly
✓ No lag
✓ Colors work
```

### Test P: Terminal Resize
```bash
# Steps
1. Open terminal
2. Resize browser window
3. VERIFY: Terminal resizes
4. VERIFY: No visual glitches
5. Type long command
6. VERIFY: Wraps correctly

# What to Check
✓ Fit addon works
✓ Resize sent to server
✓ Visual consistency
```

### Test Q: Terminal Close & Reopen
```bash
# Steps
1. Open terminal
2. Start a long-running command
3. Close terminal
4. Reopen same session
5. VERIFY: Command still running
6. VERIFY: Can see output

# What to Check
✓ Session persists
✓ Tmux state preserved
✓ Reconnection works
✓ No data loss
```

---

## 🧪 Automated Testing

### Playwright Tests to Write
```typescript
// test/e2e/critical-path.spec.ts
- "should create new PR and open terminal"
- "should setup existing PR"
- "should list sessions"
- "should attach to session via URL"
- "should handle errors gracefully"

// test/e2e/navigation.spec.ts
- "should navigate between tabs"
- "should support deep linking"
- "should handle browser back/forward"

// test/e2e/terminal.spec.ts
- "should connect to terminal via WebSocket"
- "should send input to terminal"
- "should receive output from terminal"
- "should handle resize"
- "should reconnect on close/reopen"
```

---

## ✅ Testing Checklist

### Before Release
- [ ] All critical path tests pass (A, B, C)
- [ ] Deep linking works (D, E)
- [ ] UI/UX smooth (F, G, H)
- [ ] Mobile usable (I)
- [ ] Session discovery works (J, K)
- [ ] Errors handled (L, M, N)
- [ ] Terminal reliable (O, P, Q)
- [ ] Playwright tests written and passing
- [ ] Claude handover verified manually
- [ ] Documentation updated

### Performance Checks
- [ ] Page load < 2s
- [ ] Terminal latency < 100ms
- [ ] Session list loads < 1s
- [ ] No memory leaks
- [ ] Works with 10+ sessions

### Browser Compatibility
- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Safari (iOS)
- [ ] Chrome Mobile (Android)

---

## 🚨 Critical Success Criteria

The following MUST work perfectly:

1. **Claude Handover**: PR context reaches Claude correctly
2. **Terminal Reliability**: No disconnections, smooth I/O
3. **Session Discovery**: Finds all sessions, shows correct state
4. **Deep Linking**: Share a session URL and it works
5. **Mobile Usable**: Can create PR and use terminal on phone

If any of these fail, do not release.
