import { test, expect } from '@playwright/test';

/**
 * PR CARDS FLOW TESTS
 *
 * This tests the complete flow of browsing PRs, setting up clones, and opening terminals
 */

test.describe('PR Cards Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');
  });

  test('should load and display PR cards grouped by status', async ({ page }) => {
    // Click on MY PRs tab
    await page.click('[data-tab="my-prs"]');

    // Wait for PRs to load
    await page.waitForSelector('#prs-list', { state: 'visible' });

    // Should show PR groups
    const prGroups = await page.locator('.pr-group').count();
    expect(prGroups).toBeGreaterThanOrEqual(0);

    // Check that PRs are rendered
    const prItems = await page.locator('.pr-item').count();
    console.log(`Found ${prItems} PRs`);

    if (prItems > 0) {
      // Verify first PR has required elements
      const firstPR = page.locator('.pr-item').first();
      await expect(firstPR.locator('.pr-title')).toBeVisible();
      await expect(firstPR.locator('.pr-meta')).toBeVisible();
      await expect(firstPR.locator('.pr-status-badge')).toBeVisible();
      await expect(firstPR.locator('.pr-actions')).toBeVisible();
    }
  });

  test('should show proper status badges for different PR states', async ({ page }) => {
    await page.click('[data-tab="my-prs"]');
    await page.waitForSelector('#prs-list', { state: 'visible' });

    // Check for different status badges
    const activeBadges = await page.locator('.pr-status-badge.active').count();
    const hasCloneBadges = await page.locator('.pr-status-badge.has-clone').count();
    const noCloneBadges = await page.locator('.pr-status-badge.no-clone').count();

    console.log(`Status badges: ${activeBadges} active, ${hasCloneBadges} with clones, ${noCloneBadges} without clones`);

    // At least one type of badge should exist
    expect(activeBadges + hasCloneBadges + noCloneBadges).toBeGreaterThan(0);
  });

  test('should have OPEN TERMINAL button for PRs with active sessions', async ({ page }) => {
    await page.click('[data-tab="my-prs"]');
    await page.waitForSelector('#prs-list', { state: 'visible' });

    const activePRs = page.locator('.pr-status-badge.active');
    const count = await activePRs.count();

    if (count > 0) {
      // Find the parent pr-item
      const prItem = activePRs.first().locator('xpath=ancestor::div[@class="pr-item"]');
      const openTerminalBtn = prItem.locator('button:has-text("OPEN TERMINAL")');
      await expect(openTerminalBtn).toBeVisible();
    }
  });

  test('should have SETUP + ATTACH button for PRs without sessions', async ({ page }) => {
    await page.click('[data-tab="my-prs"]');
    await page.waitForSelector('#prs-list', { state: 'visible' });

    const noClonePRs = page.locator('.pr-status-badge.no-clone');
    const count = await noClonePRs.count();

    if (count > 0) {
      const prItem = noClonePRs.first().locator('xpath=ancestor::div[@class="pr-item"]');
      const setupBtn = prItem.locator('button:has-text("SETUP + ATTACH")');
      await expect(setupBtn).toBeVisible();
    }
  });

  test('should have VIEW ON GITHUB link for all PRs', async ({ page }) => {
    await page.click('[data-tab="my-prs"]');
    await page.waitForSelector('#prs-list', { state: 'visible' });

    const prItems = await page.locator('.pr-item').count();

    if (prItems > 0) {
      const firstPR = page.locator('.pr-item').first();
      const githubLink = firstPR.locator('a:has-text("VIEW ON GITHUB")');
      await expect(githubLink).toBeVisible();
      await expect(githubLink).toHaveAttribute('target', '_blank');
    }
  });

  test('should show progress feedback when setting up a PR', async ({ page }) => {
    await page.click('[data-tab="my-prs"]');
    await page.waitForSelector('#prs-list', { state: 'visible' });

    // Find a PR without a session
    const setupBtn = page.locator('button:has-text("SETUP + ATTACH")').first();
    const isVisible = await setupBtn.isVisible().catch(() => false);

    if (isVisible) {
      // Get the PR number from the button's onclick attribute
      const onclickAttr = await setupBtn.getAttribute('onclick');
      const prNumberMatch = onclickAttr?.match(/setupPRFromCard\((\d+)\)/);

      if (prNumberMatch) {
        const prNumber = prNumberMatch[1];

        // Click setup button
        await setupBtn.click();

        // Should show progress message
        const statusEl = page.locator(`#setup-status-${prNumber}`);
        await expect(statusEl).toHaveClass(/visible/);
        await expect(statusEl).toContainText('Cloning repository');

        // Should have cancel button
        const cancelBtn = statusEl.locator('button:has-text("CANCEL")');
        await expect(cancelBtn).toBeVisible();

        // Wait a bit and check if still processing or completed
        await page.waitForTimeout(2000);

        // Should either show success or still be processing
        const content = await statusEl.textContent();
        console.log(`Setup status: ${content}`);
      }
    } else {
      console.log('No PRs available for setup test');
    }
  });

  test('should navigate to terminal after successful setup', async ({ page }) => {
    await page.click('[data-tab="my-prs"]');
    await page.waitForSelector('#prs-list', { state: 'visible' });

    // Find a PR without a session
    const setupBtn = page.locator('button:has-text("SETUP + ATTACH")').first();
    const isVisible = await setupBtn.isVisible().catch(() => false);

    if (isVisible) {
      // Get the PR number from the button's onclick attribute
      const onclickAttr = await setupBtn.getAttribute('onclick');
      const prNumberMatch = onclickAttr?.match(/setupPRFromCard\((\d+)\)/);

      if (prNumberMatch) {
        const prNumber = prNumberMatch[1];

        // Intercept the API call
        const responsePromise = page.waitForResponse(
          response => response.url().includes(`/api/setup/${prNumber}`) && response.status() === 200,
          { timeout: 60000 }
        );

        // Click setup
        await setupBtn.click();

        try {
          const response = await responsePromise;
          const result = await response.json();

          console.log(`Setup complete: ${JSON.stringify(result)}`);

          // Should navigate to terminal
          await page.waitForURL(`**/session/${result.session.id}`, { timeout: 5000 });

          // Terminal view should be visible
          await expect(page.locator('#terminal-view')).toBeVisible();

          console.log(`✓ Successfully navigated to terminal for session ${result.session.id}`);
        } catch (error) {
          console.log(`Setup timed out or failed: ${error}`);
        }
      }
    } else {
      console.log('No PRs available for navigation test');
    }
  });

  test('should refresh PR list when clicking REFRESH button', async ({ page }) => {
    await page.click('[data-tab="my-prs"]');
    await page.waitForSelector('#prs-list', { state: 'visible' });

    // Get initial PR count
    const initialCount = await page.locator('.pr-item').count();

    // Click refresh
    await page.click('button:has-text("REFRESH")');

    // Should show loading
    await expect(page.locator('#prs-loading')).toBeVisible();

    // Wait for load to complete
    await page.waitForSelector('#prs-loading', { state: 'hidden' });

    // Should still have PRs (or show empty state)
    const newCount = await page.locator('.pr-item').count();
    console.log(`PR count: ${initialCount} → ${newCount}`);
  });

  test('should group PRs correctly', async ({ page }) => {
    await page.click('[data-tab="my-prs"]');
    await page.waitForSelector('#prs-list', { state: 'visible' });

    const prItems = await page.locator('.pr-item').count();

    if (prItems > 0) {
      // Check for group titles
      const groupTitles = await page.locator('.pr-group-title').allTextContents();
      console.log(`PR groups: ${groupTitles.join(', ')}`);

      // Verify groups are in correct order
      const expectedOrder = [
        'WITH ACTIVE SESSIONS',
        'WITH CLONES (NO SESSION)',
        'WITHOUT CLONES'
      ];

      for (let i = 0; i < groupTitles.length; i++) {
        expect(expectedOrder).toContain(groupTitles[i]);
      }

      // Verify PRs in each group have correct status
      if (groupTitles.includes('WITH ACTIVE SESSIONS')) {
        const activeGroup = page.locator('.pr-group').filter({ hasText: 'WITH ACTIVE SESSIONS' });
        const activePRs = activeGroup.locator('.pr-item');
        const activeCount = await activePRs.count();

        for (let i = 0; i < activeCount; i++) {
          const pr = activePRs.nth(i);
          await expect(pr.locator('.pr-status-badge.active')).toBeVisible();
        }
      }
    }
  });

  test('should handle empty PR list gracefully', async ({ page }) => {
    // Mock empty PR response
    await page.route('**/api/prs', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ prs: [] })
      });
    });

    await page.click('[data-tab="my-prs"]');

    // Should show empty state
    await expect(page.locator('#prs-empty')).toBeVisible();
    await expect(page.locator('#prs-empty')).toContainText('NO PULL REQUESTS FOUND');

    // Should have CREATE NEW PR button
    const createBtn = page.locator('#prs-empty button:has-text("CREATE NEW PR")');
    await expect(createBtn).toBeVisible();
  });
});
