import { expect, test } from '../fixtures/adminFixture';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { runA11yAudit } from '../utils/accessibility';
import { getSystemUserViaApi, loadUsersData } from '../utils/apiHelpers';
import { generateSystemUserCredentials } from '../utils/testDataGenerator';

test.describe('Module 4: User Management (Admin)', () => {
  test('TC-USR-001: Create Admin user linked to API-seeded employee @functional @e2e @smoke', async ({
    usersPage,
    seededEmployee,
    registerDisposableUsername,
  }) => {
    const creds = generateSystemUserCredentials('adm');
    registerDisposableUsername(creds.username);

    await usersPage.gotoUsersList();
    await usersPage.createSystemUser({
      role: 'Admin',
      employeeFirstName: seededEmployee.firstName,
      employeeFullName: `${seededEmployee.firstName} ${seededEmployee.lastName}`,
      status: 'Enabled',
      username: creds.username,
      password: creds.password,
    });

    await usersPage.searchByUsername(creds.username);
    await usersPage.expectRowDetails(creds.username, { role: 'Admin', status: 'Enabled' });
  });

  test('TC-USR-002: Create ESS user & verify login in fresh context @functional @e2e', async ({
    browser,
    baseURL,
    usersPage,
    seededEmployee,
    essUserConfig,
    registerDisposableUsername,
  }) => {
    const creds = generateSystemUserCredentials('ess');
    registerDisposableUsername(creds.username);

    await usersPage.gotoUsersList();
    await usersPage.createSystemUser({
      role: 'ESS',
      employeeFirstName: seededEmployee.firstName,
      employeeFullName: `${seededEmployee.firstName} ${seededEmployee.lastName}`,
      status: 'Enabled',
      username: creds.username,
      password: creds.password,
    });

    const essContext = await browser.newContext(baseURL ? { baseURL } : undefined);
    try {
      const essPage = await essContext.newPage();
      const loginPage = new LoginPage(essPage);
      const dashboardPage = new DashboardPage(essPage);

      await loginPage.goto();
      await loginPage.login(creds.username, creds.password);
      await dashboardPage.expectEssViewLoaded(
        essUserConfig.expectedVisibleMenus,
        essUserConfig.expectedHiddenMenus
      );
    } finally {
      await essContext.close().catch(() => undefined);
    }
  });

  test('TC-USR-003: Add User required fields & invalid data validation @negative @regression', async ({
    usersPage,
    seededSystemUser,
  }) => {
    const { userValidation } = loadUsersData();

    await usersPage.gotoAddUser();

    await test.step('Blank Add User submission triggers Required errors', async () => {
      await usersPage.expectRequiredErrorsOnBlankAddUser();
    });

    await test.step('Invalid username and password rules show inline errors', async () => {
      await usersPage.expectInvalidAddUserInputs({
        shortUsername: userValidation.shortUsername,
        duplicateUsername: seededSystemUser.username,
        weakPassword: userValidation.weakPassword,
        validPassword: userValidation.mismatchedPasswordA,
        mismatchedPassword: userValidation.mismatchedPasswordB,
      });
    });
  });

  test('TC-USR-004: Edit user Role, Username & Change Password toggle @functional @e2e', async ({
    browser,
    baseURL,
    usersPage,
    seededSystemUser,
    registerDisposableUsername,
  }) => {
    const { updatedUsername, updatedPassword } = generateSystemUserCredentials('usredit');
    registerDisposableUsername(updatedUsername);

    await usersPage.gotoUsersList();
    await usersPage.openEditUserFromList(seededSystemUser.username);
    await usersPage.editSystemUser({
      role: 'Admin',
      newUsername: updatedUsername,
      newPassword: updatedPassword,
    });

    await usersPage.searchByUsername(updatedUsername);
    await usersPage.expectRowDetails(updatedUsername, { role: 'Admin', status: 'Enabled' });

    const promotedContext = await browser.newContext(baseURL ? { baseURL } : undefined);
    try {
      const promotedPage = await promotedContext.newPage();
      const loginPage = new LoginPage(promotedPage);
      const dashboardPage = new DashboardPage(promotedPage);

      await loginPage.goto();
      await loginPage.login(updatedUsername, updatedPassword);
      await dashboardPage.expectLoaded();
      await dashboardPage.ensureSidebarOpen();
      await expect(promotedPage.getByRole('link', { name: 'Admin', exact: true })).toBeVisible();
    } finally {
      await promotedContext.close().catch(() => undefined);
    }
  });

  test('TC-USR-005: Search user by Username & handle no match @functional @regression', async ({
    usersPage,
    seededSystemUser,
  }) => {
    const { userValidation } = loadUsersData();

    await usersPage.gotoUsersList();

    await test.step('Search exact seeded username returns single matching row', async () => {
      await usersPage.searchByUsername(seededSystemUser.username);
      await expect(usersPage.tableRows).toHaveCount(1);
      await usersPage.expectRowDetails(seededSystemUser.username, {
        role: 'ESS',
        status: 'Enabled',
      });
    });

    await test.step('Search unknown username displays No Records Found', async () => {
      await usersPage.searchByUsername(userValidation.nonExistentUsername);
      await expect(usersPage.tableRows).toHaveCount(0);
      await expect(usersPage.noRecordsBanner.first()).toBeVisible();
    });
  });

  test('TC-USR-006: Filter users by Role, Employee Name, Status & Reset @functional @regression', async ({
    usersPage,
    seededSystemUser,
  }) => {
    await usersPage.gotoUsersList();

    await usersPage.filterUsers({
      role: 'ESS',
      employeeFirstName: seededSystemUser.firstName,
      employeeFullName: `${seededSystemUser.firstName} ${seededSystemUser.lastName}`,
      status: 'Enabled',
    });

    await expect(usersPage.tableRows).toHaveCount(1);
    await usersPage.expectRowDetails(seededSystemUser.username, { role: 'ESS', status: 'Enabled' });

    await usersPage.resetSearchFilters();
    await expect(
      usersPage.inputGroupByLabel('User Role').locator('.oxd-select-text-input')
    ).toHaveText('-- Select --');
    await expect(
      usersPage.inputGroupByLabel('Status').locator('.oxd-select-text-input')
    ).toHaveText('-- Select --');
  });

  test('TC-USR-007: Change status Enabled -> Disabled blocks login @functional @e2e @rbac', async ({
    browser,
    baseURL,
    usersPage,
    seededSystemUser,
  }) => {
    await usersPage.gotoUsersList();
    await usersPage.openEditUserFromList(seededSystemUser.username);
    await usersPage.editSystemUser({ status: 'Disabled' });

    await usersPage.searchByUsername(seededSystemUser.username);
    await usersPage.expectRowDetails(seededSystemUser.username, { status: 'Disabled' });

    const disabledContext = await browser.newContext(baseURL ? { baseURL } : undefined);
    try {
      const page = await disabledContext.newPage();
      const loginPage = new LoginPage(page);

      await loginPage.goto();
      await loginPage.login(seededSystemUser.username, seededSystemUser.password);
      await loginPage.expectAccountDisabledError();
    } finally {
      await disabledContext.close().catch(() => undefined);
    }
  });

  test('TC-USR-008: Delete single/bulk users & protect Admin self-delete @functional @negative', async ({
    browser,
    baseURL,
    adminCredentials,
    usersPage,
    seededSystemUser,
    seededSystemUserPair,
  }) => {
    await usersPage.gotoUsersList();

    await test.step('Active Admin user cannot self-delete', async () => {
      await usersPage.expectAdminSelfDeleteProtected(adminCredentials.username);
    });

    await test.step('Canceling delete keeps record; confirming delete removes single user', async () => {
      await usersPage.resetSearchFilters();
      await usersPage.searchByUsername(seededSystemUser.username);
      await usersPage.cancelDeleteUserRow(seededSystemUser.username);

      await usersPage.deleteUserRow(seededSystemUser.username);
      await expect(usersPage.rowByUsername(seededSystemUser.username)).toHaveCount(0);

      const lookup = await getSystemUserViaApi(
        browser,
        adminCredentials,
        seededSystemUser.username,
        baseURL
      );
      expect(lookup.matches).toHaveLength(0);
    });

    await test.step('Bulk delete removes multiple selected users cleanly', async () => {
      await usersPage.resetSearchFilters();
      await usersPage.filterUsers({
        role: 'ESS',
        employeeFirstName: seededSystemUserPair.employeeFirstName,
        employeeFullName: seededSystemUserPair.employeeFullName,
        status: 'Enabled',
      });

      await expect(usersPage.tableRows).toHaveCount(2);
      await expect(usersPage.rowByUsername(seededSystemUserPair.first.username)).toBeVisible();
      await expect(usersPage.rowByUsername(seededSystemUserPair.second.username)).toBeVisible();

      await usersPage.bulkDeleteUsersByUsernames([
        seededSystemUserPair.first.username,
        seededSystemUserPair.second.username,
      ]);
      await expect(usersPage.rowByUsername(seededSystemUserPair.first.username)).toHaveCount(0);
      await expect(usersPage.rowByUsername(seededSystemUserPair.second.username)).toHaveCount(0);
    });
  });

  test('TC-USR-009: API+UI user parity, visual regression & a11y audit @integration @visual @a11y', async ({
    browser,
    baseURL,
    adminCredentials,
    usersPage,
    seededSystemUser,
  }, testInfo) => {
    const page = usersPage.page;
    const knownAdminA11yRules = ['button-name', 'color-contrast', 'html-has-lang', 'label', 'list'];

    await test.step('Verify API GET /admin/users matches UI row data', async () => {
      const apiLookup = await getSystemUserViaApi(
        browser,
        adminCredentials,
        seededSystemUser.username,
        baseURL
      );
      expect(apiLookup.total).toBe(1);
      expect(apiLookup.matches[0]?.userName).toBe(seededSystemUser.username);

      await usersPage.gotoUsersList();
      await usersPage.searchByUsername(seededSystemUser.username);
      await expect(usersPage.tableRows).toHaveCount(apiLookup.total);
      await usersPage.expectRowDetails(seededSystemUser.username, {
        role: (apiLookup.matches[0]?.userRole?.name as 'Admin' | 'ESS') ?? 'ESS',
        status: apiLookup.matches[0]?.status ? 'Enabled' : 'Disabled',
      });
    });

    await test.step('Capture deterministic System Users visual baseline & WCAG audit', async () => {
      const usersListPattern = '**/api/v2/admin/users?*';
      await page.route(usersListPattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 1,
                userName: 'Admin',
                deleted: false,
                status: true,
                employee: {
                  empNumber: 7,
                  employeeId: '0001',
                  firstName: 'Demo',
                  middleName: '',
                  lastName: 'Admin',
                  terminationId: null,
                },
                userRole: { id: 1, name: 'Admin', displayName: 'Admin' },
              },
            ],
            meta: { total: 1 },
            rels: [],
          }),
        });
      });

      try {
        await usersPage.gotoUsersList();
        await usersPage.waitForVisualStability();
        await expect(page).toHaveScreenshot('users-list-default.png', {
          mask: usersPage.getVisualMasks(),
        });
        await runA11yAudit(page, testInfo, { knownBaselineRuleIds: knownAdminA11yRules });
      } finally {
        if (!page.isClosed()) {
          await page.unroute(usersListPattern);
        }
      }
    });

    await test.step('Capture Add User visual baseline & WCAG audit', async () => {
      await usersPage.gotoAddUser();
      await usersPage.waitForVisualStability();
      await expect(page).toHaveScreenshot('add-user-default.png', {
        mask: usersPage.getVisualMasks(),
      });
      await runA11yAudit(page, testInfo, { knownBaselineRuleIds: knownAdminA11yRules });
    });
  });
});
