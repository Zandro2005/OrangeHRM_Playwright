import path from 'path';
import { test as baseTest, expect } from './baseFixture';
import {
  AdminCredentials,
  EssUserConfig,
  InvalidLoginRow,
  SeededEssAccount,
  ensureAuthStorageState,
  loadUsersData,
  seedEssAccount,
} from '../utils/apiHelpers';

export interface AuthFixtures {
  adminCredentials: AdminCredentials;
  essUserConfig: EssUserConfig;
  invalidLoginCases: InvalidLoginRow[];
  storageStatePath: string;
  essAccount: SeededEssAccount;
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
});

export { expect };
