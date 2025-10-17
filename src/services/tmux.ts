/**
 * Real tmux service - no mocking, just wraps tmux CLI
 */

import { execSync } from 'child_process';

export interface TmuxSession {
  id: string;
  workingDir: string;
  created: Date;
  attached: boolean;
}

export class TmuxService {
  async list(prefix: string): Promise<TmuxSession[]> {
    try {
      const output = execSync(
        `tmux list-sessions -F "#{session_name}|#{pane_current_path}|#{session_created}|#{session_attached}" 2>/dev/null || true`,
        { encoding: 'utf-8' }
      );

      if (!output.trim()) return [];

      return output
        .trim()
        .split('\n')
        .filter(line => line.startsWith(prefix))
        .map(line => {
          const [name, path, created, attached] = line.split('|');
          return {
            id: name,
            workingDir: path,
            created: new Date(parseInt(created, 10) * 1000),
            attached: attached === '1',
          };
        });
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<TmuxSession | null> {
    try {
      const output = execSync(
        `tmux list-sessions -F "#{session_name}|#{pane_current_path}|#{session_created}|#{session_attached}" -f "#{==:#{session_name},${id}}" 2>/dev/null || true`,
        { encoding: 'utf-8' }
      );

      if (!output.trim()) return null;

      const [name, path, created, attached] = output.trim().split('|');
      return {
        id: name,
        workingDir: path,
        created: new Date(parseInt(created, 10) * 1000),
        attached: attached === '1',
      };
    } catch {
      return null;
    }
  }

  async exists(id: string): Promise<boolean> {
    try {
      execSync(`tmux has-session -t "${id}" 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  async create(params: {
    id: string;
    workingDir: string;
    command?: string;
  }): Promise<TmuxSession> {
    const cmd = params.command || 'bash';
    execSync(`tmux new-session -d -s "${params.id}" -c "${params.workingDir}" "${cmd}"`);

    const session = await this.get(params.id);
    if (!session) {
      throw new Error(`Failed to create session ${params.id}`);
    }
    return session;
  }

  async kill(id: string): Promise<void> {
    try {
      execSync(`tmux kill-session -t "${id}"`);
    } catch (error: any) {
      throw new Error(`Failed to kill session ${id}: ${error.message}`);
    }
  }

  async sendKeys(id: string, keys: string): Promise<void> {
    // Escape special characters for shell
    const escaped = keys.replace(/"/g, '\\"');
    execSync(`tmux send-keys -t "${id}" "${escaped}" Enter`);
  }

  async attach(id: string): Promise<void> {
    // This is blocking - attaches to the session
    execSync(`tmux attach-session -t "${id}"`, { stdio: 'inherit' });
  }
}
