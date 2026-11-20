import crypto from 'crypto';
import { BrowserContext, Locator, Page } from '@playwright/test';
import { test as authTest, expect } from './authFixture';
import { EmployeePage } from '../pages/EmployeePage';
import { LoginPage } from '../pages/LoginPage';
import { SettingsPage } from '../pages/SettingsPage';
import {
  SeededEmployee,
  deleteEmployeeByEmpNumber,
  gotoWithRetry,
  saveStorageStateAtomically,
  seedEmployee,
} from '../utils/apiHelpers';

export interface AdminFixtures {
  employeePage: EmployeePage;
  settingsPage: SettingsPage;
  seededEmployee: SeededEmployee;
  seededEmployeeWithJob: SeededEmployee;
  seededEmployeePair: { batchTag: string; first: SeededEmployee; second: SeededEmployee };
  registerDisposableEmployee: (empNumber: number) => void;
}

async function openAdminSessionContext(
  browser: Parameters<typeof seedEmployee>[0],
  baseURL: string | undefined,
  storageStatePath: string,
  adminCredentials: { username: string; password: string },
  telemetry: { attach: (page: Page) => void }
): Promise<{
  context: BrowserContext;
  page: Page;
  navigateWithReauth: (
    url: string,
    readyLocator: Locator,
    afterNavigate?: () => Promise<void>
  ) => Promise<void>;
}> {
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: storageStatePath,
  });
  const page = await context.newPage();
  telemetry.attach(page);

  // Stub OrangeHRM telemetry push so PHP session locks never block Admin/PIM navigations
  await page.route('**/events/push**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  const loginPage = new LoginPage(page);
  const navigateWithReauth = async (
    url: string,
    readyLocator: Locator,
    afterNavigate?: () => Promise<void>
  ): Promise<void> => {
    await gotoWithRetry(page, url, readyLocator.or(loginPage.usernameInput), {
      maxAttempts: 3,
    });
    if (page.url().includes('/auth/login')) {
      await loginPage.login(adminCredentials.username, adminCredentials.password);
      const landedOnTarget =
        page.url().includes(url) &&
        (await readyLocator
          .waitFor({ state: 'visible', timeout: 25_000 })
          .then(() => true)
          .catch(() => false));
      if (!landedOnTarget) {
        await gotoWithRetry(page, url, readyLocator, { maxAttempts: 3 });
      }
      await saveStorageStateAtomically(context, storageStatePath).catch(() => undefined);
    }
    if (afterNavigate) {
      await afterNavigate();
    }
  };

  return { context, page, navigateWithReauth };
}

export const test = authTest.extend<AdminFixtures>({
  employeePage: async (
    { browser, baseURL, storageStatePath, adminCredentials, telemetry },
    use
  ) => {
    const { context, page, navigateWithReauth } = await openAdminSessionContext(
      browser,
      baseURL,
      storageStatePath,
      adminCredentials,
      telemetry
    );

    try {
      const employeePage = new EmployeePage(page);
      const clearSpinners = () => employeePage.waitForSpinnerToClear();

      employeePage.gotoEmployeeList = async () =>
        navigateWithReauth(
          '/web/index.php/pim/viewEmployeeList',
          employeePage.filterSection,
          clearSpinners
        );
      employeePage.gotoAddEmployee = async () =>
        navigateWithReauth(
          '/web/index.php/pim/addEmployee',
          employeePage.firstNameInput,
          clearSpinners
        );
      employeePage.gotoPersonalDetails = async (empNumber: number) =>
        navigateWithReauth(
          `/web/index.php/pim/viewPersonalDetails/empNumber/${empNumber}`,
          employeePage.firstNameInput,
          clearSpinners
        );

      await use(employeePage);
    } finally {
      await context.close().catch(() => undefined);
    }
  },

  settingsPage: async (
    { browser, baseURL, storageStatePath, adminCredentials, telemetry },
    use
  ) => {
    const { context, page, navigateWithReauth } = await openAdminSessionContext(
      browser,
      baseURL,
      storageStatePath,
      adminCredentials,
      telemetry
    );

    try {
      const settingsPage = new SettingsPage(page);
      const clearSpinners = () => settingsPage.waitForSpinnerToClear();

      settingsPage.gotoEmailConfiguration = async () =>
        navigateWithReauth(
          '/web/index.php/admin/listMailConfiguration',
          settingsPage.saveButton,
          clearSpinners
        );
      settingsPage.gotoLocalization = async () =>
        navigateWithReauth('/web/index.php/admin/localization', settingsPage.saveButton, async () => {
          await clearSpinners();
          await expect(
            settingsPage.inputGroupByLabel('Language').locator('.oxd-select-text-input')
          ).not.toHaveText(/^\s*$/, { timeout: 25_000 });
        });
      settingsPage.gotoModules = async () =>
        navigateWithReauth('/web/index.php/admin/viewModules', settingsPage.saveButton, async () => {
          await clearSpinners();
          await expect(page.locator('.orangehrm-module-field-row').first()).toBeVisible({
            timeout: 25_000,
          });
        });
      settingsPage.gotoCorporateBranding = async () =>
        navigateWithReauth('/web/index.php/admin/addTheme', settingsPage.publishButton, clearSpinners);

      await use(settingsPage);
    } finally {
      await context.close().catch(() => undefined);
    }
  },

  seededEmployee: async ({ browser, baseURL, adminCredentials }, use) => {
    const seeded = await seedEmployee(browser, adminCredentials, baseURL);
    try {
      await use(seeded);
    } finally {
      await seeded.cleanup();
    }
  },

  seededEmployeeWithJob: async ({ browser, baseURL, adminCredentials }, use) => {
    const seeded = await seedEmployee(browser, adminCredentials, baseURL, {
      assignJobDetails: true,
    });
    try {
      await use(seeded);
    } finally {
      await seeded.cleanup();
    }
  },

  seededEmployeePair: async ({ browser, baseURL, adminCredentials }, use) => {
    const batchTag = `Bulk${crypto.randomBytes(3).toString('hex')}`;
    const [first, second] = await Promise.all([
      seedEmployee(browser, adminCredentials, baseURL, {
        firstName: `${batchTag}Alpha`,
        lastName: batchTag,
      }),
      seedEmployee(browser, adminCredentials, baseURL, {
        firstName: `${batchTag}Beta`,
        lastName: batchTag,
      }),
    ]);

    try {
      await use({ batchTag, first, second });
    } finally {
      await Promise.all([first.cleanup(), second.cleanup()]);
    }
  },

  registerDisposableEmployee: async ({ browser, baseURL, adminCredentials }, use) => {
    const createdEmpNumbers = new Set<number>();
    await use((empNumber: number) => {
      if (empNumber > 0) {
        createdEmpNumbers.add(empNumber);
      }
    });

    for (const empNumber of createdEmpNumbers) {
      await deleteEmployeeByEmpNumber(browser, adminCredentials, empNumber, baseURL).catch(
        (err) => console.warn(`Cleanup warning: failed to delete UI employee ${empNumber}:`, err)
      );
    }
  },
});

export { expect };
