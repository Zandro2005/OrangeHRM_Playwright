import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { APIResponse, Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export interface GotoRetryOptions {
  maxAttempts?: number;
  navigationTimeoutMs?: number;
  readyTimeoutMs?: number;
}

/** Run an async operation with progressive backoff and jitter to smooth burst load. */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 1_500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryAllowed = options.shouldRetry ? options.shouldRetry(error) : true;
      if (attempt === maxAttempts || !retryAllowed) {
        throw error;
      }
      // Spread retries with jitter so parallel workers do not hit the server in lockstep
      const jitterMs = Math.floor(Math.random() * 600);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt + jitterMs));
    }
  }

  throw lastError;
}

/** Navigate to a URL, retrying transient network timeouts or HTTP 5xx responses. */
export async function gotoWithRetry(
  page: Page,
  url: string,
  readyLocator?: Locator,
  options: GotoRetryOptions = {}
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 4;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? 22_000;
  const readyTimeoutMs = options.readyTimeoutMs ?? 20_000;

  await withRetry(
    async () => {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeoutMs,
      });
      if (response && response.status() >= 500) {
        throw new Error(`Navigation to ${url} returned HTTP ${response.status()}`);
      }
      if (readyLocator) {
        await readyLocator.waitFor({ state: 'visible', timeout: readyTimeoutMs });
      }
    },
    {
      maxAttempts,
      baseDelayMs: 1_500,
      shouldRetry: () => !page.isClosed(),
    }
  );
}

async function apiPostWithRetry(
  context: BrowserContext,
  url: string,
  data: Record<string, unknown>
): Promise<APIResponse> {
  return withRetry(
    async () => {
      const res = await context.request.post(url, { timeout: 25_000, data });
      if (res.status() >= 500) {
        throw new Error(`POST ${url} returned HTTP ${res.status()}`);
      }
      return res;
    },
    { maxAttempts: 4, baseDelayMs: 1_500 }
  );
}

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

export interface InvalidLoginRow {
  label: string;
  username: string;
  password?: string;
  useWrongPasswordCase?: boolean;
}

export interface UsersTestData {
  essUser: EssUserConfig;
  invalidLogins: InvalidLoginRow[];
}

export interface SeededEssAccount {
  username: string;
  password: string;
  userId: number;
  empNumber: number;
  cleanup: () => Promise<void>;
}

/** Invert alphabetical casing to construct dynamic wrong-case negative test inputs. */
export function swapCase(value: string): string {
  return [...value]
    .map((ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()))
    .join('');
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
  return withRetry(
    async () => {
      const context = await browser.newContext(baseURL ? { baseURL } : undefined);
      const page = await context.newPage();

      try {
        const loginPage = new LoginPage(page);
        await loginPage.goto();
        await loginPage.login(adminCredentials.username, adminCredentials.password);
        await page.waitForURL(/\/dashboard\/index/, {
          waitUntil: 'domcontentloaded',
          timeout: 25_000,
        });
        await page.close();
        return context;
      } catch (error) {
        await context.close();
        throw error;
      }
    },
    { maxAttempts: 3, baseDelayMs: 1_500 }
  );
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

  const safeDelete = async (endpoint: string, id: number, label: string): Promise<void> => {
    try {
      const res = await adminContext.request.delete(endpoint, { data: { ids: [id] } });
      if (!res.ok()) {
        console.warn(`Cleanup warning: failed to delete ${label} ${id} (${res.status()})`);
      }
    } catch (error) {
      console.warn(`Cleanup warning: ${label} ${id} deletion errored:`, error);
    }
  };

  const cleanup = async (): Promise<void> => {
    try {
      if (userId !== undefined) {
        await safeDelete('/web/index.php/api/v2/admin/users', userId, 'user');
      }
      if (empNumber !== undefined) {
        await safeDelete('/web/index.php/api/v2/pim/employees', empNumber, 'employee');
      }
    } finally {
      await adminContext.close();
    }
  };

  try {
    // Step 1: Create an employee record first (with retry for transient connect ETIMEDOUT)
    const empRes = await apiPostWithRetry(adminContext, '/web/index.php/api/v2/pim/employees', {
      firstName: essConfig.firstName,
      middleName: '',
      lastName: essConfig.lastName,
      employeeId,
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
    const userRes = await apiPostWithRetry(adminContext, '/web/index.php/api/v2/admin/users', {
      username,
      password,
      status: essConfig.status,
      userRoleId: essConfig.userRoleId,
      empNumber,
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

async function hasActiveSession(
  browser: Browser,
  storageStatePath: string,
  baseURL?: string
): Promise<boolean> {
  if (!fs.existsSync(storageStatePath)) {
    return false;
  }

  let checkContext: BrowserContext | undefined;
  try {
    const raw = fs.readFileSync(storageStatePath, 'utf8').trim();
    if (!raw) {
      return false;
    }
    JSON.parse(raw);

    checkContext = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: storageStatePath,
    });
    const res = await withRetry(
      () =>
        checkContext!.request.get('/web/index.php/api/v2/dashboard/shortcuts', {
          timeout: 20_000,
        }),
      { maxAttempts: 2, baseDelayMs: 1_000 }
    );
    return res.status() === 200;
  } catch {
    return false;
  } finally {
    await checkContext?.close();
  }
}

/** Ensure auth/auth.json exists with an active Admin session, refreshing atomically if expired. */
export async function ensureAuthStorageState(
  browser: Browser,
  adminCredentials: AdminCredentials,
  storageStatePath: string,
  baseURL?: string
): Promise<string> {
  if (await hasActiveSession(browser, storageStatePath, baseURL)) {
    return storageStatePath;
  }

  const adminContext = await authenticateAdminContext(browser, adminCredentials, baseURL);
  const tempPath = `${storageStatePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
    await adminContext.storageState({ path: tempPath });
    try {
      fs.renameSync(tempPath, storageStatePath);
    } catch (error) {
      // Another parallel worker may have just finished writing auth/auth.json on Windows
      if (!fs.existsSync(storageStatePath)) {
        throw error;
      }
    }
    return storageStatePath;
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
    await adminContext.close();
  }
}
