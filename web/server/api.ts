import { Express, Request, Response, RequestHandler } from 'express';
import { DiscoveryService } from '../../src/services/discovery.js';
import { SessionCacheService } from '../../src/services/session-cache.js';
import { PRCacheService } from '../../src/services/pr-cache.js';
import { PRService } from '../../src/services/pr-service.js';
import type { PullRequest } from '../../src/services/github.js';
import { writeFileSync } from 'fs';

interface APIServices {
  discovery: DiscoveryService;
  sessionCache: SessionCacheService;
  prCache: PRCacheService;
  prService: PRService;
  github: any;
  config: any;
  configPath: string;
}

interface UserSettings {
  dangerouslySkipPermissions?: boolean;
}

// Export function to get user settings from config
export function getUserSettings(config: any): UserSettings {
  return {
    dangerouslySkipPermissions: config.dangerouslySkipPermissions ?? false
  };
}

export function setupAPI(app: Express, services: APIServices, authMiddleware: RequestHandler) {
  const { discovery, sessionCache, prCache, prService, github, config, configPath } = services;

  // GET /api/discover - List all sessions with PR info (cached)
  app.get('/api/discover', authMiddleware, async (req: Request, res: Response) => {
    try {
      const states = await sessionCache.get();
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

  // POST /api/discover/refresh - Trigger cache refresh (called on page load)
  app.post('/api/discover/refresh', authMiddleware, async (req: Request, res: Response) => {
    try {
      // Trigger background refresh without waiting
      sessionCache.refresh().catch(error => {
        console.error('Background cache refresh failed:', error);
      });
      res.json({ success: true, message: 'Cache refresh triggered' });
    } catch (error: any) {
      console.error('Error triggering cache refresh:', error);
      res.status(500).json({
        error: 'Failed to trigger cache refresh',
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

      // Get user settings from config
      const settings = getUserSettings(config);

      const result = await prService.createNew({
        prompt: prompt.trim(),
        baseBranch: baseBranch || config.baseBranch,
        skipPermissions: settings.dangerouslySkipPermissions
      });

      // Invalidate PR cache for this user
      prCache.invalidate(currentUser).catch(error => {
        console.error('Failed to invalidate PR cache:', error);
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

      // Get user settings from config
      const settings = getUserSettings(config);

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

      // Get user settings from config
      const settings = getUserSettings(config);

      const result = await prService.createFromBranch({
        branchName: branchName.trim(),
        title: title.trim(),
        baseBranch: baseBranch || config.baseBranch,
        skipPermissions: settings.dangerouslySkipPermissions
      });

      // Invalidate PR cache for this user
      prCache.invalidate(currentUser).catch(error => {
        console.error('Failed to invalidate PR cache:', error);
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

  // GET /api/prs - List current user's PRs with clone/session status (cached)
  app.get('/api/prs', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { existsSync, readdirSync, statSync } = await import('fs');
      const { join } = await import('path');
      const { execSync } = await import('child_process');

      // Get current GitHub user from auth middleware
      const currentUser = (req as any).githubUser;

      // Get user's open PRs from cache
      const openPRs = await prCache.get(currentUser);

      // List all clone directories
      const clones = new Map<string, { path: string; prNumber: number | null }>();
      if (existsSync(config.clonesDir)) {
        const dirs = readdirSync(config.clonesDir);
        for (const dir of dirs) {
          const fullPath = join(config.clonesDir, dir);
          if (statSync(fullPath).isDirectory()) {
            // Extract PR number from directory name (e.g., "pr-123" -> 123)
            const match = dir.match(/^pr-(\d+)$/);
            const prNumber = match ? parseInt(match[1], 10) : null;
            clones.set(dir, { path: fullPath, prNumber });
          }
        }
      }

      // Get all active tmux sessions
      const activeSessions = new Set<string>();
      try {
        const tmuxList = execSync('tmux list-sessions -F "#{session_name}"', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        tmuxList.trim().split('\n').forEach(name => {
          if (name) activeSessions.add(name);
        });
      } catch (e) {
        // No sessions or tmux not running
      }

      // Match open PRs with clones and sessions
      const openPRsWithStatus = openPRs.map((pr: PullRequest) => {
        const cloneName = `pr-${pr.number}`;
        const newSessionId = `pr-${pr.number}`;
        const oldSessionId = `${config.sessionPrefix}${pr.number}`;
        const clone = clones.get(cloneName);
        const hasClone = !!clone;

        // Check both new and old session naming conventions
        const hasNewSession = activeSessions.has(newSessionId);
        const hasOldSession = activeSessions.has(oldSessionId);
        const hasSession = hasClone && (hasNewSession || hasOldSession);
        const sessionId = hasNewSession ? newSessionId : hasOldSession ? oldSessionId : newSessionId;

        if (clone) {
          // Remove from clones map so we can find orphaned clones later
          clones.delete(cloneName);
        }

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
          sessionId,
          cloneName,
          hasClone,
          hasSession,
          clonePath: clone?.path || null
        };
      });

      // For remaining clones (closed PRs or orphaned), fetch PR info from GitHub
      const closedPRsWithClones: any[] = [];
      for (const [cloneName, clone] of clones.entries()) {
        if (clone.prNumber) {
          try {
            const pr = await github.getPR(config.repoName, clone.prNumber);
            if (pr.state === 'closed') {
              const newSessionId = `pr-${clone.prNumber}`;
              const oldSessionId = `${config.sessionPrefix}${clone.prNumber}`;

              // Check both new and old session naming conventions
              const hasNewSession = activeSessions.has(newSessionId);
              const hasOldSession = activeSessions.has(oldSessionId);
              const hasSession = hasNewSession || hasOldSession;
              const sessionId = hasNewSession ? newSessionId : hasOldSession ? oldSessionId : newSessionId;

              closedPRsWithClones.push({
                pr: {
                  number: pr.number,
                  title: pr.title,
                  url: pr.url,
                  state: pr.state,
                  isDraft: pr.isDraft,
                  branch: pr.branch,
                  baseBranch: pr.baseBranch
                },
                sessionId,
                cloneName,
                hasClone: true,
                hasSession,
                clonePath: clone.path
              });
            }
          } catch (e) {
            // PR might have been deleted, skip it
          }
        }
      }

      res.json({
        prs: [...openPRsWithStatus, ...closedPRsWithClones]
      });
    } catch (error: any) {
      console.error('Error listing PRs:', error);
      res.status(500).json({
        error: 'Failed to list PRs',
        message: error.message
      });
    }
  });

  // POST /api/prs/refresh - Trigger PR cache refresh (called on page load)
  app.post('/api/prs/refresh', authMiddleware, async (req: Request, res: Response) => {
    try {
      const currentUser = (req as any).githubUser;

      // Trigger background refresh without waiting
      prCache.refresh(currentUser).catch(error => {
        console.error('Background PR cache refresh failed:', error);
      });

      res.json({ success: true, message: 'PR cache refresh triggered' });
    } catch (error: any) {
      console.error('Error triggering PR cache refresh:', error);
      res.status(500).json({
        error: 'Failed to trigger PR cache refresh',
        message: error.message
      });
    }
  });

  // DELETE /api/clones/:cloneName - Delete a clone directory
  app.delete('/api/clones/:cloneName', authMiddleware, async (req: Request, res: Response) => {
    try {
      const { cloneName } = req.params;
      const { existsSync, rmSync } = await import('fs');
      const { join } = await import('path');
      const { execSync } = await import('child_process');

      // Validate clone name format
      if (!/^pr-\d+$/.test(cloneName)) {
        return res.status(400).json({ error: 'Invalid clone name format' });
      }

      const clonePath = join(config.clonesDir, cloneName);

      if (!existsSync(clonePath)) {
        return res.status(404).json({ error: 'Clone not found' });
      }

      // Check if there's an active session and kill it (try both naming conventions)
      const prNumber = cloneName.match(/^pr-(\d+)$/)?.[1];
      if (prNumber) {
        const newSessionId = `pr-${prNumber}`;
        const oldSessionId = `${config.sessionPrefix}${prNumber}`;

        try {
          execSync(`tmux kill-session -t "${newSessionId}"`, {
            stdio: ['pipe', 'pipe', 'pipe']
          });
        } catch (e) {
          // Session doesn't exist, try old naming
          try {
            execSync(`tmux kill-session -t "${oldSessionId}"`, {
              stdio: ['pipe', 'pipe', 'pipe']
            });
          } catch (e2) {
            // Neither session exists, that's fine
          }
        }
      }

      // Delete the clone directory
      rmSync(clonePath, { recursive: true, force: true });

      res.json({ success: true, message: `Clone ${cloneName} deleted` });
    } catch (error: any) {
      console.error('Error deleting clone:', error);
      res.status(500).json({
        error: 'Failed to delete clone',
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

      // Get session to find working directory from cache
      const states = await sessionCache.get();
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

  // GET /api/settings - Get user settings from config
  app.get('/api/settings', authMiddleware, (req: Request, res: Response) => {
    try {
      const settings = getUserSettings(config);
      res.json(settings);
    } catch (error: any) {
      console.error('Error getting settings:', error);
      res.status(500).json({
        error: 'Failed to get settings',
        message: error.message
      });
    }
  });

  // POST /api/settings - Update user settings in config file
  app.post('/api/settings', authMiddleware, (req: Request, res: Response) => {
    try {
      const { dangerouslySkipPermissions } = req.body;

      // Update config object
      if (typeof dangerouslySkipPermissions === 'boolean') {
        config.dangerouslySkipPermissions = dangerouslySkipPermissions;
      }

      // Write updated config back to file
      writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

      const settings = getUserSettings(config);
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
