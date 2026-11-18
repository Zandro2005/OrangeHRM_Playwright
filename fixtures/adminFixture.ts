import crypto from 'crypto';
import { BrowserContext, Locator, Page } from '@playwright/test';
import { test as authTest, expect } from './authFixture';
import { EmployeePage } from '../pages/EmployeePage';
import { LoginPage } from '../pages/LoginPage';
import { UsersPage } from '../pages/UsersPage';
import {
  SeededEmployee,
  SeededSystemUser,
  deleteEmployeeByEmpNumber,
  deleteSystemUserByUsernameIfPresent,
  gotoWithRetry,
  seedEmployee,
  seedSystemUser,
} from '../utils/apiHelpers';

export interface AdminFixtures {
  employeePage: EmployeePage;
  usersPage: UsersPage;
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
  registerDisposableEmployee: (empNumber: number) => void;
  registerDisposableUsername: (username: string) => void;
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
      await gotoWithRetry(page, url, readyLocator, { maxAttempts: 3 });
      await context.storageState({ path: storageStatePath }).catch(() => undefined);
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
});

export { expect };
