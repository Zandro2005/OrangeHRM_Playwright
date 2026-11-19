import { expect, test } from '../fixtures/adminFixture';
import { DashboardPage } from '../pages/DashboardPage';
import { EmployeePage } from '../pages/EmployeePage';
import { LoginPage } from '../pages/LoginPage';
import { runA11yAudit } from '../utils/accessibility';
import { loadEmployeesTestData } from '../utils/testDataGenerator';

test.describe('Module 6: Roles & Permissions (RBAC)', () => {
  test('TC-ROLE-001: Admin role sees full sidebar & performs full CRUD @rbac @smoke', async ({
    adminCredentials,
    usersPage,
    employeePage,
    seededEmployee,
  }) => {
    const adminDashboard = new DashboardPage(usersPage.page);

    await test.step('Admin sidebar displays all privileged modules', async () => {
      await usersPage.gotoUsersList();
      await adminDashboard.expectAdminSidebarModulesVisible([
        'Admin',
        'PIM',
        'Maintenance',
        'Leave',
        'Time',
      ]);
    });

    await test.step('Admin Users page exposes Add, Edit, and Delete controls', async () => {
      await expect(usersPage.addButton).toBeVisible();
      await expect(usersPage.addButton).toBeEnabled();

      await usersPage.searchByUsername(adminCredentials.username);
      const adminRow = usersPage.rowByUsername(adminCredentials.username);
      await expect(adminRow).toBeVisible();

      const editBtn = adminRow.locator('button:has(.bi-pencil-fill)');
      const deleteBtn = adminRow.locator('button:has(.bi-trash)');
      await expect(editBtn).toBeVisible();
      await expect(editBtn).toBeEnabled();
      await expect(deleteBtn).toBeVisible();
      await expect(deleteBtn).toBeEnabled();
    });

    await test.step('PIM Employee List exposes Add, Edit, and Delete controls', async () => {
      await employeePage.gotoEmployeeList();
      const addEmployeeBtn = employeePage.page.getByRole('button', { name: 'Add' });
      await expect(addEmployeeBtn).toBeVisible();
      await expect(addEmployeeBtn).toBeEnabled();

      await employeePage.searchByEmployeeId(seededEmployee.employeeId);
      const empRow = employeePage.rowByEmployeeId(seededEmployee.employeeId);
      await expect(empRow).toBeVisible();

      const editBtn = empRow.locator('button:has(.bi-pencil-fill)');
      const deleteBtn = empRow.locator('button:has(.bi-trash)');
      await expect(editBtn).toBeVisible();
      await expect(editBtn).toBeEnabled();
      await expect(deleteBtn).toBeVisible();
      await expect(deleteBtn).toBeEnabled();
    });
  });

  test('TC-ROLE-002: ESS user sidebar hides Admin & Maintenance; My Info works @rbac @regression', async ({
    authenticatedEssPage,
    essUserConfig,
    seededSystemUser,
  }) => {
    const essDashboard = new DashboardPage(authenticatedEssPage);
    const essEmployeePage = new EmployeePage(authenticatedEssPage);
    const testData = loadEmployeesTestData();
    const workEmail = `${testData.contactDetailsUpdate.workEmailPrefix}.${seededSystemUser.employeeId.toLowerCase()}@example.com`;

    await test.step('ESS sidebar hides Admin, Maintenance, and PIM while keeping self-service menus', async () => {
      await essDashboard.expectEssViewLoaded(essUserConfig.expectedVisibleMenus, [
        ...essUserConfig.expectedHiddenMenus,
        'PIM',
      ]);
    });

    await test.step('ESS user updates permitted Contact Details in My Info and persists across reload', async () => {
      await essDashboard.navigateViaSidebar('My Info', /\/pim\/viewPersonalDetails/);
      await essEmployeePage.waitForSpinnerToClear();
      await essEmployeePage.openProfileTab('Contact Details');

      await essEmployeePage.updateContactDetails({
        street1: testData.contactDetailsUpdate.street1,
        city: testData.contactDetailsUpdate.city,
        workEmail,
      });

      await authenticatedEssPage.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
      await essEmployeePage.expectContactDetailsValues({
        street1: testData.contactDetailsUpdate.street1,
        city: testData.contactDetailsUpdate.city,
        workEmail,
      });
    });
  });

  test('TC-ROLE-003: ESS user restricted from User Config & Job/Salary edits @rbac @negative', async ({
    authenticatedEssPage,
  }) => {
    const essDashboard = new DashboardPage(authenticatedEssPage);
    const essEmployeePage = new EmployeePage(authenticatedEssPage);

    await test.step('No Admin sidebar or User Management / Configuration topbar menus exist', async () => {
      await essDashboard.ensureSidebarOpen();
      await expect(authenticatedEssPage.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
      await expect(
        authenticatedEssPage.getByRole('link', { name: 'Maintenance', exact: true })
      ).toHaveCount(0);
      await expect(
        authenticatedEssPage.locator('.oxd-topbar-body-nav-tab', {
          hasText: /User Management|Configuration/i,
        })
      ).toHaveCount(0);
    });

    await test.step('My Info Job and Salary tabs are read-only for ESS users', async () => {
      await essDashboard.navigateViaSidebar('My Info', /\/pim\/viewPersonalDetails/);
      await essEmployeePage.waitForSpinnerToClear();
      await expect(
        authenticatedEssPage.locator('.oxd-topbar-body-nav-tab', {
          hasText: /User Management|Configuration/i,
        })
      ).toHaveCount(0);

      await essEmployeePage.expectJobTabReadOnlyForEss();
      await essEmployeePage.expectSalaryTabReadOnlyForEss();
    });
  });

  test('TC-ROLE-004: Direct URL access to Admin/PIM/Maintenance blocked for ESS @rbac @negative', async ({
    authenticatedEssPage,
  }) => {
    const essDashboard = new DashboardPage(authenticatedEssPage);
    const privilegedRoutes = [
      '/web/index.php/admin/viewSystemUsers',
      '/web/index.php/pim/addEmployee',
      '/web/index.php/maintenance/purgeEmployee',
    ];

    for (const route of privilegedRoutes) {
      await test.step(`Verify direct access to ${route} is blocked`, async () => {
        await essDashboard.expectPrivilegedRouteBlocked(route);
      });
    }
  });

  test('TC-ROLE-005: ESS API calls to Admin endpoints return HTTP 401/403 @rbac @integration', async ({
    authenticatedEssPage,
    seededSystemUser,
  }) => {
    const essRequest = authenticatedEssPage.context().request;

    await test.step('GET /api/v2/admin/users with ESS session cookies is rejected (401/403)', async () => {
      const getRes = await essRequest.get('/web/index.php/api/v2/admin/users', { timeout: 25_000 });
      expect([401, 403], `Expected 401/403 for ESS GET /admin/users, got ${getRes.status()}`).toContain(
        getRes.status()
      );
    });

    await test.step('POST /api/v2/admin/users with ESS session cookies is rejected (401/403)', async () => {
      const postRes = await essRequest.post('/web/index.php/api/v2/admin/users', {
        timeout: 25_000,
        data: {
          username: `rbac_probe_${seededSystemUser.employeeId.toLowerCase()}`,
          password: seededSystemUser.password,
          status: true,
          userRoleId: 1,
          empNumber: seededSystemUser.empNumber,
        },
      });
      expect(
        [401, 403],
        `Expected 401/403 for ESS POST /admin/users, got ${postRes.status()}`
      ).toContain(postRes.status());
    });
  });

  test('TC-ROLE-006: Dual-context isolation & dynamic Role promotion/demotion @integration @e2e @rbac', async ({
    browser,
    baseURL,
    usersPage,
    authenticatedEssPage,
    seededSystemUser,
    essUserConfig,
  }) => {
    test.slow();
    const adminDashboard = new DashboardPage(usersPage.page);
    const essDashboard = new DashboardPage(authenticatedEssPage);

    await test.step('Admin and ESS contexts maintain isolated sessions with zero cookie bleed', async () => {
      await usersPage.gotoUsersList();
      await adminDashboard.expectAdminSidebarModulesVisible(['Admin', 'PIM']);
      await essDashboard.expectEssViewLoaded(
        essUserConfig.expectedVisibleMenus,
        essUserConfig.expectedHiddenMenus
      );

      const adminCookies = await usersPage.page.context().cookies();
      const essCookies = await authenticatedEssPage.context().cookies();
      const adminSession = adminCookies.find((c) => c.name === 'orangehrm')?.value;
      const essSession = essCookies.find((c) => c.name === 'orangehrm')?.value;

      expect(adminSession).toBeTruthy();
      expect(essSession).toBeTruthy();
      expect(adminSession).not.toBe(essSession);
    });

    await test.step('Promoting ESS -> Admin grants Admin & PIM access on fresh login', async () => {
      await usersPage.openEditUserFromList(seededSystemUser.username);
      await usersPage.editSystemUser({ role: 'Admin' });

      const promotedContext = await browser.newContext(baseURL ? { baseURL } : undefined);
      try {
        const promotedPage = await promotedContext.newPage();
        const loginPage = new LoginPage(promotedPage);
        const promotedDashboard = new DashboardPage(promotedPage);

        await loginPage.goto();
        await loginPage.login(seededSystemUser.username, seededSystemUser.password);
        await promotedDashboard.expectLoaded();
        await promotedDashboard.expectAdminSidebarModulesVisible(['Admin', 'PIM']);
      } finally {
        await promotedContext.close().catch(() => undefined);
      }
    });

    await test.step('Demoting Admin -> ESS revokes Admin & Maintenance access on fresh login', async () => {
      await usersPage.openEditUserFromList(seededSystemUser.username);
      await usersPage.editSystemUser({ role: 'ESS' });

      const demotedContext = await browser.newContext(baseURL ? { baseURL } : undefined);
      try {
        const demotedPage = await demotedContext.newPage();
        const loginPage = new LoginPage(demotedPage);
        const demotedDashboard = new DashboardPage(demotedPage);

        await loginPage.goto();
        await loginPage.login(seededSystemUser.username, seededSystemUser.password);
        await demotedDashboard.expectEssViewLoaded(
          essUserConfig.expectedVisibleMenus,
          essUserConfig.expectedHiddenMenus
        );
      } finally {
        await demotedContext.close().catch(() => undefined);
      }
    });
  });

  test('TC-ROLE-007: ESS vs Admin UI visual diff & ESS accessibility audit @visual @a11y @rbac', async ({
    authenticatedEssPage,
  }, testInfo) => {
    const essDashboard = new DashboardPage(authenticatedEssPage);
    const essEmployeePage = new EmployeePage(authenticatedEssPage);
    const knownEssA11yRules = [
      'button-name',
      'color-contrast',
      'html-has-lang',
      'label',
      'list',
      'nested-interactive',
    ];

    await test.step('Capture deterministic ESS sidebar visual baseline', async () => {
      await essDashboard.waitForSidebarVisualStability();
      await expect(essDashboard.sidepanel).toHaveScreenshot('ess-sidebar-default.png', {
        mask: [
          authenticatedEssPage.locator('.oxd-brand-logo'),
          authenticatedEssPage.locator('.oxd-brand-banner'),
        ],
      });
    });

    await test.step('Run WCAG 2.1 AA accessibility audit on ESS My Info view', async () => {
      await essDashboard.navigateViaSidebar('My Info', /\/pim\/viewPersonalDetails/);
      await essEmployeePage.waitForSpinnerToClear();
      await essEmployeePage.waitForVisualStability();
      await runA11yAudit(authenticatedEssPage, testInfo, {
        knownBaselineRuleIds: knownEssA11yRules,
      });
    });
  });
});
