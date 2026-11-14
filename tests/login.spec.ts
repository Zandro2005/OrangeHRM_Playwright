import { test } from '../fixtures/authFixture';

test.describe('Module 1: Authentication', () => {
  test('TC-AUTH-001: Valid Admin login redirects to Dashboard @smoke @functional @e2e', async ({
    loginPage,
    dashboardPage,
    adminCredentials,
  }) => {
    await loginPage.goto();
    await loginPage.login(adminCredentials.username, adminCredentials.password);
    await dashboardPage.expectLoaded();
  });
});
