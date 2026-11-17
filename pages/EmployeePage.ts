import { expect, Locator, Page } from '@playwright/test';
import { gotoWithRetry, resetOrangeHrmThemeVariables, withRetry } from '../utils/apiHelpers';

export interface MandatoryEmployeeForm {
  firstName: string;
  middleName?: string;
  lastName: string;
  employeeId: string;
}

export interface PersonalDetailsUpdateInput {
  middleName: string;
  licenseNumber: string;
  licenseExpiryDate?: string;
  dateOfBirth: string;
}

export interface ContactDetailsUpdateInput {
  street1: string;
  city: string;
  stateProvince?: string;
  zipCode?: string;
  mobile?: string;
  workEmail: string;
}

export interface JobSelectionResult {
  employmentStatus?: string;
  jobTitle?: string;
  subunit?: string;
}

export class EmployeePage {
  readonly page: Page;
  readonly pimHeading: Locator;
  readonly firstNameInput: Locator;
  readonly middleNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly createLoginSwitch: Locator;
  readonly saveButton: Locator;
  readonly searchButton: Locator;
  readonly resetButton: Locator;
  readonly deleteSelectedButton: Locator;
  readonly filterSection: Locator;
  readonly filterArea: Locator;
  readonly filterToggleButton: Locator;
  readonly tableBody: Locator;
  readonly tableRows: Locator;
  readonly noRecordsBanner: Locator;
  readonly confirmDialog: Locator;
  readonly confirmDeleteButton: Locator;
  readonly cancelDeleteButton: Locator;
  readonly toastContainer: Locator;
  readonly fileInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pimHeading = page.getByRole('heading', { name: 'PIM' });
    this.firstNameInput = page.locator('input[name="firstName"]');
    this.middleNameInput = page.locator('input[name="middleName"]');
    this.lastNameInput = page.locator('input[name="lastName"]');
    this.createLoginSwitch = page.locator('.oxd-switch-input');
    this.saveButton = page.locator('button[type="submit"]').first();
    this.searchButton = page.locator('.oxd-table-filter button[type="submit"]');
    this.resetButton = page.locator('.oxd-table-filter button[type="reset"]');
    this.deleteSelectedButton = page.getByRole('button', { name: 'Delete Selected' });
    this.filterSection = page.locator('.oxd-table-filter');
    this.filterArea = page.locator('.oxd-table-filter-area');
    this.filterToggleButton = page.locator('.oxd-table-filter-header-options button').first();
    this.tableBody = page.locator('.oxd-table-body');
    this.tableRows = page.locator('.oxd-table-body .oxd-table-card');
    this.noRecordsBanner = page.locator('.oxd-toast, .orangehrm-vertical-padding', {
      hasText: 'No Records Found',
    });
    this.confirmDialog = page.locator('.oxd-dialog-sheet');
    this.confirmDeleteButton = page.getByRole('button', { name: 'Yes, Delete' });
    this.cancelDeleteButton = page.getByRole('button', { name: 'No, Cancel' });
    this.toastContainer = page.locator('#oxd-toaster_1');
    this.fileInput = page.locator('input[type="file"]');
  }

  /** Wait for all active OrangeHRM loading spinners to finish within a scope. */
  async waitForSpinnerToClear(scope: Page | Locator = this.page): Promise<void> {
    await expect(scope.locator('.oxd-loading-spinner')).toHaveCount(0, { timeout: 30_000 });
  }

  /** Locate an `.oxd-input-group` by its exact label text. */
  inputGroupByLabel(label: string): Locator {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page
      .locator('.oxd-input-group', {
        has: this.page.locator('.oxd-label', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) }),
      })
      .first();
  }

  /** Clear any asynchronously populated input before typing a deterministic value. */
  private async clearAndFill(input: Locator, value: string): Promise<void> {
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    if (value.length > 0) {
      await input.fill(value);
    }
  }

  /** Assert a success toast containing the expected message appears cleanly. */
  private async expectSuccessToast(message: string | RegExp): Promise<void> {
    const successToast = this.toastContainer.locator('.oxd-toast--success');
    await expect(successToast).toBeVisible({ timeout: 25_000 });
    await expect(successToast).toContainText(message);
  }

  /** Expand the Employee List filter drawer on mobile/tablet viewports when collapsed. */
  async ensureFilterExpanded(): Promise<void> {
    await expect(this.filterSection).toBeVisible();
    if (!(await this.filterArea.isVisible())) {
      await this.filterToggleButton.click();
    }
    await expect(this.filterArea).toBeVisible();
  }

  /** Navigate directly to PIM Employee List and wait for filter/table spinners to settle. */
  async gotoEmployeeList(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/pim/viewEmployeeList', this.filterSection, {
      maxAttempts,
    });
    await this.waitForSpinnerToClear();
  }

  /** Navigate directly to PIM Add Employee page and wait for form initialization. */
  async gotoAddEmployee(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/pim/addEmployee', this.firstNameInput, {
      maxAttempts,
    });
    await this.waitForSpinnerToClear();
  }

  /** Navigate directly to an employee's Personal Details page and wait for spinners to clear. */
  async gotoPersonalDetails(empNumber: number, maxAttempts = 3): Promise<void> {
    await gotoWithRetry(
      this.page,
      `/web/index.php/pim/viewPersonalDetails/empNumber/${empNumber}`,
      this.firstNameInput,
      { maxAttempts }
    );
    await this.waitForSpinnerToClear();
  }

  /** Fill mandatory Add Employee fields cleanly. */
  async fillAddEmployeeMandatory(data: MandatoryEmployeeForm): Promise<void> {
    await this.waitForSpinnerToClear();
    await this.clearAndFill(this.firstNameInput, data.firstName);
    if (data.middleName !== undefined) {
      await this.clearAndFill(this.middleNameInput, data.middleName);
    }
    await this.clearAndFill(this.lastNameInput, data.lastName);

    const empIdInput = this.inputGroupByLabel('Employee Id').locator('input');
    await this.clearAndFill(empIdInput, data.employeeId);
  }

  /** Toggle "Create Login Details" ON if needed and populate Username + Passwords. */
  async enableCreateLoginDetailsAndFill(
    username: string,
    password: string,
    confirmPassword = password
  ): Promise<void> {
    const usernameInput = this.inputGroupByLabel('Username').locator('input');
    if (!(await usernameInput.isVisible())) {
      await this.createLoginSwitch.scrollIntoViewIfNeeded();
      await this.createLoginSwitch.click();
    }
    await expect(usernameInput).toBeVisible();
    await this.clearAndFill(usernameInput, username);

    const passwordInput = this.inputGroupByLabel('Password').locator('input');
    const confirmInput = this.inputGroupByLabel('Confirm Password').locator('input');
    await this.clearAndFill(passwordInput, password);
    await this.clearAndFill(confirmInput, confirmPassword);
  }

  /** Click Save on Add Employee, verify redirect to Personal Details, and return new empNumber. */
  async submitAddEmployeeAndCaptureEmpNumber(): Promise<number> {
    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();
    await this.page.waitForURL(/\/pim\/viewPersonalDetails\/empNumber\/\d+/, {
      waitUntil: 'domcontentloaded',
      timeout: 40_000,
    });
    const match = this.page.url().match(/\/empNumber\/(\d+)/);
    if (!match) {
      throw new Error(`Could not extract empNumber from URL: ${this.page.url()}`);
    }
    await expect(this.firstNameInput).toBeVisible();
    await this.waitForSpinnerToClear();
    return Number(match[1]);
  }

  /** Submit Add Employee with blank mandatory fields and assert Required inline errors. */
  async expectRequiredErrorsOnAddEmployee(): Promise<void> {
    await this.waitForSpinnerToClear();
    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();

    await expect(this.page).toHaveURL(/\/pim\/addEmployee/);
    const nameGroup = this.page.locator('.oxd-input-group', {
      has: this.firstNameInput,
    });
    await expect(nameGroup.locator('.oxd-input-field-error-message')).toHaveCount(2);
    await expect(nameGroup.locator('.oxd-input-field-error-message').first()).toHaveText(
      'Required'
    );
    await expect(nameGroup.locator('.oxd-input-field-error-message').nth(1)).toHaveText('Required');
  }

  /** Assert duplicate Employee Id triggers the inline validation error. */
  async expectDuplicateEmployeeIdError(existingEmployeeId: string): Promise<void> {
    const group = this.inputGroupByLabel('Employee Id');
    const input = group.locator('input');
    await this.clearAndFill(input, existingEmployeeId);
    await input.blur();
    await expect(group.locator('.oxd-input-field-error-message')).toContainText(
      /Employee Id already exists/i,
      { timeout: 20_000 }
    );
  }

  /** Assert mismatched passwords show inline mismatch validation error. */
  async expectMismatchedPasswordError(password: string, confirmPassword: string): Promise<void> {
    const usernameInput = this.inputGroupByLabel('Username').locator('input');
    if (!(await usernameInput.isVisible())) {
      await this.createLoginSwitch.click();
    }
    const passwordInput = this.inputGroupByLabel('Password').locator('input');
    const confirmGroup = this.inputGroupByLabel('Confirm Password');
    const confirmInput = confirmGroup.locator('input');
    await this.clearAndFill(passwordInput, password);
    await this.clearAndFill(confirmInput, confirmPassword);
    await confirmInput.blur();
    await expect(confirmGroup.locator('.oxd-input-field-error-message')).toContainText(
      /Passwords do not match/i
    );
  }

  /** Upload a photo file on Add Employee and verify the expected inline validation error. */
  async uploadPhotoAndExpectError(
    file: { name: string; mimeType: string; buffer: Buffer },
    expectedError: string | RegExp
  ): Promise<void> {
    await this.fileInput.setInputFiles(file);
    const photoError = this.page
      .locator('.oxd-input-group', { has: this.fileInput })
      .locator('.oxd-input-field-error-message');
    await expect(photoError).toBeVisible();
    await expect(photoError).toContainText(expectedError);
  }

  /** Select an option inside an OXD custom dropdown labeled `label`, returning the chosen text. */
  async selectDropdownOption(label: string, preferredText?: string): Promise<string | undefined> {
    const group = this.inputGroupByLabel(label);
    const trigger = group.locator('.oxd-select-text');
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dropdown = this.page.locator('.oxd-select-dropdown');
    await expect(dropdown).toBeVisible();

    const options = dropdown.getByRole('option');
    if (preferredText) {
      const targetOption = options.filter({ hasText: preferredText }).first();
      await expect(targetOption).toBeVisible();
      const chosen = (await targetOption.textContent())?.trim();
      await targetOption.click();
      return chosen;
    }

    const optionCount = await options.count();
    if (optionCount <= 1) {
      // Close dropdown cleanly if only "-- Select --" exists
      await options.first().click();
      return undefined;
    }

    const firstRealOption = options.nth(1);
    const chosen = (await firstRealOption.textContent())?.trim();
    await firstRealOption.click();
    return chosen;
  }

  /** Switch to a profile sub-tab (`Personal Details`, `Contact Details`, `Job`) and wait until ready. */
  async openProfileTab(tabName: 'Personal Details' | 'Contact Details' | 'Job'): Promise<void> {
    const tab = this.page
      .locator('.orangehrm-tabs-item')
      .filter({ hasText: new RegExp(`^\\s*${tabName}\\s*$`) })
      .first();
    await tab.scrollIntoViewIfNeeded();
    await expect(tab).toBeVisible();
    await tab.click({ noWaitAfter: true });

    const urlPattern =
      tabName === 'Personal Details'
        ? /\/pim\/viewPersonalDetails/
        : tabName === 'Contact Details'
          ? /\/pim\/contactDetails/
          : /\/pim\/viewJobDetails/;
    await this.page.waitForURL(urlPattern, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await this.waitForSpinnerToClear();
  }

  /** Format a `YYYY-MM-DD` date string to match OrangeHRM's active localization placeholder. */
  private formatDateForPlaceholder(isoDate: string, placeholder: string | null): string {
    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || !placeholder) {
      return isoDate;
    }
    const [, yyyy, mm, dd] = match;
    if (/yyyy-dd-mm/i.test(placeholder)) {
      return `${yyyy}-${dd}-${mm}`;
    }
    if (/dd-mm-yyyy/i.test(placeholder)) {
      return `${dd}-${mm}-${yyyy}`;
    }
    if (/mm-dd-yyyy/i.test(placeholder)) {
      return `${mm}-${dd}-${yyyy}`;
    }
    return isoDate;
  }

  /** Update Personal Details fields and save, waiting for confirmation toast. */
  async updatePersonalDetails(details: PersonalDetailsUpdateInput): Promise<void> {
    await this.waitForSpinnerToClear();
    await this.clearAndFill(this.middleNameInput, details.middleName);

    const licenseInput = this.inputGroupByLabel("Driver's License Number").locator('input');
    await this.clearAndFill(licenseInput, details.licenseNumber);

    const dobInput = this.inputGroupByLabel('Date of Birth').locator('input');
    const dobPlaceholder = await dobInput.getAttribute('placeholder');
    await this.clearAndFill(
      dobInput,
      this.formatDateForPlaceholder(details.dateOfBirth, dobPlaceholder)
    );

    const personalFormSave = this.page.locator('form.oxd-form').first().locator('button[type="submit"]');
    await personalFormSave.scrollIntoViewIfNeeded();
    await personalFormSave.click();
    await this.expectSuccessToast(/Successfully Updated/i);
    await this.waitForSpinnerToClear();
  }

  /** Update Contact Details fields and save, waiting for confirmation toast. */
  async updateContactDetails(details: ContactDetailsUpdateInput): Promise<void> {
    await this.waitForSpinnerToClear();
    await this.clearAndFill(this.inputGroupByLabel('Street 1').locator('input'), details.street1);
    await this.clearAndFill(this.inputGroupByLabel('City').locator('input'), details.city);
    await this.clearAndFill(
      this.inputGroupByLabel('Work Email').locator('input'),
      details.workEmail
    );

    const saveBtn = this.page.locator('form.oxd-form').first().locator('button[type="submit"]');
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();
    await this.expectSuccessToast(/Successfully Updated|Successfully Saved/i);
    await this.waitForSpinnerToClear();
  }

  /** Update available Job Details dropdowns and save, returning selected labels for verification. */
  async updateJobDetails(): Promise<JobSelectionResult> {
    await this.waitForSpinnerToClear();
    const jobTitle = await this.selectDropdownOption('Job Title');
    const employmentStatus = await this.selectDropdownOption('Employment Status');
    const subunit = await this.selectDropdownOption('Sub Unit');

    const saveBtn = this.page.locator('form.oxd-form').first().locator('button[type="submit"]');
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();
    await this.expectSuccessToast(/Successfully Updated/i);
    await this.waitForSpinnerToClear();

    return { jobTitle, employmentStatus, subunit };
  }

  /** Assert Personal Details input values match expected fields. */
  async expectPersonalDetailsValues(expected: {
    firstName: string;
    lastName: string;
    employeeId: string;
    middleName?: string;
    licenseNumber?: string;
    dateOfBirth?: string;
  }): Promise<void> {
    await this.waitForSpinnerToClear();
    await expect(this.firstNameInput).toHaveValue(expected.firstName);
    await expect(this.lastNameInput).toHaveValue(expected.lastName);
    await expect(this.inputGroupByLabel('Employee Id').locator('input')).toHaveValue(
      expected.employeeId
    );
    if (expected.middleName !== undefined) {
      await expect(this.middleNameInput).toHaveValue(expected.middleName);
    }
    if (expected.licenseNumber !== undefined) {
      await expect(this.inputGroupByLabel("Driver's License Number").locator('input')).toHaveValue(
        expected.licenseNumber
      );
    }
    if (expected.dateOfBirth !== undefined) {
      const dobInput = this.inputGroupByLabel('Date of Birth').locator('input');
      const dobPlaceholder = await dobInput.getAttribute('placeholder');
      await expect(dobInput).toHaveValue(
        this.formatDateForPlaceholder(expected.dateOfBirth, dobPlaceholder)
      );
    }
  }

  /** Assert Contact Details inputs retain saved values. */
  async expectContactDetailsValues(expected: {
    street1: string;
    city: string;
    workEmail: string;
  }): Promise<void> {
    await this.waitForSpinnerToClear();
    await expect(this.inputGroupByLabel('Street 1').locator('input')).toHaveValue(expected.street1);
    await expect(this.inputGroupByLabel('City').locator('input')).toHaveValue(expected.city);
    await expect(this.inputGroupByLabel('Work Email').locator('input')).toHaveValue(
      expected.workEmail
    );
  }

  /** Assert Job Details dropdowns display expected labels. */
  async expectJobDetailsValues(expected: JobSelectionResult): Promise<void> {
    await this.waitForSpinnerToClear();
    if (expected.jobTitle) {
      await expect(
        this.inputGroupByLabel('Job Title').locator('.oxd-select-text-input')
      ).toHaveText(expected.jobTitle);
    }
    if (expected.employmentStatus) {
      await expect(
        this.inputGroupByLabel('Employment Status').locator('.oxd-select-text-input')
      ).toHaveText(expected.employmentStatus);
    }
    if (expected.subunit) {
      await expect(this.inputGroupByLabel('Sub Unit').locator('.oxd-select-text-input')).toHaveText(
        expected.subunit
      );
    }
  }

  /** Search Employee List by Employee Name autocomplete hint and select the matching suggestion. */
  async searchByEmployeeNameAutocomplete(searchHint: string, expectedText: string): Promise<void> {
    await this.ensureFilterExpanded();
    const nameGroup = this.inputGroupByLabel('Employee Name');
    const nameInput = nameGroup.locator('input');
    await this.clearAndFill(nameInput, searchHint);

    const dropdown = nameGroup.locator('.oxd-autocomplete-dropdown');
    const option = dropdown
      .locator('.oxd-autocomplete-option', { hasText: expectedText })
      .first();
    await expect(option).toBeVisible({ timeout: 25_000 });
    await option.click();

    await this.searchButton.scrollIntoViewIfNeeded();
    await this.searchButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Filter Employee List by partial name string without picking a single autocomplete option. */
  async searchByEmployeeNameText(nameQuery: string): Promise<void> {
    await this.ensureFilterExpanded();
    const nameGroup = this.inputGroupByLabel('Employee Name');
    const nameInput = nameGroup.locator('input');
    await this.clearAndFill(nameInput, nameQuery);
    // Dismiss autocomplete popup so it cannot cover the Search button on compact viewports
    await nameInput.press('Escape');
    await nameInput.blur();

    await this.searchButton.scrollIntoViewIfNeeded();
    await this.searchButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Search Employee List by exact Employee Id. */
  async searchByEmployeeId(employeeId: string): Promise<void> {
    await this.ensureFilterExpanded();
    const idInput = this.inputGroupByLabel('Employee Id').locator('input');
    await this.clearAndFill(idInput, employeeId);
    await this.searchButton.scrollIntoViewIfNeeded();
    await this.searchButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Reset Employee List search & dropdown filters and wait for table reload. */
  async resetSearchFilters(): Promise<void> {
    await this.ensureFilterExpanded();
    await this.resetButton.scrollIntoViewIfNeeded();
    await this.resetButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Filter Employee List using Employment Status, Include, Job Title & Sub Unit dropdowns, then Reset. */
  async filterByDropdownsAndReset(criteria: {
    empStatus?: string;
    jobTitle?: string;
    subunit?: string;
  }): Promise<void> {
    await this.ensureFilterExpanded();
    if (criteria.empStatus) {
      await this.selectDropdownOption('Employment Status', criteria.empStatus);
    } else {
      await this.selectDropdownOption('Employment Status');
    }

    await this.selectDropdownOption('Include', 'Current and Past Employees');

    if (criteria.jobTitle) {
      await this.selectDropdownOption('Job Title', criteria.jobTitle);
    } else {
      await this.selectDropdownOption('Job Title');
    }

    if (criteria.subunit) {
      await this.selectDropdownOption('Sub Unit', criteria.subunit);
    } else {
      await this.selectDropdownOption('Sub Unit');
    }

    await this.searchButton.scrollIntoViewIfNeeded();
    await this.searchButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Return a locator scoped to the Employee List row containing `employeeId`. */
  rowByEmployeeId(employeeId: string): Locator {
    return this.tableRows.filter({ hasText: employeeId }).first();
  }

  /** Search for an employee by ID in Employee List and open their profile via the edit icon. */
  async openEmployeeFromList(employeeId: string): Promise<void> {
    await this.searchByEmployeeId(employeeId);
    const row = this.rowByEmployeeId(employeeId);
    await expect(row).toBeVisible();

    const editBtn = row.locator('button:has(.bi-pencil-fill)');
    await withRetry(
      async (attempt) => {
        if (/\/pim\/viewPersonalDetails\/empNumber\//.test(this.page.url())) {
          if (attempt > 1) {
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
          }
          await expect(this.firstNameInput).toBeVisible({ timeout: 20_000 });
          return;
        }
        await editBtn.scrollIntoViewIfNeeded();
        await editBtn.click({ noWaitAfter: true });
        await this.page.waitForURL(/\/pim\/viewPersonalDetails\/empNumber\/\d+/, {
          waitUntil: 'domcontentloaded',
          timeout: 40_000,
        });
        await expect(this.firstNameInput).toBeVisible({ timeout: 20_000 });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1_500,
        shouldRetry: () => !this.page.isClosed(),
      }
    );
    await this.waitForSpinnerToClear();
  }

  /** Delete an employee row by clicking Trash and confirming "Yes, Delete". */
  async deleteEmployeeRow(employeeId: string): Promise<void> {
    const row = this.rowByEmployeeId(employeeId);
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

  /** Trigger row deletion and dismiss the modal via "No, Cancel", confirming the row remains. */
  async cancelDeleteEmployeeRow(employeeId: string): Promise<void> {
    const row = this.rowByEmployeeId(employeeId);
    await expect(row).toBeVisible();
    const trashBtn = row.locator('button:has(.bi-trash)');
    await trashBtn.scrollIntoViewIfNeeded();
    await trashBtn.click();

    await expect(this.confirmDialog).toBeVisible();
    await this.cancelDeleteButton.click();
    await expect(this.confirmDialog).toBeHidden();
    await expect(row).toBeVisible();
  }

  /**
   * Select multiple employee checkboxes and confirm bulk deletion.
   * On mobile viewports (<768px), OrangeHRM omits row checkboxes inside `.oxd-table-card.--mobile`,
   * so we temporarily widen to desktop layout to exercise bulk selection across all projects.
   */
  async bulkDeleteEmployeesByIds(employeeIds: string[]): Promise<void> {
    const originalViewport = this.page.viewportSize();
    const needsWideLayout = (originalViewport?.width ?? 1280) < 768;

    if (needsWideLayout) {
      await this.page.setViewportSize({
        width: 1024,
        height: originalViewport?.height ?? 851,
      });
    }

    try {
      for (const employeeId of employeeIds) {
        const row = this.rowByEmployeeId(employeeId);
        await row.scrollIntoViewIfNeeded();
        await expect(row).toBeVisible();
        const checkbox = row.locator('.oxd-checkbox-input');
        await expect(checkbox).toBeVisible();
        await checkbox.click();
      }

      await this.deleteSelectedButton.scrollIntoViewIfNeeded();
      await expect(this.deleteSelectedButton).toBeVisible();
      await this.deleteSelectedButton.click();

      await expect(this.confirmDialog).toBeVisible();
      await this.confirmDeleteButton.click();
      await this.expectSuccessToast(/Successfully Deleted/i);
      await expect(this.confirmDialog).toBeHidden();
      await this.waitForSpinnerToClear();
    } finally {
      if (needsWideLayout && originalViewport && !this.page.isClosed()) {
        await this.page.setViewportSize(originalViewport);
      }
    }
  }

  /** Stabilize spinners, theme CSS variables, fonts, and images before visual snapshot comparison. */
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

  /** Return locators for dynamic branding/user/auto-id elements to mask in PIM visual baselines. */
  getVisualMasks(): Locator[] {
    return [
      this.page.locator('.oxd-userdropdown-tab'),
      this.page.locator('.oxd-brand-logo'),
      this.page.locator('.oxd-brand-banner'),
    ];
  }
}
