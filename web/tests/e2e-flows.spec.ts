import { test, expect } from '@playwright/test';
import { spawn, ChildProcess, execSync } from 'child_process';
import { join } from 'path';

/**
 * End-to-End Flow Tests for MainframeHub
 *
 * Tests complete workflows with Claude title generation and mocked GitHub writes
 */

let serverProcess: ChildProcess;
let githubToken: string;

test.beforeAll(async () => {
  // Get GitHub token from local environment
  try {
    githubToken = execSync('gh auth token', { encoding: 'utf-8' }).trim();
    console.log('✓ Got GitHub token from gh auth');
  } catch (error) {
    throw new Error('Failed to get GitHub token. Please run: gh auth login');
  }

  // Start server with mock mode
  const serverPath = join(__dirname, '../../dist/web/server/index.js');
  serverProcess = spawn('node', [serverPath, '--mock'], {
    cwd: join(__dirname, '../..'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Wait for server to start
  await new Promise((resolve) => {
    serverProcess.stdout?.on('data', (data) => {
      if (data.toString().includes('MainframeHub web server running')) {
        resolve(true);
      }
    });
  });

  // Give it a moment to fully initialize
  await new Promise(resolve => setTimeout(resolve, 1000));
});

test.afterAll(async () => {
  // Kill server
  if (serverProcess) {
    serverProcess.kill();
  }
});

test.describe('End-to-End PR Creation Flows', () => {
  // Setup auth token before each test
  test.beforeEach(async ({ page }) => {
    // Inject GitHub token into localStorage before page loads
    await page.addInitScript((token) => {
      localStorage.setItem('githubToken', token);
    }, githubToken);
  });

  test('should create new PR with Claude-generated title', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Navigate to NEW PR tab
    await page.click('[data-tab="new-pr"]');
    await expect(page.locator('#tab-new-pr')).toBeVisible();

    // Fill in the prompt
    const prompt = 'Add comprehensive logging to the authentication module';
    await page.fill('#pr-prompt', prompt);

    // Set base branch to next
    await page.fill('#base-branch', 'next');

    // Submit the form
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/new') && response.status() === 200,
      { timeout: 60000 }
    );

    await page.click('button[type="submit"]:has-text("CREATE PR + SESSION")');

    // Wait for the API call to complete
    const response = await responsePromise;
    const result = await response.json();

    console.log('PR created:', result);

    // Verify the response structure
    expect(result.success).toBe(true);
    expect(result.pr).toBeDefined();
    expect(result.pr.number).toBeDefined();
    expect(result.pr.title).toBeDefined();
    expect(result.pr.branch).toBeDefined();
    expect(result.session).toBeDefined();
    expect(result.session.id).toMatch(/^mfh-\d+$/);

    // Verify title was generated (either by Claude or fallback)
    // Title should be "feat: description" or "fix: description", NOT "ad/feat: ..."
    expect(result.pr.title).toMatch(/^(feat|fix|refactor):/);
    expect(result.pr.title).not.toMatch(/^ad\//);
    expect(result.pr.title.length).toBeGreaterThan(10);

    // Verify branch name format (ad/TYPE/description)
    expect(result.pr.branch).toMatch(/^ad\/(feat|fix|refactor)\//);

    // Verify toast notification
    await expect(page.locator('.toast.success')).toBeVisible();
    await expect(page.locator('.toast.success')).toContainText(`Created PR #${result.pr.number}`);

    console.log(`✓ Created PR #${result.pr.number}: ${result.pr.title}`);
    console.log(`✓ Session: ${result.session.id}`);
    console.log(`✓ Branch: ${result.pr.branch}`);
  });

  test('should create PR from existing branch', async ({ page, request }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Navigate to BRANCHES tab
    await page.click('[data-tab="branches"]');
    await expect(page.locator('#tab-branches')).toBeVisible();

    // Wait for branches to load
    await page.waitForTimeout(2000);

    // Check if there are any branches
    const branchCount = await page.locator('.branch-item').count();
    console.log(`Found ${branchCount} branches`);

    if (branchCount === 0) {
      console.log('No branches available, skipping test');
      test.skip();
      return;
    }

    // Get the first branch name
    const branchName = await page.locator('.branch-name').first().textContent();
    console.log(`Testing with branch: ${branchName}`);

    // Mock the browser prompt
    await page.evaluate(() => {
      window.prompt = () => 'Test PR from existing branch';
    });

    // Click CREATE PR button
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/from-branch') && response.status() === 200,
      { timeout: 60000 }
    );

    await page.locator('.branch-item').first().locator('button:has-text("CREATE PR")').click();

    // Wait for the API call to complete
    const response = await responsePromise;
    const result = await response.json();

    console.log('PR created from branch:', result);

    // Verify the response
    expect(result.success).toBe(true);
    expect(result.pr).toBeDefined();
    expect(result.pr.number).toBeDefined();
    expect(result.pr.branch).toBe(branchName);
    expect(result.session).toBeDefined();

    console.log(`✓ Created PR #${result.pr.number} from branch ${branchName}`);
  });

  test('should setup existing PR and create session', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Open the setup modal
    await page.click('button:has-text("SETUP PR")');
    await expect(page.locator('#pr-setup-modal')).toHaveClass(/active/);

    // Enter a PR number (using a mock number)
    const prNumber = 12345;
    await page.fill('#setup-pr-number', prNumber.toString());

    // Submit the form
    const responsePromise = page.waitForResponse(
      response => response.url().includes(`/api/setup/${prNumber}`) && response.status() === 200,
      { timeout: 60000 }
    );

    await page.click('#pr-setup-modal button[type="submit"]');

    // Wait for the API call to complete
    const response = await responsePromise;
    const result = await response.json();

    console.log('PR setup result:', result);

    // Verify the response
    expect(result.success).toBe(true);
    expect(result.pr).toBeDefined();
    expect(result.pr.number).toBe(prNumber);
    expect(result.session).toBeDefined();
    expect(result.session.id).toMatch(/^mfh-\d+$/);

    console.log(`✓ Setup PR #${result.pr.number}`);
    console.log(`✓ Session: ${result.session.id}`);
  });

  test('should display sessions with human-readable names', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Wait for sessions to load
    await page.waitForSelector('.sessions-list', { state: 'visible', timeout: 10000 });

    // Check if sessions are displayed
    const sessionCount = await page.locator('.session-item').count();
    console.log(`Found ${sessionCount} sessions`);

    if (sessionCount > 0) {
      // Verify session structure
      const firstSession = page.locator('.session-item').first();

      // Should have session name (PR title or session ID)
      await expect(firstSession.locator('.session-name')).toBeVisible();
      const sessionName = await firstSession.locator('.session-name').textContent();
      expect(sessionName).toBeTruthy();

      // Should have subtitle with PR info
      await expect(firstSession.locator('.session-subtitle')).toBeVisible();

      // Should have small session ID
      await expect(firstSession.locator('.session-id-small')).toBeVisible();
      const sessionId = await firstSession.locator('.session-id-small').textContent();
      expect(sessionId).toMatch(/^mfh-\d+$/);

      // Should have status indicator
      await expect(firstSession.locator('.session-status-indicator')).toBeVisible();

      console.log(`✓ Session displayed: ${sessionName}`);
      console.log(`✓ Session ID: ${sessionId}`);
    }
  });

  test('should navigate to terminal when clicking session', async ({ page, context }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Wait for sessions to load
    await page.waitForSelector('.sessions-list', { state: 'visible', timeout: 10000 });

    const sessionCount = await page.locator('.session-item').count();

    if (sessionCount > 0) {
      // Get the session ID before clicking
      const sessionId = await page.locator('.session-id-small').first().textContent();
      console.log(`Testing terminal for session: ${sessionId}`);

      // Set up listener for new page
      const pagePromise = context.waitForEvent('page');

      // Click on the session
      await page.locator('.session-item').first().click();

      // Wait for new tab to open
      const newPage = await pagePromise;
      await newPage.waitForLoadState('networkidle');

      // Verify we're on the terminal page
      expect(newPage.url()).toContain('/terminal.html');
      expect(newPage.url()).toContain(`session=${sessionId}`);

      // Verify terminal elements are present
      await expect(newPage.locator('#terminal')).toBeVisible();
      await expect(newPage.locator('#session-name')).toContainText(sessionId!);
      await expect(newPage.locator('#status')).toBeVisible();

      console.log(`✓ Terminal opened for session ${sessionId}`);
      console.log(`✓ URL: ${newPage.url()}`);

      await newPage.close();
    } else {
      console.log('No sessions available for terminal test');
    }
  });

  test('should show MY PRs with proper grouping', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Navigate to MY PRs tab
    await page.click('[data-tab="my-prs"]');
    await expect(page.locator('#tab-my-prs')).toBeVisible();

    // Wait for PRs to load
    await page.waitForTimeout(2000);

    // Check if PRs are displayed
    const prCount = await page.locator('.pr-item').count();
    console.log(`Found ${prCount} PRs`);

    if (prCount > 0) {
      // Verify PR structure
      const firstPR = page.locator('.pr-item').first();

      // Should have title
      await expect(firstPR.locator('.pr-title')).toBeVisible();
      const title = await firstPR.locator('.pr-title').textContent();

      // Should have metadata
      await expect(firstPR.locator('.pr-meta')).toBeVisible();

      // Should have status badge
      await expect(firstPR.locator('.pr-status-badge')).toBeVisible();
      const status = await firstPR.locator('.pr-status-badge').textContent();

      // Should have actions
      await expect(firstPR.locator('.pr-actions')).toBeVisible();

      console.log(`✓ PR displayed: ${title}`);
      console.log(`✓ Status: ${status}`);

      // Check for group titles
      const groupCount = await page.locator('.pr-group-title').count();
      if (groupCount > 0) {
        const groups = await page.locator('.pr-group-title').allTextContents();
        console.log(`✓ PR groups: ${groups.join(', ')}`);
      }
    }
  });

  test('should validate Claude title generation format', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Navigate to NEW PR tab
    await page.click('[data-tab="new-pr"]');

    // Fill in a specific prompt that should generate a good title
    const prompt = 'Refactor database connection pool to use async/await pattern';
    await page.fill('#pr-prompt', prompt);
    await page.fill('#base-branch', 'next');

    // Submit
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/new'),
      { timeout: 60000 }
    );

    await page.click('button[type="submit"]:has-text("CREATE PR + SESSION")');

    const response = await responsePromise;
    const result = await response.json();

    // Validate title format
    const title = result.pr.title;
    console.log(`Generated title: "${title}"`);

    // Should follow pattern: (feat|fix|refactor): description (NOT ad/feat: ...)
    const titlePattern = /^(feat|fix|refactor):/;
    expect(title).toMatch(titlePattern);
    expect(title).not.toMatch(/^ad\//); // Should NOT have ad/ prefix

    // Should be reasonable length (not too short, not too long)
    expect(title.length).toBeGreaterThan(15);
    expect(title.length).toBeLessThanOrEqual(72);

    // Should not just be the prompt repeated
    expect(title.toLowerCase()).not.toBe(`feat: ${prompt.toLowerCase()}`);
    expect(title.toLowerCase()).not.toBe(`refactor: ${prompt.toLowerCase()}`);

    // Branch name should have ad/ prefix (ad/TYPE/description)
    const branch = result.pr.branch;
    expect(branch).toMatch(/^ad\/(feat|fix|refactor)\//);

    console.log(`✓ Title format valid: ${title}`);
    console.log(`✓ Branch format valid: ${branch}`);
  });

  test('should handle errors gracefully', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Try to submit NEW PR form with empty prompt
    await page.click('[data-tab="new-pr"]');
    await page.fill('#pr-prompt', '');
    await page.click('button[type="submit"]:has-text("CREATE PR + SESSION")');

    // Should show error toast
    await expect(page.locator('.toast.error')).toBeVisible();
    await expect(page.locator('.toast.error')).toContainText('enter a prompt');

    console.log('✓ Empty prompt validation works');

    // Try to setup non-existent PR
    await page.click('button:has-text("SETUP PR")');
    await page.fill('#setup-pr-number', '999999');

    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/setup/999999'),
      { timeout: 30000 }
    );

    await page.click('#pr-setup-modal button[type="submit"]');

    const response = await responsePromise;

    if (!response.ok()) {
      console.log('✓ Non-existent PR handled correctly');
    }
  });

  test('should show mobile paste bar on small screens', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Navigate to terminal page directly (mocked)
    await page.goto('http://localhost:3000/terminal.html?session=mfh-test');

    // Mobile paste bar should be visible
    await expect(page.locator('.mobile-paste-bar')).toBeVisible();
    await expect(page.locator('.mobile-paste-btn')).toBeVisible();

    console.log('✓ Mobile paste bar visible on small screen');

    // Test desktop view
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.reload();

    // Mobile paste bar should be hidden on desktop
    await expect(page.locator('.mobile-paste-bar')).not.toBeVisible();

    console.log('✓ Mobile paste bar hidden on desktop');
  });
});

test.describe('API Endpoint Tests', () => {
  test('should return proper mock data from /api/discover', async ({ request }) => {
    const response = await request.get('http://localhost:3000/api/discover', {
      headers: {
        'Authorization': `Bearer ${githubToken}`
      }
    });
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.sessions).toBeDefined();
    expect(Array.isArray(data.sessions)).toBe(true);

    console.log(`✓ Discovered ${data.sessions.length} sessions`);
  });

  test('should create PR with /api/new', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/new', {
      headers: {
        'Authorization': `Bearer ${githubToken}`
      },
      data: {
        prompt: 'Test prompt for API endpoint',
        baseBranch: 'next'
      }
    });

    expect(response.ok()).toBe(true);
    const result = await response.json();

    expect(result.success).toBe(true);
    expect(result.pr).toBeDefined();
    expect(result.session).toBeDefined();

    console.log(`✓ API created PR #${result.pr.number}`);
  });

  test('should return branches from /api/branches', async ({ request }) => {
    const response = await request.get('http://localhost:3000/api/branches', {
      headers: {
        'Authorization': `Bearer ${githubToken}`
      }
    });
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.branches).toBeDefined();
    expect(Array.isArray(data.branches)).toBe(true);

    console.log(`✓ API returned ${data.branches.length} branches`);
  });

  test('should return PRs from /api/prs', async ({ request }) => {
    const response = await request.get('http://localhost:3000/api/prs', {
      headers: {
        'Authorization': `Bearer ${githubToken}`
      }
    });
    expect(response.ok()).toBe(true);

    const data = await response.json();
    expect(data.prs).toBeDefined();
    expect(Array.isArray(data.prs)).toBe(true);

    console.log(`✓ API returned ${data.prs.length} PRs`);
  });
});
