import { Express, Request, Response, RequestHandler } from 'express';
import { DiscoveryService } from '../../src/services/discovery.js';
import { PRService } from '../../src/services/pr-service.js';
import type { PullRequest } from '../../src/services/github.js';

interface APIServices {
  discovery: DiscoveryService;
  prService: PRService;
  github: any;
  config: any;
}

interface UserSettings {
  dangerouslySkipPermissions?: boolean;
}

// In-memory user settings storage (per user)
const userSettings = new Map<string, UserSettings>();

// Export function to get user settings
export function getUserSettings(username: string): UserSettings {
  return userSettings.get(username) || {};
}

export function setupAPI(app: Express, services: APIServices, authMiddleware: RequestHandler) {
  const { discovery, prService, github, config } = services;

  // GET /api/discover - List all sessions with PR info
  app.get('/api/discover', authMiddleware, async (req: Request, res: Response) => {
    try {
      const states = await discovery.discover();
      res.json({
        sessions: states.map(state => ({
          sessionId: state.session.id,
          workingDir: state.session.workingDir,
          isActive: state.isActive,
          hasGit: state.hasGit,
          hasPR: state.hasPR,
          git: state.gitInfo ? {
            repo: state.gitInfo.repo,
            branch: state.gitInfo.branch,
            remote: state.gitInfo.remote,
            isDirty: state.gitInfo.isDirty,
            ahead: state.gitInfo.ahead,
            behind: state.gitInfo.behind
          } : null,
          pr: state.pr ? {
            number: state.pr.number,
            title: state.pr.title,
            url: state.pr.url,
            state: state.pr.state,
            isDraft: state.pr.isDraft,
            branch: state.pr.branch,
            baseBranch: state.pr.baseBranch
          } : null
        }))
      });
    } catch (error: any) {
      console.error('Error discovering sessions:', error);
      res.status(500).json({
        error: 'Failed to discover sessions',
        message: error.message
      });
    }
  });

  // POST /api/new - Create new PR + session
  app.post('/api/new', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { prompt, baseBranch } = req.body;
      const currentUser = (req as any).githubUser;

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'prompt is required and must be a non-empty string'
        });
      }

      // Get user settings
      const settings = getUserSettings(currentUser);

      const result = await prService.createNew({
        prompt: prompt.trim(),
        baseBranch: baseBranch || config.baseBranch,
        skipPermissions: settings.dangerouslySkipPermissions
      });

      res.json({
        success: true,
        pr: {
          number: result.pr.number,
          title: result.pr.title,
          url: result.pr.url,
          branch: result.pr.branch,
          baseBranch: result.pr.baseBranch
        },
        session: {
          id: result.session.id,
          workingDir: result.session.workingDir
        },
        clonePath: result.clonePath
      });
    } catch (error: any) {
      console.error('Error creating new PR:', error);
      res.status(500).json({
        error: 'Failed to create new PR',
        message: error.message
      });
    }
  });

  // POST /api/setup/:prNumber - Setup existing PR
  app.post('/api/setup/:prNumber', authMiddleware, async (req: Request, res: Response) => {
    try {
      const prNumber = parseInt(req.params.prNumber);
      const { baseBranch } = req.body;
      const currentUser = (req as any).githubUser;

      if (isNaN(prNumber) || prNumber <= 0) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'prNumber must be a positive integer'
        });
      }

      // Get user settings
      const settings = getUserSettings(currentUser);

      const result = await prService.setupExisting(prNumber, settings.dangerouslySkipPermissions);

      res.json({
        success: true,
        pr: {
          number: result.pr.number,
          title: result.pr.title,
          url: result.pr.url,
          branch: result.pr.branch,
          baseBranch: result.pr.baseBranch
        },
        session: {
          id: result.session.id,
          workingDir: result.session.workingDir
        },
        clonePath: result.clonePath
      });
    } catch (error: any) {
      console.error(`Error setting up PR #${req.params.prNumber}:`, error);
      res.status(500).json({
        error: 'Failed to setup PR',
        message: error.message
      });
    }
  });

  // POST /api/from-branch - Create PR from existing branch
  app.post('/api/from-branch', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { branchName, title, baseBranch } = req.body;
      const currentUser = (req as any).githubUser;

      if (!branchName || typeof branchName !== 'string' || branchName.trim().length === 0) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'branchName is required and must be a non-empty string'
        });
      }

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'title is required and must be a non-empty string'
        });
      }

      // Get user settings
      const settings = getUserSettings(currentUser);

      const result = await prService.createFromBranch({
        branchName: branchName.trim(),
        title: title.trim(),
        baseBranch: baseBranch || config.baseBranch,
        skipPermissions: settings.dangerouslySkipPermissions
      });

      res.json({
        success: true,
        pr: {
          number: result.pr.number,
          title: result.pr.title,
          url: result.pr.url,
          branch: result.pr.branch,
          baseBranch: result.pr.baseBranch
        },
        session: {
          id: result.session.id,
          workingDir: result.session.workingDir
        },
        clonePath: result.clonePath
      });
    } catch (error: any) {
      console.error('Error creating PR from branch:', error);
      res.status(500).json({
        error: 'Failed to create PR from branch',
        message: error.message
      });
    }
  });

  // POST /api/close/:prNumber - Close PR + cleanup
  app.post('/api/close/:prNumber', authMiddleware, async (req: Request, res: Response) => {
    try {
      const prNumber = parseInt(req.params.prNumber);

      if (isNaN(prNumber) || prNumber <= 0) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'prNumber must be a positive integer'
        });
      }

      await prService.close(prNumber);

      res.json({
        success: true,
        message: `PR #${prNumber} closed and cleaned up`
      });
    } catch (error: any) {
      console.error(`Error closing PR #${req.params.prNumber}:`, error);
      res.status(500).json({
        error: 'Failed to close PR',
        message: error.message
      });
    }
  });

  // GET /api/prs - List current user's PRs with clone/session status
  app.get('/api/prs', authMiddleware, async (req: Request, res: Response) => {
    try {
      // Get current GitHub user from auth middleware
      const currentUser = (req as any).githubUser;

      // Get user's PRs from GitHub
      const allPRs = await github.listPRs(config.repoName, {
        state: 'open',
        author: currentUser
      });

      // Get all sessions
      const sessions = await discovery.discover();

      // Match PRs with sessions/clones
      const prsWithStatus = allPRs.map((pr: PullRequest) => {
        const sessionId = `${config.sessionPrefix}${pr.number}`;
        const session = sessions.find(s => s.session.id === sessionId);
        const hasClone = !!session;
        const clonePath = session ? session.session.workingDir : null;

        return {
          pr: {
            number: pr.number,
            title: pr.title,
            url: pr.url,
            state: pr.state,
            isDraft: pr.isDraft,
            branch: pr.branch,
            baseBranch: pr.baseBranch
          },
          session: session ? {
            id: session.session.id,
            workingDir: session.session.workingDir
          } : null,
          hasClone,
          clonePath
        };
      });

      res.json({
        prs: prsWithStatus
      });
    } catch (error: any) {
      console.error('Error listing PRs:', error);
      res.status(500).json({
        error: 'Failed to list PRs',
        message: error.message
      });
    }
  });

  // GET /api/branches - List user's branches
  app.get('/api/branches', authMiddleware, async (req: Request, res: Response) => {
    try {
      // Get current GitHub user from auth middleware
      const currentUser = (req as any).githubUser;
      const { execSync } = await import('child_process');

      // Validate config.repo exists
      if (!config.repo) {
        throw new Error('Reference git repository path not configured');
      }

      // Get all open PRs to exclude branches that already have PRs
      const openPRs = await github.listPRs(config.repoName, { state: 'open' });
      const prBranches = new Set(openPRs.map((pr: any) => pr.branch));

      // Fetch ALL branches from remote in reference git folder
      try {
        execSync(`git -C "${config.repo}" fetch --all --prune`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore']
        });
      } catch (fetchError: any) {
        throw new Error(`Failed to fetch branches from ${config.repo}: ${fetchError.message}`);
      }

      // Get all remote branches from the reference git folder
      const branchOutput = execSync(
        `git -C "${config.repo}" branch -r --format='%(refname:short)'`,
        { encoding: 'utf-8' }
      );
      const allBranches = branchOutput
        .trim()
        .split('\n')
        .filter(line => line.startsWith('origin/'))
        .map(line => line.replace('origin/', ''))
        .filter(line => line && line !== 'HEAD');

      // Get current user's email from token
      const userEmail = execSync('gh api user --jq .email', { encoding: 'utf-8' }).trim();

      // For each branch, check if the LAST commit is by the current user
      const userBranches = [];
      for (const branchName of allBranches) {
        // Skip branches that already have PRs
        if (prBranches.has(branchName)) {
          continue;
        }

        try {
          // Get the author email of the last commit on this branch
          const lastCommitAuthor = execSync(
            `git -C "${config.repo}" log -1 --format=%ae origin/${branchName} 2>/dev/null`,
            { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
          ).trim();

          // Check if the last commit is by the current user
          if (lastCommitAuthor === userEmail) {
            // Check if protected
            const protectedStatus = execSync(
              `gh api "repos/${config.repoName}/branches/${branchName}" --jq .protected`,
              { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
            ).trim();

            userBranches.push({
              name: branchName,
              protected: protectedStatus === 'true'
            });
          }
        } catch (error) {
          // Branch might not exist or other error, skip it
          continue;
        }
      }

      res.json({ branches: userBranches });
    } catch (error: any) {
      console.error('Error listing branches:', error);
      res.status(500).json({
        error: 'Failed to list branches',
        message: error.message
      });
    }
  });

  // GET /api/config - Get server config
  app.get('/api/config', authMiddleware, (req: Request, res: Response) => {
    res.json({
      repo: config.repo,
      repoName: config.repoName,
      baseBranch: config.baseBranch,
      sessionPrefix: config.sessionPrefix,
      guidelines: config.guidelines || {}
    });
  });

  // GET /api/sessions/:sessionId/git-status - Get git branch sync status
  app.get('/api/sessions/:sessionId/git-status', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const { spawn } = await import('child_process');

      // Get session to find working directory
      const states = await discovery.discover();
      const state = states.find(s => s.session.id === sessionId);

      if (!state || !state.session.workingDir) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const workingDir = state.session.workingDir;

      // Helper to run git commands
      const runGit = (args: string[]): Promise<string> => {
        return new Promise((resolve, reject) => {
          const proc = spawn('git', args, { cwd: workingDir });
          let output = '';
          proc.stdout.on('data', (data) => output += data.toString());
          proc.on('close', (code) => {
            if (code === 0) {
              resolve(output.trim());
            } else {
              reject(new Error(`git ${args[0]} failed`));
            }
          });
        });
      };

      // 1. Fetch latest from remote
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('git', ['fetch', 'origin'], { cwd: workingDir });
        proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('git fetch failed')));
      });

      // 2. Get current branch
      const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);

      // 3. Get local and remote commit hashes
      const localHash = await runGit(['rev-parse', 'HEAD']);
      const remoteHash = await runGit(['rev-parse', `origin/${branch}`]).catch(() => null);

      if (!remoteHash) {
        return res.json({ branch, status: 'no-remote', message: 'No remote branch' });
      }

      // 4. Check sync status
      if (localHash === remoteHash) {
        return res.json({ branch, status: 'in-sync', message: null });
      }

      // 5. Check ahead/behind
      const isAncestor = (ancestor: string, descendant: string): Promise<boolean> => {
        return new Promise((resolve) => {
          const proc = spawn('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: workingDir });
          proc.on('close', (code) => resolve(code === 0));
        });
      };

      const localIsAhead = await isAncestor(remoteHash, localHash);
      const remoteIsAhead = await isAncestor(localHash, remoteHash);

      if (localIsAhead && !remoteIsAhead) {
        res.json({ branch, status: 'ahead', message: 'Push needed' });
      } else if (remoteIsAhead && !localIsAhead) {
        res.json({ branch, status: 'behind', message: 'Pull needed' });
      } else {
        res.json({ branch, status: 'diverged', message: 'Merge needed' });
      }
    } catch (error: any) {
      console.error(`Error getting git status for session ${req.params.sessionId}:`, error);
      res.status(500).json({
        error: 'Failed to get git status',
        message: error.message
      });
    }
  });

  // GET /api/settings - Get user settings
  app.get('/api/settings', authMiddleware, (req: Request, res: Response) => {
    try {
      const currentUser = (req as any).githubUser;
      const settings = userSettings.get(currentUser) || {};
      res.json(settings);
    } catch (error: any) {
      console.error('Error getting settings:', error);
      res.status(500).json({
        error: 'Failed to get settings',
        message: error.message
      });
    }
  });

  // POST /api/settings - Update user settings
  app.post('/api/settings', authMiddleware, (req: Request, res: Response) => {
    try {
      const currentUser = (req as any).githubUser;
      const { dangerouslySkipPermissions } = req.body;

      const settings: UserSettings = {};
      if (typeof dangerouslySkipPermissions === 'boolean') {
        settings.dangerouslySkipPermissions = dangerouslySkipPermissions;
      }

      userSettings.set(currentUser, settings);
      res.json({ success: true, settings });
    } catch (error: any) {
      console.error('Error saving settings:', error);
      res.status(500).json({
        error: 'Failed to save settings',
        message: error.message
      });
    }
  });
}
