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

  test('TC-AUTH-002: Valid ESS login & keyboard Enter submission @functional @e2e @rbac', async ({
    loginPage,
    dashboardPage,
    essAccount,
    essUserConfig,
  }) => {
    await loginPage.goto();
    await loginPage.loginWithKeyboard(essAccount.username, essAccount.password);
    await dashboardPage.expectEssViewLoaded(
      essUserConfig.expectedVisibleMenus,
      essUserConfig.expectedHiddenMenus
    );
  });

  test('TC-AUTH-003: Invalid login with wrong password shows alert @negative @regression', async ({
    loginPage,
    adminCredentials,
  }) => {
    await loginPage.goto();
    await loginPage.login(adminCredentials.username, `${adminCredentials.password}_invalid`);
    await loginPage.expectInvalidCredentialsError();
  });
});
