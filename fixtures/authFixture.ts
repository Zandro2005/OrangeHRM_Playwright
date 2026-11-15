import path from 'path';
import { test as baseTest, expect } from './baseFixture';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import {
  AdminCredentials,
  EssUserConfig,
  InvalidLoginRow,
  SeededEssAccount,
  ensureAuthStorageState,
  gotoWithRetry,
  loadUsersData,
  seedEssAccount,
} from '../utils/apiHelpers';

export interface AuthFixtures {
  adminCredentials: AdminCredentials;
  essUserConfig: EssUserConfig;
  invalidLoginCases: InvalidLoginRow[];
  storageStatePath: string;
  essAccount: SeededEssAccount;
  authenticatedDashboardPage: DashboardPage;
}

export const test = baseTest.extend<AuthFixtures>({
  adminCredentials: async ({}, use) => {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;

    if (!username || !password) {
      throw new Error(
        'Missing ADMIN_USERNAME or ADMIN_PASSWORD. Set them in .env locally or GitHub Secrets in CI.'
      );
    }

    await use({ username, password });
  },

  essUserConfig: async ({}, use) => {
    await use(loadUsersData().essUser);
  },

  invalidLoginCases: async ({}, use) => {
    await use(loadUsersData().invalidLogins);
  },

  storageStatePath: async ({ browser, baseURL, adminCredentials }, use) => {
    const targetPath = path.resolve(__dirname, '../auth/auth.json');
    await ensureAuthStorageState(browser, adminCredentials, targetPath, baseURL);
    await use(targetPath);
  },

  essAccount: async ({ browser, baseURL, adminCredentials, essUserConfig }, use) => {
    // Seed a fresh ESS account per test and guarantee API cleanup in teardown
    const account = await seedEssAccount(browser, adminCredentials, essUserConfig, baseURL);
    try {
      await use(account);
    } finally {
      await account.cleanup();
    }
  },

  authenticatedDashboardPage: async (
    { browser, baseURL, storageStatePath, adminCredentials, telemetry },
    use
  ) => {
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: storageStatePath,
    });

    try {
      const page = await context.newPage();
      telemetry.attach(page);

      const dashboardPage = new DashboardPage(page);
      const loginPage = new LoginPage(page);

      // Re-authenticate automatically if the shared demo server invalidates auth/auth.json mid-run
      dashboardPage.goto = async (maxAttempts = 4): Promise<void> => {
        await gotoWithRetry(
          page,
          '/web/index.php/dashboard/index',
          dashboardPage.pageHeading.or(loginPage.usernameInput),
          { maxAttempts }
        );

        if (page.url().includes('/auth/login')) {
          await loginPage.login(adminCredentials.username, adminCredentials.password);
          await dashboardPage.expectLoaded();
          await context.storageState({ path: storageStatePath }).catch(() => undefined);
        }
      };

      await use(dashboardPage);
    } finally {
      await context.close();
    }
  },
});

export { expect };
