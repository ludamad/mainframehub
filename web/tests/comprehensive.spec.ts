import { test, expect } from '@playwright/test';

/**
 * Comprehensive test for mainframehub
 * Verifies that branches, sessions, and PRs are displayed correctly for ludamad
 */

test.describe('Mainframehub - Comprehensive Test', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
  });

  test('should load and display sessions for ludamad', async ({ page }) => {
    // Sessions tab should be active by default
    await expect(page.locator('[data-tab="sessions"].active')).toBeVisible();

    // Wait for sessions to load
    await page.waitForSelector('#sessions-loading', { state: 'hidden', timeout: 10000 });

    // Check if we have sessions or empty state
    const hasSessionsElement = page.locator('#sessions-list');
    const emptyElement = page.locator('#sessions-empty');

    const hasSessionsVisible = await hasSessionsElement.isVisible().catch(() => false);
    const emptyVisible = await emptyElement.isVisible().catch(() => false);

    // One of them should be visible
    expect(hasSessionsVisible || emptyVisible).toBe(true);

    if (hasSessionsVisible) {
      // If sessions exist, verify they have required elements
      const sessionCount = await page.locator('.session-item').count();
      console.log(`Found ${sessionCount} sessions`);

      if (sessionCount > 0) {
        const firstSession = page.locator('.session-item').first();
        await expect(firstSession.locator('.session-id')).toBeVisible();
        await expect(firstSession.locator('.session-status-indicator')).toBeVisible();
      }
    } else {
      console.log('No sessions found - showing empty state');
    }
  });

  test('should load and display PRs for ludamad', async ({ page }) => {
    // Click on MY PRs tab
    await page.click('[data-tab="my-prs"]');
    await expect(page.locator('[data-tab="my-prs"].active')).toBeVisible();

    // Wait for PRs to load
    await page.waitForSelector('#prs-loading', { state: 'hidden', timeout: 10000 });

    // Check if we have PRs or empty state
    const hasPRsElement = page.locator('#prs-list');
    const emptyElement = page.locator('#prs-empty');

    const hasPRsVisible = await hasPRsElement.isVisible().catch(() => false);
    const emptyVisible = await emptyElement.isVisible().catch(() => false);

    // One of them should be visible
    expect(hasPRsVisible || emptyVisible).toBe(true);

    if (hasPRsVisible) {
      // If PRs exist, verify they have required elements
      const prCount = await page.locator('.pr-item').count();
      console.log(`Found ${prCount} PRs for ludamad`);

      expect(prCount).toBeGreaterThan(0); // ludamad should have PRs

      // Verify first PR has required elements
      const firstPR = page.locator('.pr-item').first();
      await expect(firstPR.locator('.pr-title')).toBeVisible();
      await expect(firstPR.locator('.pr-meta')).toBeVisible();
      await expect(firstPR.locator('.pr-status-badge')).toBeVisible();
      await expect(firstPR.locator('.pr-actions')).toBeVisible();

      // Verify PR groups exist
      const groupCount = await page.locator('.pr-group').count();
      console.log(`PRs grouped into ${groupCount} groups`);
      expect(groupCount).toBeGreaterThan(0);
    }
  });

  test('should load and display branches for ludamad', async ({ page }) => {
    // Click on BRANCHES tab
    await page.click('[data-tab="branches"]');
    await expect(page.locator('[data-tab="branches"].active')).toBeVisible();

    // Wait for branches to load
    await page.waitForSelector('#branches-loading', { state: 'hidden', timeout: 10000 });

    // Check if we have branches or empty state
    const hasBranchesElement = page.locator('#branches-list');
    const emptyElement = page.locator('#branches-empty');

    const hasBranchesVisible = await hasBranchesElement.isVisible().catch(() => false);
    const emptyVisible = await emptyElement.isVisible().catch(() => false);

    // One of them should be visible
    expect(hasBranchesVisible || emptyVisible).toBe(true);

    if (hasBranchesVisible) {
      // If branches exist, verify they have required elements
      const branchCount = await page.locator('.branch-item').count();
      console.log(`Found ${branchCount} branches`);

      if (branchCount > 0) {
        const firstBranch = page.locator('.branch-item').first();
        await expect(firstBranch.locator('.branch-name')).toBeVisible();
        await expect(firstBranch.locator('.branch-actions')).toBeVisible();
      }
    }
  });

  test('should use high contrast black and white theme', async ({ page }) => {
    // Check that the body has black background
    const bodyBg = await page.evaluate(() => {
      const body = document.body;
      return window.getComputedStyle(body).backgroundColor;
    });

    // Should be pure black or very close to it
    expect(bodyBg).toMatch(/rgb\(0,\s*0,\s*0\)/);

    // Check that text is white
    const textColor = await page.evaluate(() => {
      const body = document.body;
      return window.getComputedStyle(body).color;
    });

    // Should be white or very close to it
    expect(textColor).toMatch(/rgb\(255,\s*255,\s*255\)/);
  });

  test('should have all expected tabs', async ({ page }) => {
    // Verify all tabs exist
    await expect(page.locator('[data-tab="sessions"]')).toBeVisible();
    await expect(page.locator('[data-tab="my-prs"]')).toBeVisible();
    await expect(page.locator('[data-tab="branches"]')).toBeVisible();
    await expect(page.locator('[data-tab="new-pr"]')).toBeVisible();
  });

  test('should navigate between tabs correctly', async ({ page }) => {
    // Start on SESSIONS tab
    await expect(page.locator('#tab-sessions.active')).toBeVisible();

    // Click MY PRs
    await page.click('[data-tab="my-prs"]');
    await expect(page.locator('#tab-my-prs.active')).toBeVisible();
    await expect(page.locator('#tab-sessions.active')).not.toBeVisible();

    // Click BRANCHES
    await page.click('[data-tab="branches"]');
    await expect(page.locator('#tab-branches.active')).toBeVisible();
    await expect(page.locator('#tab-my-prs.active')).not.toBeVisible();

    // Click NEW PR
    await page.click('[data-tab="new-pr"]');
    await expect(page.locator('#tab-new-pr.active')).toBeVisible();
    await expect(page.locator('#tab-branches.active')).not.toBeVisible();

    // Go back to SESSIONS
    await page.click('[data-tab="sessions"]');
    await expect(page.locator('#tab-sessions.active')).toBeVisible();
    await expect(page.locator('#tab-new-pr.active')).not.toBeVisible();
  });

  test('should have functional refresh buttons', async ({ page }) => {
    // Test sessions refresh
    const sessionsRefresh = page.locator('#tab-sessions button:has-text("REFRESH")');
    await expect(sessionsRefresh).toBeVisible();
    await sessionsRefresh.click();
    await page.waitForSelector('#sessions-loading', { state: 'visible', timeout: 1000 }).catch(() => {});

    // Test PRs refresh
    await page.click('[data-tab="my-prs"]');
    const prsRefresh = page.locator('#tab-my-prs button:has-text("REFRESH")');
    await expect(prsRefresh).toBeVisible();
    await prsRefresh.click();
    await page.waitForSelector('#prs-loading', { state: 'visible', timeout: 1000 }).catch(() => {});

    // Test branches refresh
    await page.click('[data-tab="branches"]');
    const branchesRefresh = page.locator('#tab-branches button:has-text("REFRESH")');
    await expect(branchesRefresh).toBeVisible();
    await branchesRefresh.click();
    await page.waitForSelector('#branches-loading', { state: 'visible', timeout: 1000 }).catch(() => {});
  });

  test('should verify API endpoints return data for ludamad', async ({ page, request }) => {
    // Test /api/prs endpoint
    const prsResponse = await request.get('http://localhost:3000/api/prs');
    expect(prsResponse.ok()).toBe(true);
    const prsData = await prsResponse.json();
    console.log(`API returned ${prsData.prs.length} PRs for ludamad`);
    expect(Array.isArray(prsData.prs)).toBe(true);

    // Test /api/branches endpoint
    const branchesResponse = await request.get('http://localhost:3000/api/branches');
    expect(branchesResponse.ok()).toBe(true);
    const branchesData = await branchesResponse.json();
    console.log(`API returned ${branchesData.branches.length} branches`);
    expect(Array.isArray(branchesData.branches)).toBe(true);

    // Test /api/discover endpoint
    const discoverResponse = await request.get('http://localhost:3000/api/discover');
    expect(discoverResponse.ok()).toBe(true);
    const discoverData = await discoverResponse.json();
    console.log(`API returned ${discoverData.sessions.length} sessions`);
    expect(Array.isArray(discoverData.sessions)).toBe(true);

    // Test /api/config endpoint
    const configResponse = await request.get('http://localhost:3000/api/config');
    expect(configResponse.ok()).toBe(true);
    const configData = await configResponse.json();
    expect(configData.repo).toBeTruthy();
    expect(configData.repoName).toBeTruthy();
    console.log(`Config repo: ${configData.repoName}`);
  });
});
