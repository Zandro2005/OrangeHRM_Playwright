import { test as baseTest, expect } from './baseFixture';

export interface AuthFixtures {
  adminCredentials: {
    username: string;
    password: string;
  };
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
});

export { expect };
