import { expect, test } from '../fixtures/adminFixture';
import { runA11yAudit } from '../utils/accessibility';
import { seedDefinedReport, verifyDefinedReportDeletedViaApi } from '../utils/apiHelpers';
import { generateReportName } from '../utils/testDataGenerator';

test.describe('Module 5: Reports (PIM)', () => {
  test('TC-RPT-001: Open PIM Reports page & verify table loads @functional @smoke', async ({
    reportsPage,
    telemetry,
  }) => {
    await reportsPage.gotoDashboard();
    await reportsPage.navigateViaPimReportsMenu();

    await expect(reportsPage.reportsHeading).toBeVisible();
    await expect(reportsPage.addButton).toBeVisible();
    await reportsPage.ensureFilterExpanded();
    await expect(
      reportsPage.inputGroupByLabel('Report Name', reportsPage.filterSection).locator('input')
    ).toBeVisible();
    await expect(reportsPage.searchButton).toBeVisible();
    await expect(reportsPage.resetButton).toBeVisible();

    await expect
      .poll(async () => reportsPage.tableRows.count(), { timeout: 20_000 })
      .toBeGreaterThan(0);

    expect(telemetry.consoleErrors, 'Unexpected console errors on PIM Reports page').toEqual([]);
    expect(telemetry.serverErrors, 'Unexpected HTTP 5xx errors on PIM Reports page').toEqual([]);
  });

  test('TC-RPT-002: Search reports by Name autocomplete & Reset @functional @negative', async ({
    reportsPage,
    seededReport,
  }) => {
    await reportsPage.gotoReportsList();

    await test.step('Search existing report via autocomplete filters to matching row', async () => {
      await reportsPage.searchReportByNameAutocomplete(seededReport.name, seededReport.name);
      await expect(reportsPage.tableRows).toHaveCount(1);
      await expect(reportsPage.rowByReportName(seededReport.name)).toBeVisible();
    });

    await test.step('Non-existent report shows No Records Found in autocomplete & Reset restores list', async () => {
      await reportsPage.expectInvalidReportSearchBehavior('NoSuchReportXYZ999');

      await reportsPage.resetSearchFilters();
      const reportNameInput = reportsPage
        .inputGroupByLabel('Report Name', reportsPage.filterSection)
        .locator('input');
      await expect(reportNameInput).toHaveValue('');
      await expect(
        reportsPage
          .inputGroupByLabel('Report Name', reportsPage.filterSection)
          .locator('.oxd-input-field-error-message')
      ).toHaveCount(0);
      await expect
        .poll(async () => reportsPage.tableRows.count(), { timeout: 20_000 })
        .toBeGreaterThan(0);
    });
  });

  test('TC-RPT-003: Create custom Report & validate required fields @functional @negative', async ({
    reportsPage,
    registerDisposableReportId,
    registerDisposableReportName,
  }) => {
    const customReportName = generateReportName('CustomRpt');
    registerDisposableReportName(customReportName);

    await reportsPage.gotoReportsList();
    await reportsPage.openAddReportFromList();

    await test.step('Blank submission blocks save with Required error & missing Display Fields warns', async () => {
      await reportsPage.expectRequiredErrorOnBlankSave();
      await reportsPage.fillReportName(customReportName);
      await reportsPage.expectMissingDisplayFieldsWarning();
    });

    await test.step('Valid Report Name, Selection Criteria & Display Fields save cleanly', async () => {
      await reportsPage.addSelectionCriterion('Employment Status');
      await reportsPage.addDisplayField('Personal', 'Employee Id');
      await reportsPage.addDisplayField('Personal', 'Employee First Name');
      await reportsPage.addDisplayField('Personal', 'Employee Last Name');

      const reportId = await reportsPage.saveReportAndCaptureId();
      registerDisposableReportId(reportId);

      await expect(reportsPage.reportTitleHeading).toHaveText(customReportName);

      await reportsPage.gotoReportsList();
      await reportsPage.searchReportByNameAutocomplete(customReportName, customReportName);
      await expect(reportsPage.rowByReportName(customReportName)).toBeVisible();
    });
  });

  test('TC-RPT-004: Configure multi-criteria filters & edit existing report @functional @regression', async ({
    reportsPage,
    seededReport,
  }) => {
    await reportsPage.gotoReportsList();
    await reportsPage.openEditReportFromList(seededReport.name);

    let chosenJobTitle = '';
    let chosenSubUnit = '';
    let chosenLocation = '';

    await test.step('Add Job Title, Sub Unit & Location criteria and save', async () => {
      chosenJobTitle = await reportsPage.addSelectionCriterion('Job Title');
      chosenSubUnit = await reportsPage.addSelectionCriterion('Sub Unit');
      chosenLocation = await reportsPage.addSelectionCriterion('Location');

      await reportsPage.saveReportAndCaptureId();
    });

    await test.step('Reopen in Edit mode, verify criteria persisted, and add/remove a Display Field', async () => {
      await reportsPage.gotoEditReport(seededReport.id);

      await reportsPage.expectCriterionPersisted('Job Title', chosenJobTitle);
      await reportsPage.expectCriterionPersisted('Sub Unit', chosenSubUnit);
      await reportsPage.expectCriterionPersisted('Location', chosenLocation);

      await reportsPage.addDisplayField('Personal', 'Employee Middle Name');
      await reportsPage.removeDisplayFieldChip('Employee Last Name');
      await reportsPage.saveReportAndCaptureId();
    });

    await test.step('Reopen in Edit mode again to verify all criteria & updated columns persisted', async () => {
      await reportsPage.gotoEditReport(seededReport.id);

      await reportsPage.expectCriterionPersisted('Job Title', chosenJobTitle);
      await reportsPage.expectCriterionPersisted('Sub Unit', chosenSubUnit);
      await reportsPage.expectCriterionPersisted('Location', chosenLocation);

      await reportsPage.expectDisplayFieldChipVisible('Employee Id');
      await reportsPage.expectDisplayFieldChipVisible('Employee First Name');
      await reportsPage.expectDisplayFieldChipVisible('Employee Middle Name');
      await reportsPage.expectDisplayFieldChipAbsent('Employee Last Name');
    });
  });

  test('TC-RPT-005: Generate report & verify results match seeded employee @functional @e2e @integration', async ({
    browser,
    baseURL,
    adminCredentials,
    reportsPage,
    seededEmployeeWithJob,
  }) => {
    // Seed a custom report filtered to our API-seeded employee with Personal + Job display fields
    const seededReport = await seedDefinedReport(browser, adminCredentials, baseURL, {
      name: generateReportName('GenRpt'),
      include: 'onlyCurrent',
      criteria: {
        '8': {
          operator: 'eq',
          x: String(seededEmployeeWithJob.empNumber),
          y: 'undefined',
        },
      },
      fieldGroup: {
        '1': { fields: [9, 11, 10], includeHeader: false },
        '6': { fields: [77, 82], includeHeader: false },
      },
    });

    try {
      await reportsPage.gotoReportsList();
      await reportsPage.runReportFromList(seededReport.name);

      const expectedCells = [
        seededEmployeeWithJob.employeeId,
        seededEmployeeWithJob.firstName,
        seededEmployeeWithJob.lastName,
        ...(seededEmployeeWithJob.jobTitle ? [seededEmployeeWithJob.jobTitle] : []),
        ...(seededEmployeeWithJob.subunit ? [seededEmployeeWithJob.subunit] : []),
      ];

      await reportsPage.expectGeneratedReportContent({
        title: seededReport.name,
        headers: [
          'Employee Id',
          'Employee First Name',
          'Employee Last Name',
          'Job Title',
          'Sub Unit',
        ],
        cellTexts: expectedCells,
      });
    } finally {
      await seededReport.cleanup();
    }
  });

  test('TC-RPT-006: Zero-match report empty state & delete custom report @functional @negative', async ({
    browser,
    baseURL,
    adminCredentials,
    reportsPage,
    seededEmployee,
  }) => {
    // Filter for "Past Employees Only" on our freshly seeded active employee -> guaranteed 0 matches
    const zeroMatchReport = await seedDefinedReport(browser, adminCredentials, baseURL, {
      name: generateReportName('ZeroRpt'),
      include: 'onlyPast',
      criteria: {
        '8': {
          operator: 'eq',
          x: String(seededEmployee.empNumber),
          y: 'undefined',
        },
      },
      fieldGroup: {
        '1': { fields: [9, 11, 10], includeHeader: false },
      },
    });

    try {
      await test.step('Run zero-match report and verify No Records Found empty state', async () => {
        await reportsPage.gotoReportsList();
        await reportsPage.runReportFromList(zeroMatchReport.name);
        await expect(reportsPage.reportTitleHeading).toHaveText(zeroMatchReport.name);
        await reportsPage.expectReportEmptyState();
      });

      await test.step('Delete custom report via confirmation modal and verify UI + API removal', async () => {
        await reportsPage.gotoReportsList();
        await reportsPage.searchReportByNameAutocomplete(
          zeroMatchReport.name,
          zeroMatchReport.name
        );
        await reportsPage.deleteReportRow(zeroMatchReport.name);
        await expect(reportsPage.rowByReportName(zeroMatchReport.name)).toHaveCount(0);

        const deletedInApi = await verifyDefinedReportDeletedViaApi(
          browser,
          adminCredentials,
          zeroMatchReport.id,
          baseURL
        );
        expect(deletedInApi, 'Deleted report should no longer exist in GET API').toBe(true);
      });
    } finally {
      await zeroMatchReport.cleanup();
    }
  });

  test('TC-RPT-007: API mocking simulates report payload & HTTP 500 error @integration @negative', async ({
    reportsPage,
    seededReport,
  }) => {
    const page = reportsPage.page;
    const reportMetaPattern = '**/api/v2/pim/reports?name=pim_defined*';
    const reportDataPattern = '**/api/v2/pim/reports/data?*';

    const mockedHeadersPayload = {
      data: {
        headers: [
          { name: 'Employee Id', prop: 'employeeId', size: 200, pin: null, cellProperties: null },
          {
            name: 'Employee First Name',
            prop: 'employeeFirstname',
            size: 200,
            pin: null,
            cellProperties: null,
          },
          {
            name: 'Employee Last Name',
            prop: 'employeeLastname',
            size: 200,
            pin: null,
            cellProperties: null,
          },
          { name: 'Job Title', prop: 'empJobTitle', size: 200, pin: null, cellProperties: null },
        ],
        filters: [],
      },
      meta: {
        headers: {
          name: seededReport.name,
          columnCount: 4,
          groupCount: 0,
          groupedColumnCount: 0,
        },
        filters: null,
      },
      rels: [],
    };

    await test.step('Intercept report data endpoint with mocked JSON rows and verify display', async () => {
      await page.route(reportMetaPattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockedHeadersPayload),
        });
      });

      await page.route(reportDataPattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                empNumber: 9001,
                employeeId: 'MOCK-101',
                employeeFirstname: 'Ada',
                employeeLastname: 'Lovelace',
                empJobTitle: 'Principal QA Engineer',
              },
              {
                empNumber: 9002,
                employeeId: 'MOCK-102',
                employeeFirstname: 'Grace',
                employeeLastname: 'Hopper',
                empJobTitle: 'Automation Lead',
              },
            ],
            meta: { total: 2 },
            rels: [],
          }),
        });
      });

      try {
        await reportsPage.gotoDisplayReport(seededReport.id);
        await reportsPage.expectGeneratedReportContent({
          title: seededReport.name,
          headers: ['Employee Id', 'Employee First Name', 'Employee Last Name', 'Job Title'],
          cellTexts: ['MOCK-101', 'Ada', 'Lovelace', 'Principal QA Engineer', 'MOCK-102', 'Grace'],
        });
      } finally {
        if (!page.isClosed()) {
          await page.unroute(reportDataPattern);
        }
      }
    });

    await test.step('Intercept report data endpoint with HTTP 500 and verify graceful error alert', async () => {
      await page.route(reportDataPattern, async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { status: '500', message: 'Internal Server Error' } }),
        });
      });

      try {
        await reportsPage.gotoDisplayReport(seededReport.id);
        await reportsPage.expectErrorToast(/Internal Server Error/i);
        await expect(reportsPage.reportTitleHeading).toBeVisible();
        await expect(reportsPage.reportGrid).toBeVisible();
      } finally {
        if (!page.isClosed()) {
          await page.unroute(reportDataPattern);
          await page.unroute(reportMetaPattern);
        }
      }
    });
  });

  test('TC-RPT-008: Reports visual regression & WCAG accessibility audit @visual @a11y', async ({
    reportsPage,
    seededReport,
  }, testInfo) => {
    const page = reportsPage.page;
    const knownPimA11yRules = ['button-name', 'color-contrast', 'html-has-lang', 'label', 'list'];

    await test.step('Capture deterministic Reports list visual baseline & WCAG audit', async () => {
      const definedReportsPattern = '**/api/v2/pim/reports/defined?*';
      await page.route(definedReportsPattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              { id: 101, name: 'All Employee Sub Unit Hierarchy Report' },
              { id: 102, name: 'Employee Contact info report' },
              { id: 103, name: 'PIM Sample Report' },
            ],
            meta: { total: 3 },
            rels: [],
          }),
        });
      });

      try {
        await reportsPage.gotoReportsList();
        await expect(reportsPage.tableRows).toHaveCount(3);
        await reportsPage.waitForVisualStability();
        await expect(page).toHaveScreenshot('reports-list-default.png', {
          mask: reportsPage.getVisualMasks(),
        });
        await runA11yAudit(page, testInfo, { knownBaselineRuleIds: knownPimA11yRules });
      } finally {
        if (!page.isClosed()) {
          await page.unroute(definedReportsPattern);
        }
      }
    });

    await test.step('Capture deterministic generated report output visual baseline & WCAG audit', async () => {
      const reportMetaPattern = '**/api/v2/pim/reports?name=pim_defined*';
      const reportDataPattern = '**/api/v2/pim/reports/data?*';

      await page.route(reportMetaPattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              headers: [
                {
                  name: 'Employee Id',
                  prop: 'employeeId',
                  size: 200,
                  pin: null,
                  cellProperties: null,
                },
                {
                  name: 'Employee First Name',
                  prop: 'employeeFirstname',
                  size: 200,
                  pin: null,
                  cellProperties: null,
                },
                {
                  name: 'Employee Last Name',
                  prop: 'employeeLastname',
                  size: 200,
                  pin: null,
                  cellProperties: null,
                },
              ],
              filters: [],
            },
            meta: {
              headers: {
                name: 'Deterministic PIM Report Baseline',
                columnCount: 3,
                groupCount: 0,
                groupedColumnCount: 0,
              },
              filters: null,
            },
            rels: [],
          }),
        });
      });

      await page.route(reportDataPattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                empNumber: 1,
                employeeId: '0001',
                employeeFirstname: 'Demo',
                employeeLastname: 'Employee',
              },
              {
                empNumber: 2,
                employeeId: '0002',
                employeeFirstname: 'Sample',
                employeeLastname: 'Engineer',
              },
            ],
            meta: { total: 2 },
            rels: [],
          }),
        });
      });

      try {
        await reportsPage.gotoDisplayReport(seededReport.id);
        await expect(reportsPage.reportTitleHeading).toHaveText(seededReport.name);
        await expect(reportsPage.reportDataCells.first()).toBeVisible({ timeout: 25_000 });
        await reportsPage.waitForVisualStability();
        await expect(page).toHaveScreenshot('report-output-default.png', {
          mask: [...reportsPage.getVisualMasks(), reportsPage.reportTitleHeading],
        });
        await runA11yAudit(page, testInfo, { knownBaselineRuleIds: knownPimA11yRules });
      } finally {
        if (!page.isClosed()) {
          await page.unroute(reportDataPattern);
          await page.unroute(reportMetaPattern);
        }
      }
    });
  });
});
