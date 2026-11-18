import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { APIResponse, Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { generateEmployeeData, GeneratedEmployeeInput } from './testDataGenerator';

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
  const maxAttempts = options.maxAttempts ?? 3;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? 38_000;
  const readyTimeoutMs = options.readyTimeoutMs ?? 25_000;

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

async function apiWriteWithRetry(
  method: 'post' | 'put',
  context: BrowserContext,
  url: string,
  data: Record<string, unknown>
): Promise<APIResponse> {
  return withRetry(
    async () => {
      const res = await context.request[method](url, { timeout: 25_000, data });
      if (res.status() >= 500) {
        throw new Error(`${method.toUpperCase()} ${url} returned HTTP ${res.status()}`);
      }
      return res;
    },
    { maxAttempts: 4, baseDelayMs: 1_500 }
  );
}

/** Send a POST request with retry handling for transient HTTP 5xx/network errors. */
export async function apiPostWithRetry(
  context: BrowserContext,
  url: string,
  data: Record<string, unknown>
): Promise<APIResponse> {
  return apiWriteWithRetry('post', context, url, data);
}

/** Send a PUT request with retry handling for transient HTTP 5xx/network errors. */
export async function apiPutWithRetry(
  context: BrowserContext,
  url: string,
  data: Record<string, unknown>
): Promise<APIResponse> {
  return apiWriteWithRetry('put', context, url, data);
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

export interface UserValidationData {
  shortUsername: string;
  weakPassword: string;
  mismatchedPasswordA: string;
  mismatchedPasswordB: string;
  nonExistentUsername: string;
}

export interface UsersTestData {
  essUser: EssUserConfig;
  invalidLogins: InvalidLoginRow[];
  userValidation: UserValidationData;
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

export interface SeededEmployee {
  empNumber: number;
  firstName: string;
  middleName: string;
  lastName: string;
  employeeId: string;
  jobTitle?: string;
  empStatus?: string;
  subunit?: string;
  cleanup: () => Promise<void>;
}

export interface SeedEmployeeOptions extends Partial<GeneratedEmployeeInput> {
  assignJobDetails?: boolean;
}

async function safeDeleteRecords(
  context: BrowserContext,
  endpoint: string,
  ids: number[],
  label: string
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const idLabel = ids.length === 1 ? String(ids[0]) : `[${ids.join(', ')}]`;
  try {
    const res = await withRetry(
      async () => {
        const response = await context.request.delete(endpoint, {
          timeout: 25_000,
          data: { ids },
        });
        if (response.status() >= 500) {
          throw new Error(`DELETE ${endpoint} returned HTTP ${response.status()}`);
        }
        return response;
      },
      { maxAttempts: 3, baseDelayMs: 1_000 }
    );
    // Treat 404/422 as already deleted during teardown
    if (!res.ok() && res.status() !== 404 && res.status() !== 422) {
      console.warn(`Cleanup warning: failed to delete ${label} ${idLabel} (${res.status()})`);
    }
  } catch (error) {
    const summary = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(`Cleanup warning: ${label} ${idLabel} deletion errored: ${summary}`);
  }
}

async function safeDeleteRecord(
  context: BrowserContext,
  endpoint: string,
  id: number,
  label: string
): Promise<void> {
  await safeDeleteRecords(context, endpoint, [id], label);
}

async function createValidatedAdminApiContext(
  browser: Browser,
  adminCredentials: AdminCredentials,
  baseURL?: string
): Promise<BrowserContext> {
  const storageStatePath = path.resolve(__dirname, '../auth/auth.json');
  await ensureAuthStorageState(browser, adminCredentials, storageStatePath, baseURL);

  const cachedContext = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: storageStatePath,
  });

  const probe = await withRetry(
    () =>
      cachedContext.request.get('/web/index.php/api/v2/dashboard/shortcuts', {
        timeout: 20_000,
      }),
    { maxAttempts: 2, baseDelayMs: 1_000 }
  ).catch(() => undefined);

  if (probe && probe.status() === 200) {
    return cachedContext;
  }

  // Fallback to a fresh UI login if the demo server invalidated auth/auth.json within TTL
  await cachedContext.close().catch(() => undefined);
  if (fs.existsSync(storageStatePath)) {
    fs.rmSync(storageStatePath, { force: true });
  }
  await ensureAuthStorageState(browser, adminCredentials, storageStatePath, baseURL);
  return browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: storageStatePath,
  });
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

  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  let empNumber: number | undefined;
  let userId: number | undefined;

  const cleanup = async (): Promise<void> => {
    try {
      if (userId !== undefined) {
        await safeDeleteRecord(adminContext, '/web/index.php/api/v2/admin/users', userId, 'user');
      }
      if (empNumber !== undefined) {
        await safeDeleteRecord(
          adminContext,
          '/web/index.php/api/v2/pim/employees',
          empNumber,
          'employee'
        );
      }
    } finally {
      await adminContext.close().catch(() => undefined);
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

/** Seed a disposable PIM employee via REST API (optionally populating Job Details) with guaranteed teardown. */
export async function seedEmployee(
  browser: Browser,
  adminCredentials: AdminCredentials,
  baseURL?: string,
  options: SeedEmployeeOptions = {}
): Promise<SeededEmployee> {
  const generated = generateEmployeeData();
  const firstName = options.firstName ?? generated.firstName;
  const middleName = options.middleName ?? generated.middleName;
  const lastName = options.lastName ?? generated.lastName;
  const employeeId = options.employeeId ?? generated.employeeId;

  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  let empNumber: number | undefined;

  const cleanup = async (): Promise<void> => {
    try {
      if (empNumber !== undefined) {
        await safeDeleteRecord(
          adminContext,
          '/web/index.php/api/v2/pim/employees',
          empNumber,
          'employee'
        );
      }
    } finally {
      await adminContext.close().catch(() => undefined);
    }
  };

  try {
    const empRes = await apiPostWithRetry(adminContext, '/web/index.php/api/v2/pim/employees', {
      firstName,
      middleName,
      lastName,
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

    let jobTitle: string | undefined;
    let empStatus: string | undefined;
    let subunit: string | undefined;

    if (options.assignJobDetails) {
      const [statusesRes, titlesRes, subunitsRes] = await Promise.all([
        adminContext.request.get('/web/index.php/api/v2/admin/employment-statuses?limit=5', {
          timeout: 20_000,
        }),
        adminContext.request.get('/web/index.php/api/v2/admin/job-titles?limit=5', {
          timeout: 20_000,
        }),
        adminContext.request.get('/web/index.php/api/v2/admin/subunits', { timeout: 20_000 }),
      ]);

      const statusesJson = statusesRes.ok()
        ? ((await statusesRes.json()) as { data?: Array<{ id: number; name: string }> })
        : {};
      const titlesJson = titlesRes.ok()
        ? ((await titlesRes.json()) as { data?: Array<{ id: number; title: string }> })
        : {};
      const subunitsJson = subunitsRes.ok()
        ? ((await subunitsRes.json()) as {
            data?: Array<{ id: number; name: string; level: number }>;
          })
        : {};

      const statusItem = statusesJson.data?.[0];
      const titleItem = titlesJson.data?.[0];
      const subunitItem =
        subunitsJson.data?.find((s) => s.level > 0) ?? subunitsJson.data?.[0];

      const jobRes = await apiPutWithRetry(
        adminContext,
        `/web/index.php/api/v2/pim/employees/${empNumber}/job-details`,
        {
          joinedDate: '2025-01-15',
          ...(titleItem ? { jobTitleId: titleItem.id } : {}),
          ...(statusItem ? { empStatusId: statusItem.id } : {}),
          ...(subunitItem ? { subunitId: subunitItem.id } : {}),
        }
      );

      if (jobRes.ok()) {
        jobTitle = titleItem?.title;
        empStatus = statusItem?.name;
        subunit = subunitItem?.name;
      }
    }

    return {
      empNumber,
      firstName,
      middleName,
      lastName,
      employeeId,
      jobTitle,
      empStatus,
      subunit,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Delete an employee record by empNumber via the Admin REST API (best-effort teardown). */
export async function deleteEmployeeByEmpNumber(
  browser: Browser,
  adminCredentials: AdminCredentials,
  empNumber: number,
  baseURL?: string
): Promise<void> {
  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  try {
    await safeDeleteRecord(
      adminContext,
      '/web/index.php/api/v2/pim/employees',
      empNumber,
      'employee'
    );
  } finally {
    await adminContext.close().catch(() => undefined);
  }
}

/** Look up any employee(s) matching an Employee Id string and delete them via Admin REST API. */
export async function deleteEmployeeByIdIfPresent(
  browser: Browser,
  adminCredentials: AdminCredentials,
  employeeId: string,
  baseURL?: string
): Promise<void> {
  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  try {
    const res = await withRetry(
      () =>
        adminContext.request.get(
          `/web/index.php/api/v2/pim/employees?employeeId=${encodeURIComponent(employeeId)}`,
          { timeout: 20_000 }
        ),
      { maxAttempts: 3, baseDelayMs: 1_000 }
    );
    if (!res.ok()) {
      return;
    }
    const body = (await res.json()) as {
      data?: Array<{ empNumber?: number; employeeId?: string }>;
    };
    const matchingIds = (body.data ?? [])
      .filter((row) => row.employeeId === employeeId && typeof row.empNumber === 'number')
      .map((row) => row.empNumber as number);
    await safeDeleteRecords(
      adminContext,
      '/web/index.php/api/v2/pim/employees',
      matchingIds,
      'employee'
    );
  } catch (error) {
    const summary = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(`Cleanup warning: employee lookup for ${employeeId} errored: ${summary}`);
  } finally {
    await adminContext.close().catch(() => undefined);
  }
}

/** Verify via GET API that a deleted employee record no longer exists (404 / empty record). */
export async function verifyEmployeeDeletedViaApi(
  browser: Browser,
  adminCredentials: AdminCredentials,
  empNumber: number,
  baseURL?: string
): Promise<boolean> {
  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  try {
    const res = await withRetry(
      () =>
        adminContext.request.get(`/web/index.php/api/v2/pim/employees/${empNumber}`, {
          timeout: 20_000,
        }),
      { maxAttempts: 3, baseDelayMs: 1_000 }
    );
    if (res.status() === 404 || res.status() === 422) {
      return true;
    }
    if (!res.ok()) {
      return false;
    }
    const body = (await res.json()) as { data?: { empNumber?: number } | null };
    return !body.data?.empNumber;
  } finally {
    await adminContext.close().catch(() => undefined);
  }
}

export interface SeededSystemUser {
  userId: number;
  empNumber: number;
  firstName: string;
  lastName: string;
  employeeId: string;
  username: string;
  password: string;
  role: 'Admin' | 'ESS';
  status: boolean;
  cleanup: () => Promise<void>;
}

export interface SeedSystemUserOptions {
  role?: 'Admin' | 'ESS';
  status?: boolean;
  usernamePrefix?: string;
  firstName?: string;
  lastName?: string;
  empNumber?: number;
  employeeId?: string;
}

/** Seed a disposable employee (unless `empNumber` is provided) and linked System User via REST APIs. */
export async function seedSystemUser(
  browser: Browser,
  adminCredentials: AdminCredentials,
  baseURL?: string,
  options: SeedSystemUserOptions = {}
): Promise<SeededSystemUser> {
  const role: 'Admin' | 'ESS' = options.role ?? 'ESS';
  const status = options.status ?? true;
  const userRoleId = role === 'Admin' ? 1 : 2;
  const generated = generateEmployeeData(options.firstName ? undefined : 'Sys');
  const firstName = options.firstName ?? generated.firstName;
  const lastName = options.lastName ?? generated.lastName;
  const employeeId = options.employeeId ?? generated.employeeId;
  const suffix = crypto.randomBytes(3).toString('hex');
  const username = `${options.usernamePrefix ?? 'sysusr'}_${suffix}`;
  const password = `Usr!${suffix}9aA`;

  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  const ownsEmployee = options.empNumber === undefined;
  let empNumber: number | undefined = options.empNumber;
  let userId: number | undefined;

  const cleanup = async (): Promise<void> => {
    try {
      if (userId !== undefined) {
        await safeDeleteRecord(adminContext, '/web/index.php/api/v2/admin/users', userId, 'user');
      }
      if (ownsEmployee && empNumber !== undefined) {
        await safeDeleteRecord(
          adminContext,
          '/web/index.php/api/v2/pim/employees',
          empNumber,
          'employee'
        );
      }
    } finally {
      await adminContext.close().catch(() => undefined);
    }
  };

  try {
    if (empNumber === undefined) {
      const empRes = await apiPostWithRetry(adminContext, '/web/index.php/api/v2/pim/employees', {
        firstName,
        middleName: '',
        lastName,
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
    }

    const userRes = await apiPostWithRetry(adminContext, '/web/index.php/api/v2/admin/users', {
      username,
      password,
      status,
      userRoleId,
      empNumber,
    });
    if (!userRes.ok()) {
      throw new Error(`Failed to seed system user (${userRes.status()}): ${await userRes.text()}`);
    }
    const userBody = (await userRes.json()) as { data?: { id?: number } };
    userId = userBody.data?.id;
    if (!userId) {
      throw new Error('System user seeding succeeded without returning a user id.');
    }

    return {
      userId,
      empNumber,
      firstName,
      lastName,
      employeeId,
      username,
      password,
      role,
      status,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Delete any system user(s) matching `username` via Admin REST API (best-effort teardown). */
export async function deleteSystemUserByUsernameIfPresent(
  browser: Browser,
  adminCredentials: AdminCredentials,
  username: string,
  baseURL?: string
): Promise<void> {
  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  try {
    const res = await withRetry(
      () =>
        adminContext.request.get(
          `/web/index.php/api/v2/admin/users?username=${encodeURIComponent(username)}`,
          { timeout: 20_000 }
        ),
      { maxAttempts: 3, baseDelayMs: 1_000 }
    );
    if (!res.ok()) {
      return;
    }
    const body = (await res.json()) as {
      data?: Array<{ id?: number; userName?: string }>;
    };
    const matchingIds = (body.data ?? [])
      .filter((row) => row.userName === username && typeof row.id === 'number')
      .map((row) => row.id as number);
    await safeDeleteRecords(
      adminContext,
      '/web/index.php/api/v2/admin/users',
      matchingIds,
      'system user'
    );
  } catch (error) {
    const summary = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.warn(`Cleanup warning: system user lookup for ${username} errored: ${summary}`);
  } finally {
    await adminContext.close().catch(() => undefined);
  }
}

export interface SystemUserApiLookup {
  total: number;
  matches: Array<{
    id: number;
    userName: string;
    userRole?: { name?: string };
    status?: boolean;
  }>;
}

/** Query `/api/v2/admin/users` by exact username to verify API/UI parity or deletion. */
export async function getSystemUserViaApi(
  browser: Browser,
  adminCredentials: AdminCredentials,
  username: string,
  baseURL?: string
): Promise<SystemUserApiLookup> {
  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  try {
    const res = await withRetry(
      () =>
        adminContext.request.get(
          `/web/index.php/api/v2/admin/users?username=${encodeURIComponent(username)}`,
          { timeout: 20_000 }
        ),
      { maxAttempts: 3, baseDelayMs: 1_000 }
    );
    if (!res.ok()) {
      return { total: 0, matches: [] };
    }
    const body = (await res.json()) as {
      data?: Array<{
        id: number;
        userName: string;
        userRole?: { name?: string };
        status?: boolean;
      }>;
      meta?: { total?: number };
    };
    const rows = body.data ?? [];
    return {
      total: body.meta?.total ?? rows.length,
      matches: rows,
    };
  } finally {
    await adminContext.close().catch(() => undefined);
  }
}

const SESSION_VALIDATION_TTL_MS = 1_200_000;

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

    // Skip spawning an extra BrowserContext probe when auth/auth.json was recently validated
    const stat = fs.statSync(storageStatePath);
    if (Date.now() - stat.mtimeMs < SESSION_VALIDATION_TTL_MS) {
      return true;
    }

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
    if (res.status() === 200) {
      const now = new Date();
      fs.utimesSync(storageStatePath, now, now);
      return true;
    }
    return false;
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

/**
 * Override public demo server Corporate Branding customizations so visual regression
 * baselines remain deterministic even when shared users change the demo site's theme.
 */
export async function resetOrangeHrmThemeVariables(page: Page): Promise<void> {
  await page.evaluate(() => {
    const styleId = 'pw-default-theme';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      :root {
        --oxd-primary-one-color: #ff7b1d !important;
        --oxd-primary-font-color: #ffffff !important;
        --oxd-secondary-four-color: #76bc21 !important;
        --oxd-secondary-font-color: #ffffff !important;
        --oxd-primary-gradient-start-color: #ff920b !important;
        --oxd-primary-gradient-end-color: #f35c17 !important;
        --oxd-secondary-gradient-start-color: #ff920b !important;
        --oxd-secondary-gradient-end-color: #f35c17 !important;
        --oxd-primary-one-lighten-5-color: #ff8a37 !important;
        --oxd-primary-one-lighten-30-color: #ffd4b6 !important;
        --oxd-primary-one-darken-5-color: #ff6c04 !important;
        --oxd-primary-one-alpha-10-color: rgba(255, 123, 29, 0.1) !important;
        --oxd-primary-one-alpha-15-color: rgba(255, 123, 29, 0.15) !important;
        --oxd-primary-one-alpha-20-color: rgba(255, 123, 29, 0.2) !important;
        --oxd-primary-one-alpha-50-color: rgba(255, 123, 29, 0.5) !important;
        --oxd-secondary-four-lighten-5-color: #84d225 !important;
        --oxd-secondary-four-darken-5-color: #68a61d !important;
        --oxd-secondary-four-alpha-10-color: rgba(118, 188, 33, 0.1) !important;
        --oxd-secondary-four-alpha-15-color: rgba(118, 188, 33, 0.15) !important;
        --oxd-secondary-four-alpha-20-color: rgba(118, 188, 33, 0.2) !important;
        --oxd-secondary-four-alpha-50-color: rgba(118, 188, 33, 0.5) !important;
      }
    `;
  });
}
