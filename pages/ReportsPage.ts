import { expect, Locator, Page } from '@playwright/test';
import { gotoWithRetry, resetOrangeHrmThemeVariables, withRetry } from '../utils/apiHelpers';

export interface DisplayFieldSpec {
  group: string;
  field: string;
}

export class ReportsPage {
  readonly page: Page;
  readonly pimHeading: Locator;
  readonly reportsHeading: Locator;
  readonly filterSection: Locator;
  readonly filterArea: Locator;
  readonly filterToggleButton: Locator;
  readonly searchButton: Locator;
  readonly resetButton: Locator;
  readonly addButton: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly tableBody: Locator;
  readonly tableRows: Locator;
  readonly confirmDialog: Locator;
  readonly confirmDeleteButton: Locator;
  readonly cancelDeleteButton: Locator;
  readonly toastContainer: Locator;
  readonly reportTitleHeading: Locator;
  readonly reportGrid: Locator;
  readonly reportHeaderCells: Locator;
  readonly reportDataCells: Locator;
  readonly noRecordsBanner: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pimHeading = page.getByRole('heading', { name: 'PIM' });
    this.reportsHeading = page.getByRole('heading', { name: 'Employee Reports' });
    this.filterSection = page.locator('.oxd-table-filter');
    this.filterArea = page.locator('.oxd-table-filter-area');
    this.filterToggleButton = page.locator('.oxd-table-filter-header-options button').first();
    this.searchButton = page.locator('.oxd-table-filter button[type="submit"]');
    this.resetButton = page.locator('.oxd-table-filter').getByRole('button', { name: 'Reset' });
    this.addButton = page.getByRole('button', { name: 'Add' });
    this.saveButton = page.locator('form.oxd-form button[type="submit"]').first();
    this.cancelButton = page.locator('form.oxd-form').getByRole('button', { name: 'Cancel' });
    this.tableBody = page.locator('.oxd-table-body');
    this.tableRows = page.locator('.oxd-table-body .oxd-table-card');
    this.confirmDialog = page.locator('.oxd-dialog-sheet');
    this.confirmDeleteButton = page.getByRole('button', { name: 'Yes, Delete' });
    this.cancelDeleteButton = page.getByRole('button', { name: 'No, Cancel' });
    this.toastContainer = page.locator('#oxd-toaster_1');
    this.reportTitleHeading = page.locator('h6.orangehrm-main-title');
    this.reportGrid = page.locator('revo-grid');
    this.reportHeaderCells = page.locator('revo-grid .rgHeaderCell');
    this.reportDataCells = page.locator('revo-grid .rgCell');
    this.noRecordsBanner = page.locator(
      '.orangehrm-background-container, .oxd-toast--info, .orangehrm-vertical-padding',
      { hasText: 'No Records Found' }
    );
  }

  /** Wait for all active OrangeHRM loading spinners to clear within a scope. */
  async waitForSpinnerToClear(scope: Page | Locator = this.page): Promise<void> {
    await expect(scope.locator('.oxd-loading-spinner')).toHaveCount(0, { timeout: 30_000 });
  }

  /** Locate an `.oxd-input-group` matching an exact label text within an optional scope. */
  inputGroupByLabel(label: string, scope: Page | Locator = this.page): Locator {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return scope
      .locator('.oxd-input-group', {
        has: this.page.locator('.oxd-label', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) }),
      })
      .first();
  }

  /** Return the `.oxd-form-row` section matching a subtitle heading (`Selection Criteria` / `Display Fields`). */
  private formSectionByHeading(heading: 'Selection Criteria' | 'Display Fields'): Locator {
    return this.page
      .locator('form.oxd-form .oxd-form-row', {
        has: this.page.locator('h6', { hasText: new RegExp(`^\\s*${heading}\\s*$`) }),
      })
      .first();
  }

  /** Focus and clear an input before filling a deterministic value. */
  private async clearAndFill(input: Locator, value: string): Promise<void> {
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await input.focus();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    if (value.length > 0) {
      await input.fill(value);
    }
  }

  /** Assert a success toast containing `message` becomes visible. */
  async expectSuccessToast(message: string | RegExp): Promise<void> {
    const successToast = this.toastContainer.locator('.oxd-toast--success');
    await expect(successToast).toBeVisible({ timeout: 25_000 });
    await expect(successToast).toContainText(message);
  }

  /** Assert a warning toast containing `message` becomes visible. */
  async expectWarningToast(message: string | RegExp): Promise<void> {
    const warningToast = this.toastContainer.locator('.oxd-toast--warn');
    await expect(warningToast).toBeVisible({ timeout: 20_000 });
    await expect(warningToast).toContainText(message);
  }

  /** Assert an error toast containing `message` becomes visible. */
  async expectErrorToast(message: string | RegExp): Promise<void> {
    const errorToast = this.toastContainer.locator('.oxd-toast--error');
    await expect(errorToast).toBeVisible({ timeout: 20_000 });
    await expect(errorToast).toContainText(message);
  }

  /** Expand the Employee Reports filter panel on mobile viewports when collapsed. */
  async ensureFilterExpanded(): Promise<void> {
    await expect(this.filterSection).toBeVisible();
    if (!(await this.filterArea.isVisible())) {
      await this.filterToggleButton.click();
    }
    await expect(this.filterArea).toBeVisible();
  }

  /** Select an option in an OXD dropdown labeled `label`, returning the chosen option text. */
  async selectDropdownOption(
    label: string,
    preferredText?: string,
    scope: Page | Locator = this.page
  ): Promise<string> {
    const group = this.inputGroupByLabel(label, scope);
    const trigger = group.locator('.oxd-select-text');
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dropdown = this.page.locator('.oxd-select-dropdown');
    await expect(dropdown).toBeVisible();
    const options = dropdown.getByRole('option');

    if (preferredText) {
      const targetOption = options.filter({ hasText: preferredText }).first();
      await expect(targetOption).toBeVisible({ timeout: 20_000 });
      const chosen = ((await targetOption.textContent()) ?? preferredText).trim();
      await targetOption.click();
      await expect(dropdown).toBeHidden();
      return chosen;
    }

    // Wait for asynchronously fetched dropdown options (beyond placeholder items) to populate
    const firstRealOption = options
      .filter({ hasNotText: /-- Select --|No Records Found|Searching|Loading/i })
      .first();
    await expect(firstRealOption).toBeVisible({ timeout: 20_000 });
    await firstRealOption.click();
    await expect(dropdown).toBeHidden();
    const selectedLabel = group.locator('.oxd-select-text-input');
    await expect(selectedLabel).not.toHaveText('-- Select --');
    return ((await selectedLabel.textContent()) ?? '').trim();
  }

  /** Navigate to Dashboard before traversing PIM -> Reports via UI navigation. */
  async gotoDashboard(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(
      this.page,
      '/web/index.php/dashboard/index',
      this.page.getByRole('heading', { name: 'Dashboard' }),
      { maxAttempts }
    );
    await this.waitForSpinnerToClear();
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }

  /** Navigate directly to PIM -> Reports list and wait for table load. */
  async gotoReportsList(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(
      this.page,
      '/web/index.php/pim/viewDefinedPredefinedReports',
      this.filterSection,
      { maxAttempts }
    );
    await this.waitForSpinnerToClear();
  }

  /** Navigate directly to PIM -> Reports -> Add Report and wait for form ready. */
  async gotoAddReport(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(
      this.page,
      '/web/index.php/pim/definePredefinedReport',
      this.saveButton,
      { maxAttempts }
    );
    await this.waitForSpinnerToClear();
  }

  /** Navigate directly to Edit Report by `reportId` and wait for Vue hydration. */
  async gotoEditReport(reportId: number, maxAttempts = 3): Promise<void> {
    await gotoWithRetry(
      this.page,
      `/web/index.php/pim/definePredefinedReport/${reportId}`,
      this.saveButton,
      { maxAttempts }
    );
    await this.waitForSpinnerToClear();
    await expect(this.inputGroupByLabel('Report Name').locator('input')).not.toHaveValue('', {
      timeout: 25_000,
    });
  }

  /** Navigate directly to Display / Generated Report by `reportId`. */
  async gotoDisplayReport(reportId: number, maxAttempts = 3): Promise<void> {
    await gotoWithRetry(
      this.page,
      `/web/index.php/pim/displayPredefinedReport/${reportId}`,
      this.reportTitleHeading,
      { maxAttempts }
    );
    await this.waitForSpinnerToClear();
  }

  /** Navigate via the UI from Dashboard -> PIM -> Reports across desktop & mobile layouts. */
  async navigateViaPimReportsMenu(): Promise<void> {
    // Allow current page fonts and background requests to settle so Firefox does not log NS_BINDING_ABORTED errors
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const mobileMenuBtn = this.page.locator('.oxd-topbar-header-hamburger');
    const pimLink = this.page.getByRole('link', { name: 'PIM', exact: true });

    if (await mobileMenuBtn.isVisible()) {
      await mobileMenuBtn.click();
    }
    await expect(pimLink).toBeVisible();
    await pimLink.click({ noWaitAfter: true });
    await this.page.waitForURL(/\/pim\//, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await this.waitForSpinnerToClear();

    const topbarNav = this.page.locator('.oxd-topbar-body-nav');
    await expect(topbarNav.locator('.oxd-topbar-body-nav-tab').first()).toBeVisible({
      timeout: 25_000,
    });
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    const reportsTopNavLink = topbarNav.getByRole('link', { name: 'Reports', exact: true });

    if (!(await reportsTopNavLink.isVisible())) {
      const moreToggle = topbarNav
        .locator('.oxd-topbar-body-nav-tab')
        .filter({ hasText: 'More' })
        .first();
      await expect(moreToggle).toBeVisible();
      await moreToggle.click();
    }

    await expect(reportsTopNavLink).toBeVisible();
    await reportsTopNavLink.click({ noWaitAfter: true });
    await this.page.waitForURL(/\/pim\/viewDefinedPredefinedReports/, {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
    await expect(this.filterSection).toBeVisible();
    await this.waitForSpinnerToClear();
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }

  /** Return the Defined Reports table row/card containing `reportName`. */
  rowByReportName(reportName: string): Locator {
    return this.tableRows.filter({ hasText: reportName }).first();
  }

  /** Search Defined Reports by selecting a report from the `Report Name` autocomplete dropdown. */
  async searchReportByNameAutocomplete(
    searchHint: string,
    expectedReportName: string
  ): Promise<void> {
    await this.ensureFilterExpanded();
    const nameGroup = this.inputGroupByLabel('Report Name', this.filterSection);
    const input = nameGroup.locator('input');
    await this.clearAndFill(input, searchHint);

    const option = nameGroup
      .locator('.oxd-autocomplete-dropdown .oxd-autocomplete-option', {
        hasText: expectedReportName,
      })
      .first();
    await expect(option).toBeVisible({ timeout: 25_000 });
    await option.click();

    await this.searchButton.scrollIntoViewIfNeeded();
    await this.searchButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Type a non-existent report name, verify autocomplete shows "No Records Found" and invalid search is blocked. */
  async expectInvalidReportSearchBehavior(nonExistentName: string): Promise<void> {
    await this.ensureFilterExpanded();
    const nameGroup = this.inputGroupByLabel('Report Name', this.filterSection);
    const input = nameGroup.locator('input');
    await this.clearAndFill(input, nonExistentName);

    const noRecordsOption = nameGroup.locator(
      '.oxd-autocomplete-dropdown .oxd-autocomplete-option',
      { hasText: 'No Records Found' }
    );
    await expect(noRecordsOption).toBeVisible({ timeout: 20_000 });

    // Dismiss the autocomplete listbox so it does not cover Search on compact mobile viewports
    await input.press('Escape');
    await input.blur();
    if (await nameGroup.locator('.oxd-autocomplete-dropdown').isVisible()) {
      await this.filterSection.locator('h5').first().click();
    }

    await this.searchButton.scrollIntoViewIfNeeded();
    await this.searchButton.click();
    await expect(nameGroup.locator('.oxd-input-field-error-message')).toHaveText('Invalid');
  }

  /** Reset Defined Reports search filters and wait for the full report list to reload. */
  async resetSearchFilters(): Promise<void> {
    await this.ensureFilterExpanded();
    await this.resetButton.scrollIntoViewIfNeeded();
    await this.resetButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Click Add from Reports List and wait for Add Report form ready. */
  async openAddReportFromList(): Promise<void> {
    await this.addButton.scrollIntoViewIfNeeded();
    await this.addButton.click({ noWaitAfter: true });
    await this.page.waitForURL(/\/pim\/definePredefinedReport$/, {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
    await expect(this.saveButton).toBeVisible();
    await this.waitForSpinnerToClear();
  }

  /** Open an existing report in Edit mode from the Defined Reports list. */
  async openEditReportFromList(reportName: string): Promise<void> {
    const row = this.rowByReportName(reportName);
    if (!(await row.isVisible())) {
      await this.searchReportByNameAutocomplete(reportName, reportName);
    }
    await expect(row).toBeVisible();

    const editBtn = row.locator('button:has(.bi-pencil-fill)');
    await withRetry(
      async (attempt) => {
        if (/\/pim\/definePredefinedReport\/\d+/.test(this.page.url())) {
          if (attempt > 1) {
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
          }
          await expect(this.inputGroupByLabel('Report Name').locator('input')).not.toHaveValue('', {
            timeout: 20_000,
          });
          return;
        }
        await editBtn.scrollIntoViewIfNeeded();
        await editBtn.click({ noWaitAfter: true });
        await this.page.waitForURL(/\/pim\/definePredefinedReport\/\d+/, {
          waitUntil: 'domcontentloaded',
          timeout: 35_000,
        });
        await this.waitForSpinnerToClear();
        await expect(this.inputGroupByLabel('Report Name').locator('input')).not.toHaveValue('', {
          timeout: 20_000,
        });
      },
      { maxAttempts: 3, baseDelayMs: 1_500, shouldRetry: () => !this.page.isClosed() }
    );
  }

  /** Click Run / Generate icon on a report row and wait for the generated report view. */
  async runReportFromList(reportName: string): Promise<void> {
    const row = this.rowByReportName(reportName);
    if (!(await row.isVisible())) {
      await this.searchReportByNameAutocomplete(reportName, reportName);
    }
    await expect(row).toBeVisible();

    const runBtn = row.locator('button:has(.bi-file-text-fill)');
    await withRetry(
      async () => {
        if (/\/pim\/displayPredefinedReport\/\d+/.test(this.page.url())) {
          await expect(this.reportTitleHeading).toBeVisible({ timeout: 20_000 });
          return;
        }
        await runBtn.scrollIntoViewIfNeeded();
        await runBtn.click({ noWaitAfter: true });
        await this.page.waitForURL(/\/pim\/displayPredefinedReport\/\d+/, {
          waitUntil: 'domcontentloaded',
          timeout: 35_000,
        });
        await expect(this.reportTitleHeading).toBeVisible({ timeout: 20_000 });
      },
      { maxAttempts: 3, baseDelayMs: 1_500, shouldRetry: () => !this.page.isClosed() }
    );
    await this.waitForSpinnerToClear();
  }

  /** Delete a report row via Trash icon and confirm "Yes, Delete" in the confirmation modal. */
  async deleteReportRow(reportName: string): Promise<void> {
    const row = this.rowByReportName(reportName);
    await expect(row).toBeVisible();
    const trashBtn = row.locator('button:has(.bi-trash)');
    await trashBtn.scrollIntoViewIfNeeded();
    await trashBtn.click();

    await expect(this.confirmDialog).toBeVisible();
    await this.confirmDeleteButton.click();
    await this.expectSuccessToast(/Successfully Deleted/i);
    await expect(this.confirmDialog).toBeHidden();
    await this.waitForSpinnerToClear();
  }

  /** Fill the Report Name field on Add / Edit Report. */
  async fillReportName(name: string): Promise<void> {
    const input = this.inputGroupByLabel('Report Name').locator('input');
    await this.clearAndFill(input, name);
    await expect(input).toHaveValue(name);
  }

  /** Click Save with an empty Add Report form and verify Required inline validation. */
  async expectRequiredErrorOnBlankSave(): Promise<void> {
    await this.waitForSpinnerToClear();
    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();

    await expect(this.page).toHaveURL(/\/pim\/definePredefinedReport$/);
    await expect(
      this.inputGroupByLabel('Report Name').locator('.oxd-input-field-error-message')
    ).toHaveText('Required');
  }

  /** Click Save when Report Name is filled but no Display Fields are added and verify warning toast. */
  async expectMissingDisplayFieldsWarning(): Promise<void> {
    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();

    await expect(this.page).toHaveURL(/\/pim\/definePredefinedReport$/);
    await this.expectWarningToast(/At least one display field should be added/i);
  }

  /** Add a Selection Criterion row and select a value in its dropdown, returning the chosen label. */
  async addSelectionCriterion(
    criterionName: 'Employment Status' | 'Job Title' | 'Sub Unit' | 'Location',
    preferredValue?: string
  ): Promise<string> {
    const section = this.formSectionByHeading('Selection Criteria');
    await this.selectDropdownOption('Selection Criteria', criterionName, section);

    const addCriterionBtn = section.locator('button:has(.bi-plus)').first();
    await addCriterionBtn.scrollIntoViewIfNeeded();
    await addCriterionBtn.click();

    const criterionLabel = section.locator('.orangehrm-report-criteria-name', {
      hasText: new RegExp(`^\\s*${criterionName}\\s*$`),
    });
    await expect(criterionLabel).toBeVisible();

    return this.selectDropdownOption(criterionName, preferredValue, section);
  }

  /** Add a Display Field under `groupName` and verify its selection chip appears. */
  async addDisplayField(groupName: string, fieldName: string): Promise<void> {
    const section = this.formSectionByHeading('Display Fields');
    const groupTrigger = this.inputGroupByLabel('Select Display Field Group', section).locator(
      '.oxd-select-text-input'
    );
    const currentGroup = ((await groupTrigger.textContent()) ?? '').trim();
    if (currentGroup !== groupName) {
      await this.selectDropdownOption('Select Display Field Group', groupName, section);
    }

    await this.selectDropdownOption('Select Display Field', fieldName, section);
    const addFieldBtn = section.locator('button:has(.bi-plus)').first();
    await addFieldBtn.scrollIntoViewIfNeeded();
    await addFieldBtn.click();

    await this.expectDisplayFieldChipVisible(fieldName);
  }

  /** Locate a selected Display Field chip matching `fieldName`. */
  displayFieldChip(fieldName: string): Locator {
    const section = this.formSectionByHeading('Display Fields');
    const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return section
      .locator('.oxd-multiselect-chips-selected', {
        hasText: new RegExp(`^\\s*${escaped}\\s*$`),
      })
      .first();
  }

  /** Remove an existing Display Field chip by clicking its clear (`x`) icon. */
  async removeDisplayFieldChip(fieldName: string): Promise<void> {
    const chip = this.displayFieldChip(fieldName);
    await expect(chip).toBeVisible();
    await chip.locator('i.bi-x.--clear').click();
    await expect(chip).toHaveCount(0);
  }

  /** Assert a Display Field chip is rendered in the Display Fields section. */
  async expectDisplayFieldChipVisible(fieldName: string): Promise<void> {
    await expect(this.displayFieldChip(fieldName)).toBeVisible();
  }

  /** Assert a Display Field chip is absent from the Display Fields section. */
  async expectDisplayFieldChipAbsent(fieldName: string): Promise<void> {
    await expect(this.displayFieldChip(fieldName)).toHaveCount(0);
  }

  /** Assert a Selection Criterion and its chosen dropdown value persisted in Edit mode. */
  async expectCriterionPersisted(criterionName: string, expectedValue: string): Promise<void> {
    const section = this.formSectionByHeading('Selection Criteria');
    await expect(
      section.locator('.orangehrm-report-criteria-name', {
        hasText: new RegExp(`^\\s*${criterionName}\\s*$`),
      })
    ).toBeVisible();
    await expect(
      this.inputGroupByLabel(criterionName, section).locator('.oxd-select-text-input')
    ).toHaveText(expectedValue);
  }

  /** Save Add/Edit Report, assert success toast, wait for Display Report redirect, and return reportId. */
  async saveReportAndCaptureId(): Promise<number> {
    await this.saveButton.scrollIntoViewIfNeeded();
    await Promise.all([
      this.expectSuccessToast(/Successfully Saved|Successfully Updated/i),
      this.page.waitForURL(/\/pim\/displayPredefinedReport\/\d+/, {
        waitUntil: 'domcontentloaded',
        timeout: 35_000,
      }),
      this.saveButton.click(),
    ]);
    const match = this.page.url().match(/\/displayPredefinedReport\/(\d+)/);
    if (!match) {
      throw new Error(`Could not extract reportId from URL: ${this.page.url()}`);
    }
    await expect(this.reportTitleHeading).toBeVisible();
    await this.waitForSpinnerToClear();
    return Number(match[1]);
  }

  /**
   * Wait for `<revo-grid>` report headers and verify expected column headers and data values.
   * Temporarily widens narrow mobile viewports so RevoGrid renders all virtualized columns.
   */
  async expectGeneratedReportContent(expected: {
    title?: string;
    headers: string[];
    cellTexts: string[];
  }): Promise<void> {
    await expect(this.reportTitleHeading).toBeVisible();
    if (expected.title) {
      await expect(this.reportTitleHeading).toHaveText(expected.title);
    }
    await this.waitForSpinnerToClear();

    const originalViewport = this.page.viewportSize();
    const needsWideLayout = (originalViewport?.width ?? 1280) < 1100;

    if (needsWideLayout) {
      await this.page.setViewportSize({
        width: 1280,
        height: originalViewport?.height ?? 851,
      });
    }

    try {
      await expect(this.reportGrid).toBeVisible();
      await expect
        .poll(
          async () => {
            const raw = await this.reportHeaderCells.allTextContents();
            return raw.map((t) => t.trim()).filter(Boolean);
          },
          { timeout: 25_000 }
        )
        .toEqual(expect.arrayContaining(expected.headers));

      await expect
        .poll(
          async () => {
            const raw = await this.reportDataCells.allTextContents();
            return raw.map((t) => t.trim()).filter(Boolean);
          },
          { timeout: 25_000 }
        )
        .toEqual(expect.arrayContaining(expected.cellTexts));
    } finally {
      if (needsWideLayout && originalViewport && !this.page.isClosed()) {
        await this.page.setViewportSize(originalViewport);
      }
    }
  }

  /** Assert a generated report with zero matching records renders the empty state cleanly. */
  async expectReportEmptyState(): Promise<void> {
    await expect(this.reportTitleHeading).toBeVisible();
    await this.waitForSpinnerToClear();
    await expect(this.noRecordsBanner.first()).toBeVisible({ timeout: 20_000 });
    await expect(this.reportDataCells).toHaveCount(0);
  }

  /** Wait for spinners, theme normalization, fonts, and images before visual snapshot comparison. */
  async waitForVisualStability(): Promise<void> {
    await this.waitForSpinnerToClear();
    await resetOrangeHrmThemeVariables(this.page);
    await this.page.evaluate(async () => {
      await document.fonts.ready;
      const pendingImages = Array.from(document.images).filter((img) => !img.complete);
      await Promise.all(
        pendingImages.map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            })
        )
      );
    });
  }

  /** Return locators for dynamic branding and user dropdown elements to mask in snapshots. */
  getVisualMasks(): Locator[] {
    return [
      this.page.locator('.oxd-userdropdown-tab'),
      this.page.locator('.oxd-brand-logo'),
      this.page.locator('.oxd-brand-banner'),
    ];
  }
}
