import { test, expect } from '@playwright/test';
import { createWebServer } from '../server/index.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

let server: any;
let testClonesDir: string;
let githubToken: string;

test.beforeAll(async () => {
  // Get GitHub token from local environment
  try {
    githubToken = execSync('gh auth token', { encoding: 'utf-8' }).trim();
    console.log('✓ Got GitHub token from gh auth');
  } catch (error) {
    throw new Error('Failed to get GitHub token. Please run: gh auth login');
  }

  // Setup test environment
  testClonesDir = join(tmpdir(), 'mfh-web-basic-test-clones');
  if (existsSync(testClonesDir)) {
    rmSync(testClonesDir, { recursive: true, force: true });
  }
  mkdirSync(testClonesDir, { recursive: true });

  // Create test config
  const testConfig = {
    repo: 'https://github.com/test/repo',
    repoName: 'test/repo',
    clonesDir: testClonesDir,
    baseBranch: 'main',
    sessionPrefix: 'mfh-basic-test-',
    guidelines: {
      branchFormat: 'test/TYPE/description',
      commitFormat: 'test: description'
    }
  };

  // Write test config
  const configPath = join(tmpdir(), 'mfh-basic-test-config.json');
  writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

  // Start server with mock writes
  server = createWebServer({
    port: 3002,
    mockWrites: true,
    configPath
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));
});

test.afterAll(async () => {
  // Cleanup clones directory
  if (existsSync(testClonesDir)) {
    rmSync(testClonesDir, { recursive: true, force: true });
  }

  // Stop server
  if (server?.server) {
    await new Promise((resolve) => {
      server.server.close(resolve);
    });
  }
});

test.describe('MainframeHub Web UI - Basic Tests', () => {
  // Setup auth token before each test
  test.beforeEach(async ({ page }) => {
    // Inject GitHub token into localStorage before page loads
    await page.addInitScript((token) => {
      localStorage.setItem('githubToken', token);
    }, githubToken);
  });

  test('should load the homepage', async ({ page }) => {
    await page.goto('http://localhost:3002');

    // Check header
    await expect(page.locator('.terminal-title')).toContainText('MAINFRAMEHUB');

    // Check tabs are visible
    await expect(page.locator('.tabs')).toBeVisible();
    await expect(page.locator('[data-tab="sessions"]')).toBeVisible();
    await expect(page.locator('[data-tab="new-pr"]')).toBeVisible();
  });

  test('should show sessions view', async ({ page }) => {
    await page.goto('http://localhost:3002');

    // Wait for loading to complete
    await page.waitForTimeout(500);

    // Sessions view should be visible
    await expect(page.locator('#tab-sessions')).toBeVisible();
    await expect(page.locator('.sessions-list')).toBeVisible();
  });

  test('should open new PR tab', async ({ page }) => {
    await page.goto('http://localhost:3002');

    // Click new PR tab
    await page.click('[data-tab="new-pr"]');

    // Tab content should be visible
    await expect(page.locator('#tab-new-pr')).toBeVisible();
    await expect(page.locator('#pr-prompt')).toBeVisible();
  });

  test('should open setup PR modal', async ({ page }) => {
    await page.goto('http://localhost:3002');

    // Click setup button
    await page.click('button:has-text("SETUP PR")');

    // Modal should be visible
    await expect(page.locator('#pr-setup-modal')).toHaveClass(/active/);
    await expect(page.locator('#setup-pr-number')).toBeVisible();
  });

  test('should validate new PR form', async ({ page }) => {
    await page.goto('http://localhost:3002');

    // Open NEW PR tab
    await page.click('[data-tab="new-pr"]');

    // Try to submit without prompt
    const submitButton = page.locator('button[type="submit"]:has-text("CREATE PR")');
    await submitButton.click();

    // HTML5 validation should prevent submission
    const promptInput = page.locator('#pr-prompt');
    const validationMessage = await promptInput.evaluate((el: any) => el.validationMessage);
    expect(validationMessage).toBeTruthy();
  });

  test('should refresh sessions list', async ({ page }) => {
    await page.goto('http://localhost:3002');

    // Click refresh
    await page.click('button:has-text("REFRESH")');

    // Loading indicator should appear briefly
    await page.waitForTimeout(200);

    // Sessions should be loaded
    await expect(page.locator('.sessions-list')).toBeVisible();
  });

  test('should show health status', async ({ page }) => {
    const response = await page.request.get('http://localhost:3002/health');
    const data = await response.json();

    expect(response.ok()).toBe(true);
    expect(data.status).toBe('ok');
    expect(data.mockWrites).toBe(true);
  });

  test('should handle window resize', async ({ page }) => {
    await page.goto('http://localhost:3002');

    // Resize to mobile
    await page.setViewportSize({ width: 375, height: 667 });

    // Check that tabs are still visible
    await expect(page.locator('.tabs')).toBeVisible();

    // Resize back to desktop
    await page.setViewportSize({ width: 1280, height: 720 });

    await expect(page.locator('#tab-sessions')).toBeVisible();
  });

  test('should show modal structure', async ({ page }) => {
    await page.goto('http://localhost:3002');

    // We can check that modals exist
    const prSetupModal = page.locator('#pr-setup-modal');
    expect(await prSetupModal.count()).toBe(1);

    const tokenModal = page.locator('#token-modal');
    expect(await tokenModal.count()).toBe(1);
  });
});
