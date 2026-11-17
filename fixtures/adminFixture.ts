import crypto from 'crypto';
import { test as authTest, expect } from './authFixture';
import { EmployeePage } from '../pages/EmployeePage';
import { LoginPage } from '../pages/LoginPage';
import {
  SeededEmployee,
  deleteEmployeeByEmpNumber,
  gotoWithRetry,
  seedEmployee,
} from '../utils/apiHelpers';

export interface AdminFixtures {
  employeePage: EmployeePage;
  seededEmployee: SeededEmployee;
  seededEmployeeWithJob: SeededEmployee;
  seededEmployeePair: { batchTag: string; first: SeededEmployee; second: SeededEmployee };
  registerDisposableEmployee: (empNumber: number) => void;
}

export const test = authTest.extend<AdminFixtures>({
  employeePage: async (
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

      // Stub OrangeHRM telemetry push so PHP session locks never block PIM navigations
      await page.route('**/events/push**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });

      const employeePage = new EmployeePage(page);
      const loginPage = new LoginPage(page);

      const navigateWithReauth = async (
        url: string,
        readyLocator = employeePage.filterSection
      ): Promise<void> => {
        await gotoWithRetry(page, url, readyLocator.or(loginPage.usernameInput), {
          maxAttempts: 3,
        });
        if (page.url().includes('/auth/login')) {
          await loginPage.login(adminCredentials.username, adminCredentials.password);
          await gotoWithRetry(page, url, readyLocator, { maxAttempts: 3 });
          await context.storageState({ path: storageStatePath }).catch(() => undefined);
        }
        await employeePage.waitForSpinnerToClear();
      };

      employeePage.gotoEmployeeList = async () =>
        navigateWithReauth('/web/index.php/pim/viewEmployeeList', employeePage.filterSection);
      employeePage.gotoAddEmployee = async () =>
        navigateWithReauth('/web/index.php/pim/addEmployee', employeePage.firstNameInput);
      employeePage.gotoPersonalDetails = async (empNumber: number) =>
        navigateWithReauth(
          `/web/index.php/pim/viewPersonalDetails/empNumber/${empNumber}`,
          employeePage.firstNameInput
        );

      await use(employeePage);
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
