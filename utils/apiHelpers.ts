import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
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

async function safeDeleteRecord(
  context: BrowserContext,
  endpoint: string,
  id: number,
  label: string
): Promise<void> {
  try {
    const res = await context.request.delete(endpoint, { timeout: 25_000, data: { ids: [id] } });
    // Treat 404 as already deleted during teardown
    if (!res.ok() && res.status() !== 404) {
      console.warn(`Cleanup warning: failed to delete ${label} ${id} (${res.status()})`);
    }
  } catch (error) {
    console.warn(`Cleanup warning: ${label} ${id} deletion errored:`, error);
  }
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
    try {
      const now = new Date();
      fs.utimesSync(storageStatePath, now, now);
    } catch {
      // Ignore mtime refresh races across parallel workers
    }
    return cachedContext;
  }

  // Return cachedContext on transient timeouts or non-auth errors so callers' retry loops recover without wiping cookies
  if (!probe || (probe.status() !== 401 && probe.status() !== 403)) {
    return cachedContext;
  }

  // Fallback to a fresh UI login only when the demo server invalidated auth/auth.json (401/403)
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
    const res = await adminContext.request.get(
      `/web/index.php/api/v2/pim/employees?employeeId=${encodeURIComponent(employeeId)}`,
      { timeout: 20_000 }
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
    if (matchingIds.length > 0) {
      await adminContext.request
        .delete('/web/index.php/api/v2/pim/employees', { data: { ids: matchingIds } })
        .catch(() => undefined);
    }
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

export interface SettingsTestData {
  localization: {
    defaultLanguage: string;
    defaultLanguageCode: string;
    updatedDateFormatPrefix: string;
    updatedDateFormatCode: string;
    defaultDateFormatPrefix: string;
    defaultDateFormatCode: string;
  };
  emailConfiguration: {
    validSentAs: string;
    validSmtpHost: string;
    validSmtpPort: string;
    invalidEmailFormat: string;
    invalidNonNumericPort: string;
  };
  modules: {
    optionalModuleLabel: string;
    optionalModuleSidebarName: string;
    coreLockedModuleLabels: string[];
  };
  corporateBranding: {
    updatedPrimaryColorHex: string;
    updatedPrimaryColorRgb: string;
    defaultPrimaryColorHex: string;
    defaultPrimaryColorRgb: string;
  };
}

/** Load structured Module 7 settings & configuration test data from test-data/settings.json. */
export function loadSettingsData(): SettingsTestData {
  const filePath = path.resolve(__dirname, '../test-data/settings.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SettingsTestData;
}

async function putAdminSettingWithContext(
  browser: Browser,
  adminCredentials: AdminCredentials,
  endpoint: string,
  payload: Record<string, unknown>,
  label: string,
  baseURL?: string
): Promise<void> {
  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  try {
    const res = await apiPutWithRetry(adminContext, endpoint, payload);
    if (!res.ok()) {
      console.warn(`Teardown warning: failed to restore ${label} (${res.status()})`);
    }
  } finally {
    await adminContext.close().catch(() => undefined);
  }
}

/** Restore default Localization settings (en_US, Y-d-m) via Admin REST API. */
export async function restoreDefaultLocalizationViaApi(
  browser: Browser,
  adminCredentials: AdminCredentials,
  baseURL?: string
): Promise<void> {
  await putAdminSettingWithContext(
    browser,
    adminCredentials,
    '/web/index.php/api/v2/admin/localization',
    { language: 'en_US', dateFormat: 'Y-d-m' },
    'default localization',
    baseURL
  );
}

/** Restore all OrangeHRM modules to enabled state via Admin REST API. */
export async function restoreDefaultModulesViaApi(
  browser: Browser,
  adminCredentials: AdminCredentials,
  baseURL?: string
): Promise<void> {
  await putAdminSettingWithContext(
    browser,
    adminCredentials,
    '/web/index.php/api/v2/admin/modules',
    {
      admin: true,
      pim: true,
      leave: true,
      time: true,
      recruitment: true,
      performance: true,
      maintenance: true,
      mobile: true,
      directory: true,
      claim: true,
      buzz: true,
    },
    'default modules',
    baseURL
  );
}

/** Reset Corporate Branding theme back to OrangeHRM defaults via Admin REST API. */
export async function restoreDefaultThemeViaApi(
  browser: Browser,
  adminCredentials: AdminCredentials,
  baseURL?: string
): Promise<void> {
  const adminContext = await createValidatedAdminApiContext(browser, adminCredentials, baseURL);
  try {
    const res = await withRetry(
      async () => {
        const response = await adminContext.request.delete('/web/index.php/api/v2/admin/theme', {
          timeout: 25_000,
        });
        if (response.status() >= 500) {
          throw new Error(`DELETE /api/v2/admin/theme returned HTTP ${response.status()}`);
        }
        return response;
      },
      { maxAttempts: 3, baseDelayMs: 1_000 }
    );
    if (!res.ok() && res.status() !== 404) {
      console.warn(`Teardown warning: failed to reset default theme (${res.status()})`);
    }
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

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

/**
 * Serialize cross-worker access to shared global OrangeHRM resources (e.g. Localization,
 * Modules, Corporate Branding, auth/auth.json refresh) via an atomic OS lock file.
 */
export async function withCrossWorkerLock<T>(
  resourceName: string,
  operation: () => Promise<T>,
  options: { baseURL?: string; timeoutMs?: number; staleMs?: number; pollMs?: number } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 240_000;
  const staleMs = options.staleMs ?? 180_000;
  const pollMs = options.pollMs ?? 250;

  const targetScope = options.baseURL || process.env.BASE_URL || 'default';
  const scopeHash = crypto.createHash('sha1').update(targetScope).digest('hex').slice(0, 8);
  const safeName = resourceName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const lockDir = path.join(os.tmpdir(), 'orangehrm-playwright-locks');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${safeName}-${scopeHash}.lock`);
  const ownerToken = `${process.pid}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
  const deadline = Date.now() + timeoutMs;

  let acquired = false;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({ pid: process.pid, ownerToken, acquiredAt: Date.now() }),
          'utf8'
        );
      } finally {
        fs.closeSync(fd);
      }
      acquired = true;
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = fs.statSync(lockPath);
        const ageMs = Date.now() - stat.mtimeMs;
        let ownerDead = false;
        if (ageMs > 2_000) {
          const raw = fs.readFileSync(lockPath, 'utf8').trim();
          if (raw) {
            const parsed = JSON.parse(raw) as { pid?: number };
            if (typeof parsed.pid === 'number' && !isPidAlive(parsed.pid)) {
              ownerDead = true;
            }
          }
        }
        if (ageMs > staleMs || ownerDead) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  if (!acquired) {
    throw new Error(`Timed out after ${timeoutMs}ms waiting for cross-worker lock "${resourceName}"`);
  }

  try {
    return await operation();
  } finally {
    try {
      const raw = fs.readFileSync(lockPath, 'utf8').trim();
      if (!raw || raw.includes(ownerToken)) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch {
      // Lock file already removed
    }
  }
}

/** Write Playwright storageState via a PID-unique temp file and atomic rename. */
export async function saveStorageStateAtomically(
  context: BrowserContext,
  storageStatePath: string
): Promise<void> {
  const tempPath = `${storageStatePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
    await context.storageState({ path: tempPath });
    try {
      fs.renameSync(tempPath, storageStatePath);
    } catch (error) {
      if (!fs.existsSync(storageStatePath)) {
        throw error;
      }
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
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

  return withCrossWorkerLock(
    'auth-storage-state',
    async () => {
      if (await hasActiveSession(browser, storageStatePath, baseURL)) {
        return storageStatePath;
      }

      const adminContext = await authenticateAdminContext(browser, adminCredentials, baseURL);
      try {
        await saveStorageStateAtomically(adminContext, storageStatePath);
        return storageStatePath;
      } finally {
        await adminContext.close();
      }
    },
    { baseURL }
  );
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
