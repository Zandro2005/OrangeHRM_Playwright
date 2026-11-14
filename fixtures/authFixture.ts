import { test as baseTest, expect } from './baseFixture';

export interface AuthFixtures {
  adminCredentials: {
    username: string;
    password: string;
  };
}

export const test = baseTest.extend<AuthFixtures>({
  adminCredentials: async ({}, use) => {
    await use({
      username: process.env.ADMIN_USERNAME || 'Admin',
      password: process.env.ADMIN_PASSWORD || 'admin123',
    });
  },
});

export { expect };
