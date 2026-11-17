import { expect, test } from '../fixtures/adminFixture';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { runA11yAudit } from '../utils/accessibility';
import { verifyEmployeeDeletedViaApi } from '../utils/apiHelpers';
import {
  generateEmployeeData,
  generateEmployeeWithLogin,
  loadEmployeesTestData,
} from '../utils/testDataGenerator';

test.describe('Module 3: Employee Management (PIM)', () => {
  test('TC-EMP-001: Add employee with mandatory fields & API cleanup @functional @e2e @smoke', async ({
    employeePage,
    registerDisposableEmployee,
  }) => {
    const newEmployee = generateEmployeeData('Emp01');

    await employeePage.gotoAddEmployee();
    await employeePage.fillAddEmployeeMandatory(newEmployee);
    const empNumber = await employeePage.submitAddEmployeeAndCaptureEmpNumber();
    registerDisposableEmployee(empNumber);

    await employeePage.expectPersonalDetailsValues({
      firstName: newEmployee.firstName,
      lastName: newEmployee.lastName,
      employeeId: newEmployee.employeeId,
    });
  });

  test('TC-EMP-002: Add employee with Create Login Details enabled @functional @e2e', async ({
    browser,
    baseURL,
    employeePage,
    registerDisposableEmployee,
  }) => {
    const newAccount = generateEmployeeWithLogin('Emp02');

    await employeePage.gotoAddEmployee();
    await employeePage.fillAddEmployeeMandatory(newAccount);
    await employeePage.enableCreateLoginDetailsAndFill(newAccount.username, newAccount.password);

    const empNumber = await employeePage.submitAddEmployeeAndCaptureEmpNumber();
    registerDisposableEmployee(empNumber);

    // Sign in with the newly provisioned employee credentials inside a clean browser context
    const essContext = await browser.newContext(baseURL ? { baseURL } : undefined);
    try {
      const essPage = await essContext.newPage();
      const loginPage = new LoginPage(essPage);
      const dashboardPage = new DashboardPage(essPage);

      await loginPage.goto();
      await loginPage.login(newAccount.username, newAccount.password);
      await dashboardPage.expectLoaded();
    } finally {
      await essContext.close().catch(() => undefined);
    }
  });

  test('TC-EMP-003: Add employee required fields validation @negative @regression', async ({
    employeePage,
  }) => {
    await employeePage.gotoAddEmployee();
    await employeePage.expectRequiredErrorsOnAddEmployee();
  });

  test('TC-EMP-004: Invalid employee data: duplicate ID, passwords & photo @negative @regression', async ({
    employeePage,
    seededEmployee,
  }) => {
    const testData = loadEmployeesTestData();

    await employeePage.gotoAddEmployee();

    await test.step('Duplicate Employee Id shows inline uniqueness error', async () => {
      await employeePage.expectDuplicateEmployeeIdError(seededEmployee.employeeId);
    });

    await test.step('Mismatched password confirmation shows inline mismatch error', async () => {
      await employeePage.expectMismatchedPasswordError(
        testData.invalidData.mismatchedPasswordA,
        testData.invalidData.mismatchedPasswordB
      );
    });

    await test.step('Invalid file type & >1MB photo uploads are rejected', async () => {
      await employeePage.uploadPhotoAndExpectError(
        {
          name: testData.invalidData.invalidFileName,
          mimeType: testData.invalidData.invalidFileMime,
          buffer: Buffer.from('not-an-image'),
        },
        /File type not allowed/i
      );

      await employeePage.uploadPhotoAndExpectError(
        {
          name: testData.invalidData.oversizedFileName,
          mimeType: 'image/png',
          buffer: Buffer.alloc(testData.invalidData.oversizedFileBytes, 1),
        },
        /Attachment Size Exceeded/i
      );
    });
  });

  test('TC-EMP-005: Edit employee Personal, Contact & Job Details @functional @e2e', async ({
    employeePage,
    seededEmployee,
  }) => {
    const testData = loadEmployeesTestData();
    const workEmail = `${testData.contactDetailsUpdate.workEmailPrefix}.${seededEmployee.employeeId.toLowerCase()}@example.com`;

    await employeePage.gotoPersonalDetails(seededEmployee.empNumber);

    await test.step('Edit Personal Details and verify persistence across reload', async () => {
      await employeePage.updatePersonalDetails({
        middleName: testData.personalDetailsUpdate.middleName,
        licenseNumber: testData.personalDetailsUpdate.licenseNumber,
        dateOfBirth: testData.personalDetailsUpdate.dateOfBirth,
      });

      await employeePage.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
      await employeePage.expectPersonalDetailsValues({
        firstName: seededEmployee.firstName,
        lastName: seededEmployee.lastName,
        employeeId: seededEmployee.employeeId,
        middleName: testData.personalDetailsUpdate.middleName,
        licenseNumber: testData.personalDetailsUpdate.licenseNumber,
        dateOfBirth: testData.personalDetailsUpdate.dateOfBirth,
      });
    });

    await test.step('Edit Contact Details and verify persistence across reload', async () => {
      await employeePage.openProfileTab('Contact Details');
      await employeePage.updateContactDetails({
        street1: testData.contactDetailsUpdate.street1,
        city: testData.contactDetailsUpdate.city,
        workEmail,
      });

      await employeePage.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
      await employeePage.expectContactDetailsValues({
        street1: testData.contactDetailsUpdate.street1,
        city: testData.contactDetailsUpdate.city,
        workEmail,
      });
    });

    await test.step('Edit Job Details and verify persistence across reload', async () => {
      await employeePage.openProfileTab('Job');
      const selectedJob = await employeePage.updateJobDetails();

      await employeePage.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
      await employeePage.expectJobDetailsValues(selectedJob);
    });
  });

  test('TC-EMP-006: Search employee by Name autocomplete & Employee ID @functional @regression', async ({
    employeePage,
    seededEmployee,
  }) => {
    const testData = loadEmployeesTestData();

    await employeePage.gotoEmployeeList();

    await test.step('Search via Employee Name autocomplete returns exact seeded record', async () => {
      await employeePage.searchByEmployeeNameAutocomplete(
        seededEmployee.firstName,
        `${seededEmployee.firstName} ${seededEmployee.lastName}`
      );
      await expect(employeePage.rowByEmployeeId(seededEmployee.employeeId)).toBeVisible();
    });

    await test.step('Search via valid Employee Id returns matching record', async () => {
      await employeePage.resetSearchFilters();
      await employeePage.searchByEmployeeId(seededEmployee.employeeId);
      await expect(employeePage.tableRows).toHaveCount(1);
      await expect(employeePage.rowByEmployeeId(seededEmployee.employeeId)).toBeVisible();
    });

    await test.step('Search via non-existent Employee Id displays No Records Found', async () => {
      await employeePage.searchByEmployeeId(testData.nonExistentEmployeeId);
      await expect(employeePage.tableRows).toHaveCount(0);
      await expect(employeePage.noRecordsBanner.first()).toBeVisible();
    });
  });

  test('TC-EMP-007: Filter employee list by Status, Job Title, Sub Unit & Reset @functional @regression', async ({
    employeePage,
    seededEmployeeWithJob,
  }) => {
    await employeePage.gotoEmployeeList();

    await employeePage.filterByDropdownsAndReset({
      empStatus: seededEmployeeWithJob.empStatus,
      jobTitle: seededEmployeeWithJob.jobTitle,
      subunit: seededEmployeeWithJob.subunit,
    });

    await expect(employeePage.rowByEmployeeId(seededEmployeeWithJob.employeeId)).toBeVisible();

    await employeePage.resetSearchFilters();
    await expect(
      employeePage.inputGroupByLabel('Employment Status').locator('.oxd-select-text-input')
    ).toHaveText('-- Select --');
    await expect(
      employeePage.inputGroupByLabel('Job Title').locator('.oxd-select-text-input')
    ).toHaveText('-- Select --');
    await expect(
      employeePage.inputGroupByLabel('Sub Unit').locator('.oxd-select-text-input')
    ).toHaveText('-- Select --');
  });

  test('TC-EMP-008: View employee profile details & verify accuracy @functional @e2e', async ({
    employeePage,
    seededEmployeeWithJob,
  }) => {
    await employeePage.gotoEmployeeList();
    await employeePage.openEmployeeFromList(seededEmployeeWithJob.employeeId);

    await employeePage.expectPersonalDetailsValues({
      firstName: seededEmployeeWithJob.firstName,
      lastName: seededEmployeeWithJob.lastName,
      employeeId: seededEmployeeWithJob.employeeId,
    });

    await employeePage.openProfileTab('Job');
    await employeePage.expectJobDetailsValues({
      jobTitle: seededEmployeeWithJob.jobTitle,
      employmentStatus: seededEmployeeWithJob.empStatus,
      subunit: seededEmployeeWithJob.subunit,
    });
  });

  test('TC-EMP-009: Delete single employee & verify UI + API removal @functional @e2e', async ({
    browser,
    baseURL,
    adminCredentials,
    employeePage,
    seededEmployee,
  }) => {
    await employeePage.gotoEmployeeList();
    await employeePage.searchByEmployeeId(seededEmployee.employeeId);
    await employeePage.deleteEmployeeRow(seededEmployee.employeeId);

    await expect(employeePage.rowByEmployeeId(seededEmployee.employeeId)).toHaveCount(0);

    const deletedInApi = await verifyEmployeeDeletedViaApi(
      browser,
      adminCredentials,
      seededEmployee.empNumber,
      baseURL
    );
    expect(deletedInApi, 'Deleted employee should no longer exist in GET API').toBe(true);
  });

  test('TC-EMP-010: Cancel delete modal & bulk delete multiple employees @functional @negative', async ({
    employeePage,
    seededEmployeePair,
  }) => {
    await employeePage.gotoEmployeeList();
    await employeePage.searchByEmployeeNameText(seededEmployeePair.batchTag);

    await expect(employeePage.rowByEmployeeId(seededEmployeePair.first.employeeId)).toBeVisible();
    await expect(employeePage.rowByEmployeeId(seededEmployeePair.second.employeeId)).toBeVisible();

    await test.step('Canceling confirmation modal preserves employee record', async () => {
      await employeePage.cancelDeleteEmployeeRow(seededEmployeePair.first.employeeId);
    });

    await test.step('Bulk delete removes all selected employees', async () => {
      await employeePage.bulkDeleteEmployeesByIds([
        seededEmployeePair.first.employeeId,
        seededEmployeePair.second.employeeId,
      ]);
      await expect(employeePage.rowByEmployeeId(seededEmployeePair.first.employeeId)).toHaveCount(
        0
      );
      await expect(employeePage.rowByEmployeeId(seededEmployeePair.second.employeeId)).toHaveCount(
        0
      );
    });
  });

  test('TC-EMP-011: API+UI HTTP 500 mock, visual regression & a11y audit @integration @visual @a11y', async ({
    employeePage,
    seededEmployee,
  }, testInfo) => {
    const page = employeePage.page;
    const knownPimA11yRules = ['button-name', 'color-contrast', 'html-has-lang', 'label', 'list'];

    await test.step('Mock PUT personal-details HTTP 500 and verify graceful error handling', async () => {
      const testData = loadEmployeesTestData();
      const personalDetailsApiPattern = '**/api/v2/pim/employees/*/personal-details';

      await employeePage.gotoPersonalDetails(seededEmployee.empNumber);
      await page.route(personalDetailsApiPattern, async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { status: '500', message: 'Internal Server Error' } }),
          });
          return;
        }
        await route.continue();
      });

      try {
        await employeePage.middleNameInput.fill(testData.personalDetailsUpdate.middleName);
        await page.locator('form.oxd-form').first().locator('button[type="submit"]').click();
        await expect(employeePage.firstNameInput).toBeVisible();
        await expect(page.locator('.oxd-toast--success')).toHaveCount(0);
      } finally {
        if (!page.isClosed()) {
          await page.unroute(personalDetailsApiPattern);
        }
      }
    });

    await test.step('Capture deterministic Employee List visual baseline & WCAG audit', async () => {
      const employeesListPattern = '**/api/v2/pim/employees?*';
      await page.route(employeesListPattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                empNumber: 1,
                lastName: 'Employee',
                firstName: 'Demo',
                middleName: '',
                employeeId: '0001',
                terminationId: null,
                jobTitle: { id: null, title: null, isDeleted: false },
                subunit: { id: null, name: null },
                empStatus: { id: null, name: null },
                supervisors: [],
              },
            ],
            meta: { total: 1 },
            rels: [],
          }),
        });
      });

      try {
        await employeePage.gotoEmployeeList();
        await employeePage.waitForVisualStability();
        await expect(page).toHaveScreenshot('employee-list-default.png', {
          mask: employeePage.getVisualMasks(),
        });
        await runA11yAudit(page, testInfo, { knownBaselineRuleIds: knownPimA11yRules });
      } finally {
        if (!page.isClosed()) {
          await page.unroute(employeesListPattern);
        }
      }
    });

    await test.step('Capture Add Employee visual baseline & WCAG audit', async () => {
      await employeePage.gotoAddEmployee();
      await employeePage.waitForVisualStability();
      await expect(page).toHaveScreenshot('add-employee-default.png', {
        mask: [
          ...employeePage.getVisualMasks(),
          employeePage.inputGroupByLabel('Employee Id').locator('input'),
        ],
      });
      await runA11yAudit(page, testInfo, { knownBaselineRuleIds: knownPimA11yRules });
    });
  });
});
