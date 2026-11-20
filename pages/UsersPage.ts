import { expect, Locator, Page } from '@playwright/test';
import { gotoWithRetry, resetOrangeHrmThemeVariables, withRetry } from '../utils/apiHelpers';

export type UserRoleOption = 'Admin' | 'ESS';
export type UserStatusOption = 'Enabled' | 'Disabled';

export interface CreateUserInput {
  role: UserRoleOption;
  employeeFirstName: string;
  employeeFullName: string;
  status: UserStatusOption;
  username: string;
  password: string;
}

export interface EditUserInput {
  role?: UserRoleOption;
  status?: UserStatusOption;
  newUsername?: string;
  newPassword?: string;
}

export interface InvalidUserValidationInput {
  shortUsername: string;
  duplicateUsername: string;
  weakPassword: string;
  validPassword: string;
  mismatchedPassword: string;
}

export class UsersPage {
  readonly page: Page;
  readonly filterSection: Locator;
  readonly filterArea: Locator;
  readonly filterToggleButton: Locator;
  readonly searchButton: Locator;
  readonly resetButton: Locator;
  readonly addButton: Locator;
  readonly deleteSelectedButton: Locator;
  readonly saveButton: Locator;
  readonly tableBody: Locator;
  readonly tableRows: Locator;
  readonly noRecordsBanner: Locator;
  readonly confirmDialog: Locator;
  readonly confirmDeleteButton: Locator;
  readonly cancelDeleteButton: Locator;
  readonly toastContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.filterSection = page.locator('.oxd-table-filter');
    this.filterArea = page.locator('.oxd-table-filter-area');
    this.filterToggleButton = page.locator('.oxd-table-filter-header-options button').first();
    this.searchButton = page.locator('.oxd-table-filter button[type="submit"]');
    this.resetButton = page.locator('.oxd-table-filter').getByRole('button', { name: 'Reset' });
    this.addButton = page.getByRole('button', { name: 'Add' });
    this.deleteSelectedButton = page.getByRole('button', { name: 'Delete Selected' });
    this.saveButton = page.locator('form.oxd-form button[type="submit"]').first();
    this.tableBody = page.locator('.oxd-table-body');
    this.tableRows = page.locator('.oxd-table-body .oxd-table-card');
    this.noRecordsBanner = page.locator('.oxd-toast, .orangehrm-vertical-padding', {
      hasText: 'No Records Found',
    });
    this.confirmDialog = page.locator('.oxd-dialog-sheet');
    this.confirmDeleteButton = page.getByRole('button', { name: 'Yes, Delete' });
    this.cancelDeleteButton = page.getByRole('button', { name: 'No, Cancel' });
    this.toastContainer = page.locator('#oxd-toaster_1');
  }

  /** Wait for all active loading spinners to clear within a scope. */
  async waitForSpinnerToClear(scope: Page | Locator = this.page): Promise<void> {
    await expect(scope.locator('.oxd-loading-spinner')).toHaveCount(0, { timeout: 30_000 });
  }

  /** Locate an `.oxd-input-group` matching a label (allowing optional trailing `?` / `*`). */
  inputGroupByLabel(label: string): Locator {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page
      .locator('.oxd-input-group', {
        has: this.page.locator('.oxd-label', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) }),
      })
      .first();
  }

  /**
   * Focus and fill without pointer hit-testing so WebKit's expanding `.user-password-cell`
   * badge never blocks `Confirm Password`.
   */
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
  private async expectSuccessToast(message: string | RegExp): Promise<void> {
    const successToast = this.toastContainer.locator('.oxd-toast--success');
    await expect(successToast).toBeVisible({ timeout: 25_000 });
    await expect(successToast).toContainText(message);
  }

  /** Expand the System Users filter panel on mobile viewports when collapsed. */
  async ensureFilterExpanded(): Promise<void> {
    await expect(this.filterSection).toBeVisible();
    if (!(await this.filterArea.isVisible())) {
      await this.filterToggleButton.click();
    }
    await expect(this.filterArea).toBeVisible();
  }

  /** Select an option in an OXD dropdown labeled `label`. */
  async selectDropdownOption(label: string, optionText: string): Promise<void> {
    const group = this.inputGroupByLabel(label);
    const trigger = group.locator('.oxd-select-text');
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dropdown = this.page.locator('.oxd-select-dropdown');
    await expect(dropdown).toBeVisible();
    const targetOption = dropdown.getByRole('option', { name: optionText, exact: true }).first();
    await expect(targetOption).toBeVisible();
    await targetOption.click();
  }

  /** Type into `Employee Name` autocomplete input and pick the matching dropdown suggestion. */
  async selectEmployeeNameAutocomplete(searchHint: string, expectedText: string): Promise<void> {
    const group = this.inputGroupByLabel('Employee Name');
    const input = group.locator('input');
    await this.clearAndFill(input, searchHint);

    const option = group
      .locator('.oxd-autocomplete-dropdown .oxd-autocomplete-option', { hasText: expectedText })
      .first();
    await expect(option).toBeVisible({ timeout: 25_000 });
    await option.click();
  }

  /** Navigate directly to Admin -> System Users and wait for table load. */
  async gotoUsersList(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/admin/viewSystemUsers', this.filterSection, {
      maxAttempts,
    });
    await this.waitForSpinnerToClear();
  }

  /** Navigate directly to Add System User page and wait for form ready. */
  async gotoAddUser(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/admin/saveSystemUser', this.saveButton, {
      maxAttempts,
    });
    await this.waitForSpinnerToClear();
  }

  /** Create a new Admin or ESS system user via the Add User form and confirm list redirect. */
  async createSystemUser(input: CreateUserInput): Promise<void> {
    if (!/\/admin\/saveSystemUser$/.test(this.page.url())) {
      await this.addButton.scrollIntoViewIfNeeded();
      await this.addButton.click({ noWaitAfter: true });
      await this.page.waitForURL(/\/admin\/saveSystemUser$/, {
        waitUntil: 'domcontentloaded',
        timeout: 35_000,
      });
      await this.waitForSpinnerToClear();
    }

    await this.selectDropdownOption('User Role', input.role);
    await this.selectEmployeeNameAutocomplete(input.employeeFirstName, input.employeeFullName);
    await this.selectDropdownOption('Status', input.status);

    const usernameInput = this.inputGroupByLabel('Username').locator('input');
    const passwordInput = this.inputGroupByLabel('Password').locator('input');
    const confirmInput = this.inputGroupByLabel('Confirm Password').locator('input');

    await this.clearAndFill(usernameInput, input.username);
    await this.clearAndFill(passwordInput, input.password);
    await this.clearAndFill(confirmInput, input.password);
    await expect(usernameInput).toHaveValue(input.username);

    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();
    await this.expectSuccessToast(/Successfully Saved/i);
    await this.page.waitForURL(/\/admin\/viewSystemUsers/, {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
    await this.waitForSpinnerToClear();
  }

  /** Submit a blank Add User form and assert inline "Required" messages appear across fields. */
  async expectRequiredErrorsOnBlankAddUser(): Promise<void> {
    await this.waitForSpinnerToClear();
    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();

    await expect(this.page).toHaveURL(/\/admin\/saveSystemUser/);
    for (const label of ['User Role', 'Employee Name', 'Status', 'Username', 'Password']) {
      await expect(this.inputGroupByLabel(label).locator('.oxd-input-field-error-message')).toHaveText(
        'Required'
      );
    }
    await expect(
      this.inputGroupByLabel('Confirm Password').locator('.oxd-input-field-error-message')
    ).toContainText(/Required|Passwords do not match/i);
  }

  /** Verify invalid username/password inline rules on Add User without saving. */
  async expectInvalidAddUserInputs(input: InvalidUserValidationInput): Promise<void> {
    const userGroup = this.inputGroupByLabel('Username');
    const userInput = userGroup.locator('input');
    await this.clearAndFill(userInput, input.shortUsername);
    await userInput.blur();
    await expect(userGroup.locator('.oxd-input-field-error-message')).toContainText(
      /Should be at least 5 characters/i
    );

    await this.clearAndFill(userInput, input.duplicateUsername);
    await userInput.blur();
    await expect(userGroup.locator('.oxd-input-field-error-message')).toContainText(
      /Already exists/i,
      { timeout: 20_000 }
    );

    const pwdGroup = this.inputGroupByLabel('Password');
    const pwdInput = pwdGroup.locator('input');
    await this.clearAndFill(pwdInput, input.weakPassword);
    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();
    await expect(pwdGroup.locator('.oxd-input-field-error-message')).toContainText(
      /Should have at least 7 characters|must contain/i
    );

    const confirmGroup = this.inputGroupByLabel('Confirm Password');
    const confirmInput = confirmGroup.locator('input');
    await this.clearAndFill(pwdInput, input.validPassword);
    await this.clearAndFill(confirmInput, input.mismatchedPassword);
    await confirmInput.blur();
    await expect(confirmGroup.locator('.oxd-input-field-error-message')).toContainText(
      /Passwords do not match/i
    );
  }

  /** Search System Users by exact Username in the filter panel. */
  async searchByUsername(username: string): Promise<void> {
    await this.ensureFilterExpanded();
    const usernameInput = this.filterSection
      .locator('.oxd-input-group', {
        has: this.page.locator('.oxd-label', { hasText: /^\s*Username\s*$/ }),
      })
      .locator('input');
    await this.clearAndFill(usernameInput, username);

    await this.searchButton.scrollIntoViewIfNeeded();
    await this.searchButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Filter System Users using Role, Employee Name autocomplete, and Status dropdowns. */
  async filterUsers(criteria: {
    role?: UserRoleOption;
    employeeFirstName?: string;
    employeeFullName?: string;
    status?: UserStatusOption;
  }): Promise<void> {
    await this.ensureFilterExpanded();
    if (criteria.role) {
      await this.selectDropdownOption('User Role', criteria.role);
    }
    if (criteria.employeeFirstName && criteria.employeeFullName) {
      await this.selectEmployeeNameAutocomplete(
        criteria.employeeFirstName,
        criteria.employeeFullName
      );
    }
    if (criteria.status) {
      await this.selectDropdownOption('Status', criteria.status);
    }

    await this.searchButton.scrollIntoViewIfNeeded();
    await this.searchButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Reset all System Users search/filter controls back to defaults. */
  async resetSearchFilters(): Promise<void> {
    await this.ensureFilterExpanded();
    await this.resetButton.scrollIntoViewIfNeeded();
    await this.resetButton.click();
    await this.waitForSpinnerToClear();
  }

  /** Locate the System Users table row/card containing `username`. */
  rowByUsername(username: string): Locator {
    return this.tableRows.filter({ hasText: username }).first();
  }

  /** Assert row visibility and expected Role/Status text for a username in System Users. */
  async expectRowDetails(
    username: string,
    expected: { role?: UserRoleOption; status?: UserStatusOption }
  ): Promise<void> {
    const row = this.rowByUsername(username);
    await expect(row).toBeVisible();
    if (expected.role) {
      await expect(row).toContainText(expected.role);
    }
    if (expected.status) {
      await expect(row).toContainText(expected.status);
    }
  }

  /** Open an existing user's Edit form from the System Users table, waiting for Vue hydration. */
  async openEditUserFromList(username: string): Promise<void> {
    await this.searchByUsername(username);
    const row = this.rowByUsername(username);
    await expect(row).toBeVisible();

    const editButton = row.locator('button:has(.bi-pencil-fill)');
    const userHydratedPromise = this.page
      .waitForResponse(
        (res) =>
          res.request().method() === 'GET' && /\/api\/v2\/admin\/users\/\d+/.test(res.url()),
        { timeout: 30_000 }
      )
      .catch(() => undefined);

    await withRetry(
      async (attempt) => {
        if (/\/admin\/saveSystemUser\/\d+/.test(this.page.url())) {
          if (attempt > 1) {
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
          }
          await expect(this.inputGroupByLabel('Username').locator('input')).not.toHaveValue('', {
            timeout: 20_000,
          });
          return;
        }
        await editButton.scrollIntoViewIfNeeded();
        await editButton.click({ noWaitAfter: true });
        await this.page.waitForURL(/\/admin\/saveSystemUser\/\d+/, {
          waitUntil: 'domcontentloaded',
          timeout: 40_000,
        });
        await userHydratedPromise;
        await this.waitForSpinnerToClear();
        await expect(this.inputGroupByLabel('Username').locator('input')).not.toHaveValue('', {
          timeout: 20_000,
        });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1_500,
        shouldRetry: () => !this.page.isClosed(),
      }
    );

    await this.page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    );
  }

  /** Update Role, Status, Username, and optional password on the Edit User page and save. */
  async editSystemUser(updates: EditUserInput): Promise<void> {
    await this.waitForSpinnerToClear();

    if (updates.role) {
      await this.selectDropdownOption('User Role', updates.role);
    }
    if (updates.status) {
      await this.selectDropdownOption('Status', updates.status);
    }
    if (updates.newUsername) {
      const usernameInput = this.inputGroupByLabel('Username').locator('input');
      await this.clearAndFill(usernameInput, updates.newUsername);
      await expect(usernameInput).toHaveValue(updates.newUsername);
    }
    if (updates.newPassword) {
      const changePwdGroup = this.inputGroupByLabel('Change Password ?');
      const checkbox = changePwdGroup.locator('.oxd-checkbox-input');
      await checkbox.scrollIntoViewIfNeeded();
      await checkbox.click();

      const passwordInput = this.inputGroupByLabel('Password').locator('input');
      const confirmInput = this.inputGroupByLabel('Confirm Password').locator('input');
      await this.clearAndFill(passwordInput, updates.newPassword);
      await this.clearAndFill(confirmInput, updates.newPassword);
    }

    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();
    await this.expectSuccessToast(/Successfully Updated/i);
    await this.page.waitForURL(/\/admin\/viewSystemUsers/, {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
    await this.waitForSpinnerToClear();
  }

  /** Verify the active logged-in Admin account cannot be self-deleted from System Users. */
  async expectAdminSelfDeleteProtected(adminUsername: string): Promise<void> {
    await this.searchByUsername(adminUsername);
    const row = this.rowByUsername(adminUsername);
    await expect(row).toBeVisible();

    const trashBtn = row.locator('button:has(.bi-trash)');
    await trashBtn.scrollIntoViewIfNeeded();
    await trashBtn.click();

    await expect(this.confirmDialog).toHaveCount(0);
    await expect(this.toastContainer.locator('.oxd-toast--error')).toContainText(
      /Cannot be deleted/i
    );
  }

  /** Click Trash on a user row and click "No, Cancel" to verify the record is preserved. */
  async cancelDeleteUserRow(username: string): Promise<void> {
    const row = this.rowByUsername(username);
    await expect(row).toBeVisible();
    const trashBtn = row.locator('button:has(.bi-trash)');
    await trashBtn.scrollIntoViewIfNeeded();
    await trashBtn.click();

    await expect(this.confirmDialog).toBeVisible();
    await this.cancelDeleteButton.click();
    await expect(this.confirmDialog).toBeHidden();
    await expect(row).toBeVisible();
  }

  /** Click Trash on a user row and confirm "Yes, Delete". */
  async deleteUserRow(username: string): Promise<void> {
    const row = this.rowByUsername(username);
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

  /**
   * Select checkboxes for multiple users and confirm bulk deletion.
   * On mobile viewports (<768px), temporarily widen so desktop table checkboxes render cleanly.
   */
  async bulkDeleteUsersByUsernames(usernames: string[]): Promise<void> {
    const originalViewport = this.page.viewportSize();
    const needsWideLayout = (originalViewport?.width ?? 1280) < 768;

    if (needsWideLayout) {
      await this.page.setViewportSize({
        width: 1024,
        height: originalViewport?.height ?? 851,
      });
      await expect(this.page.locator('.oxd-table-card.--mobile')).toHaveCount(0);
      await expect(this.tableRows.first().locator('.oxd-checkbox-input')).toBeVisible();
    }

    try {
      for (const username of usernames) {
        const row = this.rowByUsername(username);
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
