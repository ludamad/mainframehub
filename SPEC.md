# MainframeHub (mfh) - Specification

## Overview

MainframeHub is a **tmux-centric** CLI tool for managing PR workflows. The core insight: **tmux sessions are the source of truth**, not external state.

## Core Philosophy

### Tmux-Centric Architecture

Instead of tracking sessions externally and trying to match them to PRs, we reverse the flow:

1. **Sessions are discovered** by listing tmux sessions with our prefix
2. **PRs are derived** by examining the git repository in each session's working directory
3. **No external state** - everything is discovered from tmux + git + GitHub

This is elegant because:
- `tmux ls` tells us all active work
- Git working directory is the PR context
- No synchronization issues
- Natural developer workflow

### The Flow

```
User starts work → mfh creates tmux session in git clone → work happens → mfh derives PR from git repo
```

Not:
```
PR exists in GitHub → try to match to local state → manage complex mapping
```

## Problems from Previous App

### 1. Clone Directory Naming
**Problem**: Inconsistent naming (pr-{number} vs pr-{branch}), branches with slashes broke filesystem
**Solution**: Always use `pr-{number}` for simplicity and reliability

### 2. New PR Prompt Handover
**Problem**: Claude session wasn't receiving the initial prompt correctly
**Solution**: Explicit handover using `claude` CLI with proper escaping and session initialization

### 3. Session Detection
**Problem**: Complex matching logic between sessions, clones, and PRs
**Solution**: Tmux-centric - sessions tell us everything through their working directory

### 4. Testing
**Problem**: Hard to test without real GitHub/filesystem/tmux
**Solution**: Full mock mode using reference git as "GitHub" with in-memory PR data

## Architecture

### Discovery Flow

```typescript
1. Find all tmux sessions with prefix 'mfh-'
2. For each session:
   a. Get working directory from tmux
   b. Run git commands to get repo URL and branch
   c. Query GitHub (or mock) for PR matching repo+branch
   d. Derive PR state
3. Return complete state
```

### CLI Commands

```bash
# List all active sessions with their PRs
mfh list

# Create new PR and session
mfh new "Add dark mode"

# Setup session for existing PR
mfh setup <pr-number>

# Attach to a session
mfh attach <session-id>

# Close PR and cleanup
mfh close <pr-number>

# Sync sessions with GitHub
mfh sync

# Run in mock mode (uses reference git)
mfh --mock list
```

### Session Naming

Sessions are named: `mfh-{pr-number}` or `mfh-{timestamp}` for new PRs before number is known.

### Clone Directory Structure

```
clones/
  pr-17569/        # Always pr-{number}
  pr-17620/
  pr-17696/
```

Simple, consistent, no special characters.

## Mock Mode

### Mock GitHub Implementation

Use the reference git repository AS the GitHub API:

```typescript
class MockGitHub {
  constructor(private referenceGitPath: string) {}

  async listPRs(): Promise<PR[]> {
    // Return in-memory mock PRs
    return this.mockPRs;
  }

  async createPR(params): Promise<PR> {
    // Create mock PR with generated number
    const pr = { number: ++this.nextNumber, ...params };
    this.mockPRs.push(pr);
    return pr;
  }

  // For git operations, delegate to reference repo
  async clone(prNumber): Promise<void> {
    // Copy from reference git to clone directory
    exec(`cp -r ${this.referenceGitPath} clones/pr-${prNumber}`);
  }
}
```

This is elegant because:
- No need to mock git operations
- Use real git repo for all git commands
- Only PR metadata is mocked
- Tests are fast but realistic

### Hybrid Mode (Real Reads, Mock Writes)

```typescript
class HybridGitHub {
  constructor(
    private realGitHub: GitHubAPI,
    private mockWrites: boolean = true
  ) {}

  async listPRs(): Promise<PR[]> {
    return this.realGitHub.listPRs(); // Real read
  }

  async createPR(params): Promise<PR> {
    if (this.mockWrites) {
      // Mock write - don't actually create on GitHub
      return this.mockPR(params);
    }
    return this.realGitHub.createPR(params); // Real write
  }
}
```

## Claude Session Handover

### The Problem

Claude needs to:
1. Start with the user's prompt
2. Understand PR context (number, branch, base branch)
3. Have access to project config (commit format, etc.)

### The Solution

```bash
# Step 1: Create tmux session
tmux new-session -d -s "mfh-${prNumber}" -c "${clonePath}"

# Step 2: Inject initial command into session
tmux send-keys -t "mfh-${prNumber}" "claude" Enter

# Wait for Claude to start
sleep 1

# Step 3: Send the full context as first message
tmux send-keys -t "mfh-${prNumber}" "
I'm working on PR #${prNumber} (${branch} -> ${baseBranch}).

User's request: ${userPrompt}

Project guidelines:
${projectGuidelines}

Please help me implement this. Start by updating the PR title and description, then proceed with implementation.
" Enter
```

Key details:
- Use `tmux send-keys` not `tmux send-command`
- Proper escaping of special characters
- Wait for Claude to fully initialize
- Send complete context in one message

## CLI Implementation

### Command Structure

```typescript
interface Command {
  name: string;
  description: string;
  options?: Option[];
  action: (args: any, services: Services) => Promise<void>;
}

const commands: Command[] = [
  {
    name: 'list',
    description: 'List all active sessions',
    action: async (args, services) => {
      const sessions = await services.tmux.list('mfh-');
      const states = await services.session.discover(sessions);
      // Display formatted output
    }
  },
  {
    name: 'new <prompt>',
    description: 'Create new PR and session',
    options: [
      { name: '--base', description: 'Base branch', default: 'main' }
    ],
    action: async (args, services) => {
      const result = await services.pr.createNew({
        prompt: args.prompt,
        baseBranch: args.base
      });
      // Display result
    }
  },
  // ... more commands
];
```

### Services Interface

```typescript
interface Services {
  tmux: ITmuxService;
  git: IGitService;
  github: IGitHubService;
  claude: IClaudeService;
  session: ISessionDiscoveryService;
  pr: IPRService;
}
```

All services are injected, can be mocked.

## Testing Strategy

### Unit Tests (Mock Mode)

```typescript
describe('Session Discovery', () => {
  it('should discover PR from git working directory', async () => {
    // Setup
    const mockTmux = new MockTmuxService();
    mockTmux.addSession({
      id: 'mfh-17569',
      workingDir: '/clones/pr-17569'
    });

    const mockGit = new MockGitService();
    mockGit.setRepo('/clones/pr-17569', {
      remote: 'https://github.com/test/repo',
      branch: 'feature-branch'
    });

    const mockGitHub = new MockGitHubService();
    mockGitHub.addPR({
      number: 17569,
      branch: 'feature-branch',
      repo: 'test/repo'
    });

    // Execute
    const discovery = new SessionDiscoveryService(mockTmux, mockGit, mockGitHub);
    const states = await discovery.discover();

    // Verify
    expect(states).toHaveLength(1);
    expect(states[0].session.id).toBe('mfh-17569');
    expect(states[0].pr.number).toBe(17569);
  });
});
```

### Integration Tests (Hybrid Mode)

```typescript
describe('List Command (Real GitHub)', () => {
  it('should list real PRs', async () => {
    // Use real GitHub API with mock writes
    const github = new HybridGitHub(
      new RealGitHubAPI(process.env.GITHUB_TOKEN),
      { mockWrites: true }
    );

    // Rest is mocked
    const services = {
      github,
      tmux: new MockTmuxService(),
      git: new MockGitService(),
      // ...
    };

    const result = await commands.list.action({}, services);

    // Verify real PRs are fetched
    expect(result.length).toBeGreaterThan(0);
  });
});
```

### End-to-End Tests (Full Mock)

```typescript
describe('New PR Flow', () => {
  it('should create PR, clone, and start Claude session', async () => {
    const mockEnv = createMockEnvironment();

    await cli.execute(['new', 'Add dark mode'], mockEnv);

    // Verify full flow
    expect(mockEnv.github.prs).toHaveLength(1);
    expect(mockEnv.tmux.sessions).toHaveLength(1);
    expect(mockEnv.git.clones).toHaveLength(1);

    const session = mockEnv.tmux.sessions[0];
    expect(session.commands).toContain('claude');
  });
});
```

## Directory Structure

```
mainframehub/
├── src/
│   ├── cli.ts                 # CLI entry point
│   ├── commands/
│   │   ├── list.ts
│   │   ├── new.ts
│   │   ├── setup.ts
│   │   ├── attach.ts
│   │   ├── close.ts
│   │   └── sync.ts
│   ├── services/
│   │   ├── interfaces.ts      # All service interfaces
│   │   ├── session-discovery.ts
│   │   ├── pr-service.ts
│   │   └── claude-handover.ts
│   ├── impl/
│   │   ├── real/              # Real implementations
│   │   │   ├── github.ts
│   │   │   ├── tmux.ts
│   │   │   ├── git.ts
│   │   │   └── claude.ts
│   │   └── mock/              # Mock implementations
│   │       ├── github.ts      # Uses reference git
│   │       ├── tmux.ts
│   │       ├── git.ts
│   │       └── claude.ts
│   └── models.ts              # Domain models
├── tests/
│   ├── unit/                  # Pure mock tests
│   ├── integration/           # Hybrid tests (real reads)
│   └── e2e/                   # End-to-end flows
└── package.json
```

## Key Implementation Details

### 1. Session Discovery

```typescript
async discover(): Promise<SessionState[]> {
  const sessions = await this.tmux.list('mfh-');

  return Promise.all(sessions.map(async session => {
    // Get git context from working directory
    const remote = await this.git.getRemote(session.workingDir);
    const branch = await this.git.getBranch(session.workingDir);

    // Find matching PR from GitHub
    const repo = parseRepo(remote); // 'owner/repo'
    const pr = await this.github.findPR({ repo, branch });

    return {
      session,
      workingDir: session.workingDir,
      gitRemote: remote,
      gitBranch: branch,
      pr,
      state: this.deriveState(session, pr)
    };
  }));
}
```

### 2. New PR Flow

```typescript
async createNew(params: { prompt: string; baseBranch: string }): Promise<Result> {
  // 1. Generate metadata with Claude
  const metadata = await this.claude.generateMetadata(params.prompt);

  // 2. Create PR on GitHub (or mock)
  const pr = await this.github.createPR({
    branch: metadata.branchName,
    baseBranch: params.baseBranch,
    title: metadata.title,
    body: metadata.body,
    draft: true
  });

  // 3. Clone repository
  const clonePath = `clones/pr-${pr.number}`;
  await this.git.clone(this.config.repo, clonePath, {
    branch: params.baseBranch,
    depth: 1
  });

  // 4. Create and checkout branch
  await this.git.checkout(clonePath, params.baseBranch);
  await this.git.createBranch(clonePath, metadata.branchName);
  await this.git.checkout(clonePath, metadata.branchName);

  // 5. Empty commit and push
  await this.git.commit(clonePath, 'chore: initial commit', { allowEmpty: true });
  await this.git.push(clonePath, { setUpstream: true, force: true });

  // 6. Create tmux session
  const session = await this.tmux.create({
    id: `mfh-${pr.number}`,
    workingDir: clonePath
  });

  // 7. Start Claude with full context
  await this.claudeHandover.initializeSession(session.id, {
    prNumber: pr.number,
    branch: metadata.branchName,
    baseBranch: params.baseBranch,
    userPrompt: params.prompt,
    projectGuidelines: this.config.guidelines
  });

  return { pr, session, clonePath };
}
```

### 3. Mock GitHub Using Reference Git

```typescript
export class MockGitHubService implements IGitHubService {
  private prs: Map<number, PR> = new Map();
  private nextNumber = 10000;

  constructor(
    private referenceGitPath: string,
    private clonesDir: string
  ) {}

  async clone(prNumber: number, branch: string): Promise<void> {
    const target = join(this.clonesDir, `pr-${prNumber}`);

    // Use reference git repo directly
    await execAsync(`git clone --depth 1 --branch ${branch} ${this.referenceGitPath} ${target}`);
  }

  async listPRs(): Promise<PR[]> {
    return Array.from(this.prs.values());
  }

  async createPR(params): Promise<PR> {
    const pr: PR = {
      number: this.nextNumber++,
      ...params,
      state: 'OPEN',
      created: new Date()
    };
    this.prs.set(pr.number, pr);
    return pr;
  }

  // PR data is mocked, git operations use reference repo
}
```

## Configuration

```json
{
  "repo": "https://github.com/AztecProtocol/aztec-packages",
  "referenceGitPath": "/mnt/user-data/adam/aztec-packages",
  "clonesDir": "./clones",
  "baseBranch": "next",
  "sessionPrefix": "mfh-",
  "guidelines": {
    "branchFormat": "ad/TYPE/description",
    "commitFormat": "type: description"
  }
}
```

## Benefits of This Architecture

1. **Tmux-centric** - Natural workflow, sessions are source of truth
2. **Fully testable** - All services mockable, mock GitHub uses reference git
3. **Hybrid testing** - Real GitHub reads, mock writes
4. **Simple state** - No complex session tracking
5. **Reliable** - Git working directory is always correct
6. **Fast tests** - Mock mode runs in milliseconds
7. **Claude handover** - Explicit, tested, reliable

This is the elegant way to manage PR workflows.
