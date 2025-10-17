/**
 * Authentication middleware for MainframeHub
 * Validates GitHub tokens to protect computing resources
 */

import { Request, Response, NextFunction } from 'express';
import { spawn } from 'child_process';

/**
 * Validate GitHub token has write access to repository
 */
async function validateGitHubToken(token: string, repo: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Parse repo to owner/repo format
    const match = repo.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    const repoPath = match ? match[1] : repo;

    // Use gh api to check permissions with the provided token
    const proc = spawn('gh', [
      'api',
      `repos/${repoPath}`,
      '--jq', '.permissions.push',
      '-H', `Authorization: token ${token}`
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim() === 'true') {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Get GitHub user from token
 */
async function getUserFromToken(token: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('gh', [
      'api',
      'user',
      '--jq', '.login',
      '-H', `Authorization: token ${token}`
    ]);

    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        resolve(null);
      }
    });

    proc.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Authentication middleware - requires valid GitHub token with write access
 */
export function requireAuth(repo: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        res.status(401).json({
          error: 'Authentication required',
          message: 'GitHub token required in Authorization header'
        });
        return;
      }

      // Validate token has write access
      const hasAccess = await validateGitHubToken(token, repo);

      if (!hasAccess) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Token does not have write access to repository'
        });
        return;
      }

      // Get user from token
      const user = await getUserFromToken(token);
      if (!user) {
        res.status(401).json({
          error: 'Authentication failed',
          message: 'Could not determine user from token'
        });
        return;
      }

      // Store token and user in request for downstream use
      (req as any).githubToken = token;
      (req as any).githubUser = user;
      next();
    } catch (error: any) {
      res.status(500).json({
        error: 'Authentication error',
        message: error.message
      });
    }
  };
}

/**
 * Endpoint to validate a token (doesn't require auth itself)
 */
export function createValidateTokenEndpoint(repo: string) {
  return async (req: Request, res: Response) => {
    try {
      const { token } = req.body;

      if (!token) {
        res.status(400).json({ error: 'Token required' });
        return;
      }

      const hasAccess = await validateGitHubToken(token, repo);

      if (hasAccess) {
        res.json({
          valid: true,
          hasWriteAccess: true,
          message: 'Token is valid and has write access'
        });
      } else {
        res.json({
          valid: false,
          hasWriteAccess: false,
          message: 'Token is invalid or lacks write access'
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}

/**
 * Validate token for WebSocket connections
 */
export async function validateWebSocketToken(token: string, repo: string): Promise<{ valid: boolean; user?: string }> {
  if (!token) {
    return { valid: false };
  }

  const hasAccess = await validateGitHubToken(token, repo);
  if (!hasAccess) {
    return { valid: false };
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return { valid: false };
  }

  return { valid: true, user };
}
