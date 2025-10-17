/**
 * GitHub service with mock-writes mode
 *
 * Reads are always real (uses gh CLI or Octokit)
 * Writes can be mocked (stored in memory instead of GitHub)
 */

import { execSync } from 'child_process';

export interface PullRequest {
  number: number;
  title: string;
  branch: string;
  baseBranch: string;
  repo: string;  // 'owner/repo' format
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  author: string;
  isDraft: boolean;
  created: Date;
  updated: Date;
}

export class GitHubService {
  private mockWrites: boolean;
  private mockPRs: Map<string, PullRequest[]> = new Map(); // repo -> PRs
  private nextMockNumber = 10000;

  constructor(options?: { mockWrites?: boolean }) {
    this.mockWrites = options?.mockWrites || false;
  }

  /**
   * List PRs (always real read)
   */
  async listPRs(repo: string, options?: {
    author?: string;
    state?: 'open' | 'closed' | 'all';
  }): Promise<PullRequest[]> {
    // If mock writes are enabled, return mock PRs + real PRs
    if (this.mockWrites) {
      const mockPRs = this.mockPRs.get(repo) || [];
      try {
        const realPRs = await this.listPRsReal(repo, options);
        return [...mockPRs, ...realPRs];
      } catch {
        return mockPRs;
      }
    }

    return this.listPRsReal(repo, options);
  }

  private async listPRsReal(repo: string, options?: {
    author?: string;
    state?: 'open' | 'closed' | 'all';
  }): Promise<PullRequest[]> {
    try {
      let cmd = `gh pr list -R ${repo} --json number,title,headRefName,baseRefName,state,url,author,isDraft,createdAt,updatedAt`;

      if (options?.state && options.state !== 'all') {
        cmd += ` --state ${options.state}`;
      }
      if (options?.author) {
        cmd += ` --author ${options.author}`;
      }

      const output = execSync(cmd, { encoding: 'utf-8' });
      const data = JSON.parse(output);

      return data.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        branch: pr.headRefName,
        baseBranch: pr.baseRefName,
        repo,
        state: pr.state,
        url: pr.url,
        author: pr.author?.login || 'unknown',
        isDraft: pr.isDraft,
        created: new Date(pr.createdAt),
        updated: new Date(pr.updatedAt),
      }));
    } catch (error: any) {
      throw new Error(`Failed to list PRs: ${error.message}`);
    }
  }

  /**
   * Find PR by branch (always real read)
   */
  async findPR(params: { repo: string; branch: string }): Promise<PullRequest | null> {
    const prs = await this.listPRs(params.repo, { state: 'open' });
    return prs.find(pr => pr.branch === params.branch) || null;
  }

  /**
   * Get specific PR (always real read)
   */
  async getPR(repo: string, number: number): Promise<PullRequest | null> {
    // Check mocks first if mock writes enabled
    if (this.mockWrites) {
      const mockPRs = this.mockPRs.get(repo) || [];
      const mockPR = mockPRs.find(pr => pr.number === number);
      if (mockPR) return mockPR;
    }

    try {
      const output = execSync(
        `gh pr view ${number} -R ${repo} --json number,title,headRefName,baseRefName,state,url,author,isDraft,createdAt,updatedAt`,
        { encoding: 'utf-8' }
      );
      const pr = JSON.parse(output);

      return {
        number: pr.number,
        title: pr.title,
        branch: pr.headRefName,
        baseBranch: pr.baseRefName,
        repo,
        state: pr.state,
        url: pr.url,
        author: pr.author?.login || 'unknown',
        isDraft: pr.isDraft,
        created: new Date(pr.createdAt),
        updated: new Date(pr.updatedAt),
      };
    } catch {
      return null;
    }
  }

  /**
   * Create PR (mocked if mockWrites is true)
   */
  async createPR(params: {
    repo: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<PullRequest> {
    if (this.mockWrites) {
      return this.createPRMock(params);
    }
    return this.createPRReal(params);
  }

  private async createPRMock(params: {
    repo: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<PullRequest> {
    const pr: PullRequest = {
      number: this.nextMockNumber++,
      title: params.title,
      branch: params.branch,
      baseBranch: params.baseBranch,
      repo: params.repo,
      state: 'OPEN',
      url: `https://github.com/${params.repo}/pull/${this.nextMockNumber - 1}`,
      author: 'mockuser',
      isDraft: params.draft || false,
      created: new Date(),
      updated: new Date(),
    };

    if (!this.mockPRs.has(params.repo)) {
      this.mockPRs.set(params.repo, []);
    }
    this.mockPRs.get(params.repo)!.push(pr);

    console.log(`[MOCK] Created PR #${pr.number}: ${pr.title}`);
    return pr;
  }

  private async createPRReal(params: {
    repo: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<PullRequest> {
    let cmd = `gh pr create -R ${params.repo} --head ${params.branch} --base ${params.baseBranch} --title "${params.title}" --body "${params.body}"`;
    if (params.draft) {
      cmd += ' --draft';
    }

    try {
      const url = execSync(cmd, { encoding: 'utf-8' }).trim();
      const numberMatch = url.match(/\/pull\/(\d+)$/);
      if (!numberMatch) {
        throw new Error('Failed to parse PR number from URL');
      }

      const number = parseInt(numberMatch[1], 10);
      const pr = await this.getPR(params.repo, number);
      if (!pr) {
        throw new Error('PR created but not found');
      }
      return pr;
    } catch (error: any) {
      throw new Error(`Failed to create PR: ${error.message}`);
    }
  }

  /**
   * Update PR (mocked if mockWrites is true)
   */
  async updatePR(repo: string, number: number, updates: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
  }): Promise<void> {
    if (this.mockWrites) {
      const mockPRs = this.mockPRs.get(repo) || [];
      const pr = mockPRs.find(p => p.number === number);
      if (pr) {
        if (updates.title) pr.title = updates.title;
        if (updates.state) pr.state = updates.state === 'closed' ? 'CLOSED' : 'OPEN';
        pr.updated = new Date();
        console.log(`[MOCK] Updated PR #${number}`);
      }
      return;
    }

    let cmd = `gh pr edit ${number} -R ${repo}`;
    if (updates.title) {
      cmd += ` --title "${updates.title}"`;
    }
    if (updates.body) {
      cmd += ` --body "${updates.body}"`;
    }

    try {
      execSync(cmd, { stdio: 'pipe' });
    } catch (error: any) {
      throw new Error(`Failed to update PR: ${error.message}`);
    }
  }

  /**
   * Close PR (mocked if mockWrites is true)
   */
  async closePR(repo: string, number: number): Promise<void> {
    if (this.mockWrites) {
      const mockPRs = this.mockPRs.get(repo) || [];
      const pr = mockPRs.find(p => p.number === number);
      if (pr) {
        pr.state = 'CLOSED';
        pr.updated = new Date();
        console.log(`[MOCK] Closed PR #${number}`);
      }
      return;
    }

    try {
      execSync(`gh pr close ${number} -R ${repo}`, { stdio: 'pipe' });
    } catch (error: any) {
      throw new Error(`Failed to close PR: ${error.message}`);
    }
  }

  /**
   * Get all mock PRs (for testing)
   */
  getMockPRs(repo: string): PullRequest[] {
    return this.mockPRs.get(repo) || [];
  }

  /**
   * Clear all mock PRs (for testing)
   */
  clearMockPRs(): void {
    this.mockPRs.clear();
    this.nextMockNumber = 10000;
  }
}
