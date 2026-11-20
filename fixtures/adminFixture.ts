import crypto from 'crypto';
import { BrowserContext, Locator, Page } from '@playwright/test';
import { test as authTest, expect } from './authFixture';
import { EmployeePage } from '../pages/EmployeePage';
import { LoginPage } from '../pages/LoginPage';
import { ReportsPage } from '../pages/ReportsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { UsersPage } from '../pages/UsersPage';
import {
  SeededEmployee,
  SeededReport,
  SeededSystemUser,
  deleteDefinedReportById,
  deleteDefinedReportByNameIfPresent,
  deleteEmployeeByEmpNumber,
  deleteSystemUserByUsernameIfPresent,
  gotoWithRetry,
  saveStorageStateAtomically,
  seedDefinedReport,
  seedEmployee,
  seedSystemUser,
} from '../utils/apiHelpers';

export interface AdminFixtures {
  employeePage: EmployeePage;
  usersPage: UsersPage;
  reportsPage: ReportsPage;
  settingsPage: SettingsPage;
  authenticatedEssPage: Page;
  seededEmployee: SeededEmployee;
  seededEmployeeWithJob: SeededEmployee;
  seededEmployeePair: { batchTag: string; first: SeededEmployee; second: SeededEmployee };
  seededSystemUser: SeededSystemUser;
  seededSystemUserPair: {
    prefix: string;
    employeeFirstName: string;
    employeeFullName: string;
    first: SeededSystemUser;
    second: SeededSystemUser;
  };
  seededReport: SeededReport;
  registerDisposableEmployee: (empNumber: number) => void;
  registerDisposableUsername: (username: string) => void;
  registerDisposableReportId: (reportId: number) => void;
  registerDisposableReportName: (name: string) => void;
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

  usersPage: async ({ browser, baseURL, storageStatePath, adminCredentials, telemetry }, use) => {
    const { context, page, navigateWithReauth } = await openAdminSessionContext(
      browser,
      baseURL,
      storageStatePath,
      adminCredentials,
      telemetry
    );

    try {
      const usersPage = new UsersPage(page);
      const clearSpinners = () => usersPage.waitForSpinnerToClear();

      usersPage.gotoUsersList = async () =>
        navigateWithReauth(
          '/web/index.php/admin/viewSystemUsers',
          usersPage.filterSection,
          clearSpinners
        );
      usersPage.gotoAddUser = async () =>
        navigateWithReauth(
          '/web/index.php/admin/saveSystemUser',
          usersPage.saveButton,
          clearSpinners
        );

      await use(usersPage);
    } finally {
      await context.close().catch(() => undefined);
    }
  },

  reportsPage: async (
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
      const reportsPage = new ReportsPage(page);
      const clearSpinners = () => reportsPage.waitForSpinnerToClear();

      reportsPage.gotoDashboard = async () =>
        navigateWithReauth(
          '/web/index.php/dashboard/index',
          page.getByRole('heading', { name: 'Dashboard' }),
          clearSpinners
        );
      reportsPage.gotoReportsList = async () =>
        navigateWithReauth(
          '/web/index.php/pim/viewDefinedPredefinedReports',
          reportsPage.filterSection,
          clearSpinners
        );
      reportsPage.gotoAddReport = async () =>
        navigateWithReauth(
          '/web/index.php/pim/definePredefinedReport',
          reportsPage.saveButton,
          clearSpinners
        );
      reportsPage.gotoEditReport = async (reportId: number) =>
        navigateWithReauth(
          `/web/index.php/pim/definePredefinedReport/${reportId}`,
          reportsPage.saveButton,
          async () => {
            await clearSpinners();
            await expect(reportsPage.inputGroupByLabel('Report Name').locator('input')).not.toHaveValue(
              '',
              { timeout: 25_000 }
            );
          }
        );
      reportsPage.gotoDisplayReport = async (reportId: number) =>
        navigateWithReauth(
          `/web/index.php/pim/displayPredefinedReport/${reportId}`,
          reportsPage.reportTitleHeading,
          clearSpinners
        );

      await use(reportsPage);
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

  authenticatedEssPage: async ({ browser, baseURL, seededSystemUser, telemetry }, use) => {
    const context = await browser.newContext(baseURL ? { baseURL } : undefined);
    const page = await context.newPage();
    telemetry.attach(page);

    // Stub OrangeHRM telemetry push so PHP session locks never block ESS navigations
    await page.route('**/events/push**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    try {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.login(seededSystemUser.username, seededSystemUser.password);
      await page.waitForURL(/\/dashboard\/index/, {
        waitUntil: 'domcontentloaded',
        timeout: 35_000,
      });
      await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
        timeout: 25_000,
      });

      await use(page);
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

  seededSystemUser: async ({ browser, baseURL, adminCredentials }, use) => {
    const seeded = await seedSystemUser(browser, adminCredentials, baseURL, {
      role: 'ESS',
      status: true,
    });
    try {
      await use(seeded);
    } finally {
      await seeded.cleanup();
    }
  },

  seededSystemUserPair: async ({ browser, baseURL, adminCredentials }, use) => {
    const prefix = `usrblk_${crypto.randomBytes(3).toString('hex')}`;
    const sharedEmployee = await seedEmployee(browser, adminCredentials, baseURL);

    try {
      const [first, second] = await Promise.all([
        seedSystemUser(browser, adminCredentials, baseURL, {
          role: 'ESS',
          status: true,
          usernamePrefix: `${prefix}_a`,
          empNumber: sharedEmployee.empNumber,
          firstName: sharedEmployee.firstName,
          lastName: sharedEmployee.lastName,
          employeeId: sharedEmployee.employeeId,
        }),
        seedSystemUser(browser, adminCredentials, baseURL, {
          role: 'ESS',
          status: true,
          usernamePrefix: `${prefix}_b`,
          empNumber: sharedEmployee.empNumber,
          firstName: sharedEmployee.firstName,
          lastName: sharedEmployee.lastName,
          employeeId: sharedEmployee.employeeId,
        }),
      ]);

      try {
        await use({
          prefix,
          employeeFirstName: sharedEmployee.firstName,
          employeeFullName: `${sharedEmployee.firstName} ${sharedEmployee.lastName}`,
          first,
          second,
        });
      } finally {
        await Promise.all([first.cleanup(), second.cleanup()]);
      }
    } finally {
      await sharedEmployee.cleanup();
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

  registerDisposableUsername: async ({ browser, baseURL, adminCredentials }, use) => {
    const createdUsernames = new Set<string>();
    await use((username: string) => {
      if (username.trim().length > 0) {
        createdUsernames.add(username.trim());
      }
    });

    for (const username of createdUsernames) {
      await deleteSystemUserByUsernameIfPresent(
        browser,
        adminCredentials,
        username,
        baseURL
      ).catch((err) => console.warn(`Cleanup warning: failed to delete UI user ${username}:`, err));
    }
  },

  seededReport: async ({ browser, baseURL, adminCredentials }, use) => {
    const seeded = await seedDefinedReport(browser, adminCredentials, baseURL);
    try {
      await use(seeded);
    } finally {
      await seeded.cleanup();
    }
  },

  registerDisposableReportId: async ({ browser, baseURL, adminCredentials }, use) => {
    const createdReportIds = new Set<number>();
    await use((reportId: number) => {
      if (reportId > 0) {
        createdReportIds.add(reportId);
      }
    });

    for (const reportId of createdReportIds) {
      await deleteDefinedReportById(browser, adminCredentials, reportId, baseURL).catch((err) =>
        console.warn(`Cleanup warning: failed to delete UI report ${reportId}:`, err)
      );
    }
  },

  registerDisposableReportName: async ({ browser, baseURL, adminCredentials }, use) => {
    const createdReportNames = new Set<string>();
    await use((name: string) => {
      if (name.trim().length > 0) {
        createdReportNames.add(name.trim());
      }
    });

    for (const name of createdReportNames) {
      await deleteDefinedReportByNameIfPresent(browser, adminCredentials, name, baseURL).catch(
        (err) => console.warn(`Cleanup warning: failed to delete UI report ${name}:`, err)
      );
    }
  },
});

export { expect };
