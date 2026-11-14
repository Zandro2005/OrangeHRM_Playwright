import { expect, test } from '../fixtures/authFixture';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { runA11yAudit } from '../utils/accessibility';
import { swapCase, withRetry } from '../utils/apiHelpers';

test.describe('Module 1: Authentication', () => {
  test('TC-AUTH-001: Valid Admin login redirects to Dashboard @smoke @functional @e2e', async ({
    loginPage,
    dashboardPage,
    adminCredentials,
  }) => {
    await loginPage.goto();
    await loginPage.login(adminCredentials.username, adminCredentials.password);
    await dashboardPage.expectLoaded();
  });

  test('TC-AUTH-002: Valid ESS login & keyboard Enter submission @functional @e2e @rbac', async ({
    loginPage,
    dashboardPage,
    essAccount,
    essUserConfig,
  }) => {
    await loginPage.goto();
    await loginPage.loginWithKeyboard(essAccount.username, essAccount.password);
    await dashboardPage.expectEssViewLoaded(
      essUserConfig.expectedVisibleMenus,
      essUserConfig.expectedHiddenMenus
    );
  });

  test('TC-AUTH-003: Invalid login with wrong password shows alert @negative @regression', async ({
    loginPage,
    adminCredentials,
  }) => {
    await loginPage.goto();
    await loginPage.login(adminCredentials.username, `${adminCredentials.password}_invalid`);
    await loginPage.expectInvalidCredentialsError();
  });

  test('TC-AUTH-004: Parameterized invalid login dataset validation @negative @regression', async ({
    loginPage,
    invalidLoginCases,
    adminCredentials,
  }) => {
    for (const row of invalidLoginCases) {
      await test.step(`Submit invalid credentials: ${row.label}`, async () => {
        const username = row.useWrongPasswordCase ? adminCredentials.username : row.username;
        const password = row.useWrongPasswordCase
          ? swapCase(adminCredentials.password)
          : (row.password ?? '');

        await loginPage.goto();
        await loginPage.login(username, password);
        await loginPage.expectInvalidCredentialsError();
      });
    }
  });

  test('TC-AUTH-005: Empty username shows Required validation @negative @regression', async ({
    loginPage,
    adminCredentials,
  }) => {
    await loginPage.goto();
    await loginPage.login('', `${adminCredentials.password}_sample`);
    await loginPage.expectRequiredValidation(['Username']);
  });

  test('TC-AUTH-006: Empty password & both empty fields show Required errors @negative @regression', async ({
    loginPage,
    adminCredentials,
  }) => {
    await test.step('Valid username with blank password', async () => {
      await loginPage.goto();
      await loginPage.login(adminCredentials.username, '');
      await loginPage.expectRequiredValidation(['Password']);
    });

    await test.step('Both username and password left blank', async () => {
      await loginPage.goto();
      await loginPage.login('', '');
      await loginPage.expectRequiredValidation(['Username', 'Password']);
    });
  });

  test('TC-AUTH-007: Password masking & Forgot Password flow @functional @regression', async ({
    loginPage,
    adminCredentials,
  }) => {
    await loginPage.goto();
    await loginPage.expectPasswordMasked();
    await loginPage.completeForgotPasswordFlow(adminCredentials.username);
  });

  test('TC-AUTH-008: Logout clears session & blocks protected routes @functional @e2e @smoke', async ({
    loginPage,
    dashboardPage,
    adminCredentials,
  }) => {
    await loginPage.goto();
    await loginPage.login(adminCredentials.username, adminCredentials.password);
    await dashboardPage.expectLoaded();

    await dashboardPage.logout();
    await dashboardPage.expectProtectedRouteBlocked('/web/index.php/dashboard/index');
  });

  test('TC-AUTH-009: Session validation via HTTP 401 interception & storageState @integration @smoke', async ({
    browser,
    baseURL,
    storageStatePath,
  }) => {
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: storageStatePath,
    });

    try {
      const page = await context.newPage();
      const restoredDashboard = new DashboardPage(page);
      const restoredLogin = new LoginPage(page);

      // Step 1: Verify saved storageState opens Dashboard directly without logging in
      await restoredDashboard.goto();
      await restoredDashboard.expectLoaded();

      // Step 2: Intercept API calls with HTTP 401 and clear client cookies to simulate expiry
      await page.route('**/api/v2/**', async (route) => {
        await context.clearCookies();
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { status: 401, message: 'Session expired' } }),
        });
      });

      await withRetry(
        () => page.reload({ waitUntil: 'domcontentloaded', timeout: 22_000 }),
        {
          maxAttempts: 4,
          baseDelayMs: 1_500,
          shouldRetry: () => !page.isClosed() && !page.url().includes('/auth/login'),
        }
      );
      await expect(page).toHaveURL(/\/auth\/login/);
      await expect(restoredLogin.usernameInput).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('TC-AUTH-010: Login page visual regression & accessibility audit @visual @a11y', async ({
    loginPage,
    adminCredentials,
  }, testInfo) => {
    await loginPage.goto();
    await loginPage.waitForVisualStability();
    await expect(loginPage.page).toHaveScreenshot('login-default.png');

    // Step 2: Audit WCAG 2.1 AA compliance (documenting known upstream demo template defects)
    await runA11yAudit(loginPage.page, testInfo, {
      knownBaselineRuleIds: ['html-has-lang', 'color-contrast', 'link-name'],
    });
    await loginPage.expectKeyboardTabOrder();

    // Step 3: Trigger invalid credentials error banner and capture visual baseline
    await loginPage.login(adminCredentials.username, `${adminCredentials.password}_invalid`);
    await loginPage.expectInvalidCredentialsError();
    await loginPage.waitForVisualStability();
    await expect(loginPage.page).toHaveScreenshot('login-error-banner.png');
  });
});
