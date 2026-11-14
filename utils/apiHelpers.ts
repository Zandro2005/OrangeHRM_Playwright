import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Browser, BrowserContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

export interface AdminCredentials {
  username: string;
  password: string;
}

export interface EssUserConfig {
  role: string;
  userRoleId: number;
  status: boolean;
  firstName: string;
  lastName: string;
  usernamePrefix: string;
  expectedVisibleMenus: string[];
  expectedHiddenMenus: string[];
}

export interface UsersTestData {
  essUser: EssUserConfig;
}

export interface SeededEssAccount {
  username: string;
  password: string;
  userId: number;
  empNumber: number;
  cleanup: () => Promise<void>;
}

/** Load structured user test data configuration from test-data/users.json. */
export function loadUsersData(): UsersTestData {
  const filePath = path.resolve(__dirname, '../test-data/users.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as UsersTestData;
}

function generateTempPassword(suffix: string): string {
  // Always satisfy OrangeHRM complexity rules without hardcoding static passwords
  return `Ess!${suffix}9aA`;
}

async function authenticateAdminContext(
  browser: Browser,
  adminCredentials: AdminCredentials,
  baseURL?: string
): Promise<BrowserContext> {
  const context = await browser.newContext(baseURL ? { baseURL } : undefined);
  const page = await context.newPage();

  try {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(adminCredentials.username, adminCredentials.password);
    await page.waitForURL(/\/dashboard\/index/);
    await page.close();
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Seed a disposable employee and linked ESS login account via Admin REST APIs. */
export async function seedEssAccount(
  browser: Browser,
  adminCredentials: AdminCredentials,
  essConfig: EssUserConfig,
  baseURL?: string
): Promise<SeededEssAccount> {
  const suffix = crypto.randomBytes(4).toString('hex');
  const employeeId = `E${suffix}`;
  const username = `${essConfig.usernamePrefix}_${suffix}`;
  const password = generateTempPassword(suffix);

  const adminContext = await authenticateAdminContext(browser, adminCredentials, baseURL);
  let empNumber: number | undefined;
  let userId: number | undefined;

  const cleanup = async (): Promise<void> => {
    try {
      if (userId !== undefined) {
        const delUserRes = await adminContext.request.delete('/web/index.php/api/v2/admin/users', {
          data: { ids: [userId] },
        });
        if (!delUserRes.ok()) {
          console.warn(`Cleanup warning: failed to delete user ${userId} (${delUserRes.status()})`);
        }
      }
      if (empNumber !== undefined) {
        const delEmpRes = await adminContext.request.delete(
          '/web/index.php/api/v2/pim/employees',
          { data: { ids: [empNumber] } }
        );
        if (!delEmpRes.ok()) {
          console.warn(
            `Cleanup warning: failed to delete employee ${empNumber} (${delEmpRes.status()})`
          );
        }
      }
    } finally {
      await adminContext.close();
    }
  };

  try {
    // Step 1: Create an employee record first so the ESS user can link to it
    const empRes = await adminContext.request.post('/web/index.php/api/v2/pim/employees', {
      data: {
        firstName: essConfig.firstName,
        middleName: '',
        lastName: essConfig.lastName,
        employeeId,
      },
    });
    if (!empRes.ok()) {
      throw new Error(`Failed to seed employee (${empRes.status()}): ${await empRes.text()}`);
    }
    const empBody = (await empRes.json()) as { data?: { empNumber?: number } };
    empNumber = empBody.data?.empNumber;
    if (!empNumber) {
      throw new Error('Employee seeding succeeded without returning an empNumber.');
    }

    // Step 2: Create the ESS login account mapped to the seeded employee
    const userRes = await adminContext.request.post('/web/index.php/api/v2/admin/users', {
      data: {
        username,
        password,
        status: essConfig.status,
        userRoleId: essConfig.userRoleId,
        empNumber,
      },
    });
    if (!userRes.ok()) {
      throw new Error(`Failed to seed ESS user (${userRes.status()}): ${await userRes.text()}`);
    }
    const userBody = (await userRes.json()) as { data?: { id?: number } };
    userId = userBody.data?.id;
    if (!userId) {
      throw new Error('ESS user seeding succeeded without returning a user id.');
    }

    return { username, password, userId, empNumber, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
