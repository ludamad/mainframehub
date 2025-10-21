# Implementation Plan

## Stage 1: Settings Infrastructure & CLI Permissions Flag
**Goal**: Add settings modal with CLI permissions option that saves to server
**Success Criteria**:
- Settings modal accessible from gear icon
- Checkbox for --dangerously-skip-permissions setting
- Settings saved to server-side storage (per user)
- Settings retrieved on page load
**Checks**: Settings persist across sessions, gear icon works
**Status**: Complete

## Stage 2: Enhanced Session PR Detection
**Goal**: Improve session-to-PR matching based on pwd and git commands in session
**Success Criteria**:
- Sessions correctly detect their PR based on git branch in pwd
- Detection works for cloned directories and existing repos
- Session cards display correct PR information
**Checks**: Manual testing with multiple sessions
**Status**: Complete - Now discovers ALL sessions, not just prefixed ones

## Stage 3: Branch Search Fix
**Goal**: Fix branch search to detect all user branches (not just recent commits)
**Success Criteria**:
- All branches where user is the author are detected
- Branch search doesn't rely on last committer only
- Protected branches are indicated
**Checks**: Test with branches that have commits from multiple users
**Status**: Complete - Now checks all commits on branch, not just last one

## Stage 4: Prompt Optimization
**Goal**: Optimize prompts for better dev flow
**Success Criteria**:
- Prompts guide users through common workflows
- Clear examples and placeholders
- Better error messages
**Checks**: Manual review of all prompts
**Status**: Complete - Improved metadata generation and handover prompts, added better UI hints

## Stage 5: Server-Side Caching
**Status**: SCRAPPED - Focusing on correctness instead
