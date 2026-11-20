import { expect, Locator, Page } from '@playwright/test';
import { gotoWithRetry, resetOrangeHrmThemeVariables } from '../utils/apiHelpers';

export type AdminConfigSubpage =
  | 'Email Configuration'
  | 'Localization'
  | 'Modules'
  | 'Corporate Branding';

export type SendingMethodOption = 'SECURE SMTP' | 'SMTP' | 'Sendmail';

interface SubpageTarget {
  urlPattern: RegExp;
  readyLocator: () => Locator;
}

export class SettingsPage {
  readonly page: Page;
  readonly saveButton: Locator;
  readonly resetToDefaultButton: Locator;
  readonly previewButton: Locator;
  readonly publishButton: Locator;
  readonly toastContainer: Locator;
  readonly colorPickerPopover: Locator;
  readonly sidepanel: Locator;
  readonly mobileMenuButton: Locator;
  readonly mobileDrawerCloseButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.saveButton = page
      .locator('.orangehrm-card-container form.oxd-form button[type="submit"]')
      .first();
    this.resetToDefaultButton = page.getByRole('button', { name: 'Reset to Default' });
    this.previewButton = page.getByRole('button', { name: 'Preview' });
    this.publishButton = page.getByRole('button', { name: 'Publish' });
    this.toastContainer = page.locator('#oxd-toaster_1');
    this.colorPickerPopover = page.locator('.oxd-color-picker');
    this.sidepanel = page.locator('.oxd-sidepanel');
    this.mobileMenuButton = page.locator('.oxd-topbar-header-hamburger');
    this.mobileDrawerCloseButton = page.locator('.oxd-sidepanel-header-close');
  }

  /** Wait for all active loading spinners to clear within a scope. */
  async waitForSpinnerToClear(scope: Page | Locator = this.page): Promise<void> {
    await expect(scope.locator('.oxd-loading-spinner')).toHaveCount(0, { timeout: 30_000 });
    const rawI18nUpgrade = this.page.locator('a, button', { hasText: 'general.upgrade' }).first();
    if (await rawI18nUpgrade.isVisible().catch(() => false)) {
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
      await expect(scope.locator('.oxd-loading-spinner')).toHaveCount(0, { timeout: 30_000 });
    }
  }

  /** Locate an `.oxd-input-group` matching an exact label text. */
  inputGroupByLabel(label: string): Locator {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page
      .locator('.oxd-input-group', {
        has: this.page.locator('.oxd-label', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) }),
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

  /** Assert an error toast containing `message` becomes visible. */
  async expectErrorToast(message: string | RegExp): Promise<void> {
    const errorToast = this.toastContainer.locator('.oxd-toast--error');
    await expect(errorToast).toBeVisible({ timeout: 20_000 });
    await expect(errorToast).toContainText(message);
  }

  /** Navigate directly to Admin -> Configuration -> Email Configuration. */
  async gotoEmailConfiguration(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(
      this.page,
      '/web/index.php/admin/listMailConfiguration',
      this.saveButton,
      { maxAttempts }
    );
    await this.waitForSpinnerToClear();
  }

  /** Navigate directly to Admin -> Configuration -> Localization and wait for dropdown hydration. */
  async gotoLocalization(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/admin/localization', this.saveButton, {
      maxAttempts,
    });
    await this.waitForSpinnerToClear();
    await expect(this.inputGroupByLabel('Language').locator('.oxd-select-text-input')).not.toHaveText(
      /^\s*$/,
      { timeout: 25_000 }
    );
  }

  /** Navigate directly to Admin -> Configuration -> Modules and wait for switch hydration. */
  async gotoModules(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/admin/viewModules', this.saveButton, {
      maxAttempts,
    });
    await this.waitForSpinnerToClear();
    await expect(this.page.locator('.orangehrm-module-field-row').first()).toBeVisible({
      timeout: 25_000,
    });
  }

  /** Navigate directly to Admin -> Corporate Branding and wait for color controls. */
  async gotoCorporateBranding(maxAttempts = 3): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/admin/addTheme', this.publishButton, {
      maxAttempts,
    });
    await this.waitForSpinnerToClear();
  }

  /** Navigate across Configuration and Corporate Branding subpages via topbar (desktop & mobile). */
  async navigateViaAdminTopbar(subpage: AdminConfigSubpage): Promise<void> {
    const targets: Record<AdminConfigSubpage, SubpageTarget> = {
      'Email Configuration': {
        urlPattern: /\/admin\/listMailConfiguration/,
        readyLocator: () => this.saveButton,
      },
      Localization: {
        urlPattern: /\/admin\/localization/,
        readyLocator: () => this.saveButton,
      },
      Modules: {
        urlPattern: /\/admin\/viewModules/,
        readyLocator: () => this.saveButton,
      },
      'Corporate Branding': {
        urlPattern: /\/admin\/addTheme/,
        readyLocator: () => this.publishButton,
      },
    };

    const topbarNav = this.page.locator('.oxd-topbar-body-nav');
    await expect(topbarNav.locator('.oxd-topbar-body-nav-tab').first()).toBeVisible({
      timeout: 25_000,
    });

    const escaped = subpage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactRegex = new RegExp(`^\\s*${escaped}\\s*$`);

    if (subpage === 'Corporate Branding') {
      const directLink = topbarNav.locator('a', { hasText: exactRegex }).first();
      if (!(await directLink.isVisible())) {
        const moreToggle = topbarNav
          .locator('.oxd-topbar-body-nav-tab', {
            has: this.page.locator('.oxd-topbar-body-nav-tab-item', { hasText: /^\s*More\s*$/ }),
          })
          .first();
        await expect(moreToggle).toBeVisible();
        await moreToggle.click();
      }
      await expect(directLink).toBeVisible();
      await directLink.click({ noWaitAfter: true });
    } else {
      const configTab = topbarNav
        .locator('.oxd-topbar-body-nav-tab', {
          has: this.page.locator('.oxd-topbar-body-nav-tab-item', {
            hasText: /^\s*Configuration\s*$/,
          }),
        })
        .first();

      if (await configTab.isVisible()) {
        await configTab.click();
        const menuItem = configTab.locator('.oxd-dropdown-menu a', { hasText: exactRegex }).first();
        await expect(menuItem).toBeVisible();
        await menuItem.click({ noWaitAfter: true });
      } else {
        const moreTab = topbarNav
          .locator('.oxd-topbar-body-nav-tab', {
            has: this.page.locator('.oxd-topbar-body-nav-tab-item', { hasText: /^\s*More\s*$/ }),
          })
          .first();
        await expect(moreTab).toBeVisible();
        await moreTab.click();

        const configInMore = moreTab
          .locator('a, li', { hasText: /^\s*Configuration\s*$/ })
          .first();
        await expect(configInMore).toBeVisible();
        await configInMore.click();

        const accordionLink = moreTab
          .locator('.oxd-topbar-body-nav-tab-accordian a', { hasText: exactRegex })
          .first();
        await expect(accordionLink).toBeVisible();
        await accordionLink.click({ noWaitAfter: true });
      }
    }

    const { urlPattern, readyLocator } = targets[subpage];
    await this.page.waitForURL(urlPattern, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await expect(readyLocator()).toBeVisible({ timeout: 25_000 });
    await expect(readyLocator()).toBeEnabled();
    await this.waitForSpinnerToClear();
  }

  /** Select an option in an OXD dropdown labeled `label` matching `textOrPattern`. */
  private async selectDropdownByMatch(label: string, textOrPattern: string | RegExp): Promise<void> {
    const group = this.inputGroupByLabel(label);
    const trigger = group.locator('.oxd-select-text');
    await trigger.scrollIntoViewIfNeeded();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dropdown = this.page.locator('.oxd-select-dropdown');
    await expect(dropdown).toBeVisible();
    const targetOption = dropdown
      .getByRole('option')
      .filter({ hasText: textOrPattern })
      .first();
    await expect(targetOption).toBeVisible({ timeout: 20_000 });
    await targetOption.click();
    await expect(dropdown).toBeHidden();
  }

  /** Select Language and/or Date Format on Configuration -> Localization. */
  async selectLocalizationOptions(options: {
    language?: string;
    dateFormatPrefix?: string;
  }): Promise<void> {
    await this.waitForSpinnerToClear();
    await expect(
      this.inputGroupByLabel('Language').locator('.oxd-select-text-input')
    ).not.toHaveText(/^\s*(-- Select --)?\s*$/, { timeout: 25_000 });

    if (options.language) {
      const escapedLang = options.language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await this.selectDropdownByMatch('Language', new RegExp(`^\\s*${escapedLang}\\s*$`));
    }
    if (options.dateFormatPrefix) {
      const escapedPrefix = options.dateFormatPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await this.selectDropdownByMatch('Date Format', new RegExp(`^\\s*${escapedPrefix}`, 'i'));
    }
  }

  /** Save Localization settings and wait for confirmation toast + reload hydration. */
  async saveLocalization(): Promise<void> {
    await this.saveButton.scrollIntoViewIfNeeded();
    const putPromise = this.page.waitForResponse(
      (res) => res.request().method() === 'PUT' && res.url().includes('/api/v2/admin/localization'),
      { timeout: 25_000 }
    );
    await this.saveButton.click();
    await putPromise;
    await this.expectSuccessToast(/Successfully Updated|Successfully Saved/i);
    await this.page.waitForLoadState('load').catch(() => undefined);
    await this.waitForSpinnerToClear();
    await expect(this.inputGroupByLabel('Language').locator('.oxd-select-text-input')).not.toHaveText(
      /^\s*$/,
      { timeout: 25_000 }
    );
  }

  /** Assert current Language and Date Format values on Configuration -> Localization. */
  async expectLocalizationValues(expected: {
    language?: string;
    dateFormatPrefix?: string;
  }): Promise<void> {
    await this.waitForSpinnerToClear();
    if (expected.language) {
      await expect(
        this.inputGroupByLabel('Language').locator('.oxd-select-text-input')
      ).toHaveText(expected.language, { timeout: 20_000 });
    }
    if (expected.dateFormatPrefix) {
      const escapedPrefix = expected.dateFormatPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(
        this.inputGroupByLabel('Date Format').locator('.oxd-select-text-input')
      ).toHaveText(new RegExp(`^\\s*${escapedPrefix}`, 'i'), { timeout: 20_000 });
    }
  }

  /** Select Sending Method radio option on Configuration -> Email Configuration. */
  async selectSendingMethod(method: SendingMethodOption): Promise<void> {
    const escaped = method.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const radioWrapper = this.page
      .locator('.oxd-radio-wrapper', { hasText: new RegExp(`^\\s*${escaped}\\s*$`) })
      .first();
    await radioWrapper.scrollIntoViewIfNeeded();
    await expect(radioWrapper).toBeVisible();
    await radioWrapper.locator('span.oxd-radio-input').click();
  }

  /** Submit Email Configuration with blank Mail Sent As & SMTP Host/Port and verify Required errors. */
  async expectEmailBlankRequiredErrors(): Promise<void> {
    await this.waitForSpinnerToClear();
    await this.selectSendingMethod('SECURE SMTP');

    for (const label of ['Mail Sent As', 'SMTP Host', 'SMTP Port']) {
      await this.clearAndFill(this.inputGroupByLabel(label).locator('input'), '');
    }

    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();
    await expect(this.page).toHaveURL(/\/admin\/listMailConfiguration/);

    await expect(
      this.inputGroupByLabel('Mail Sent As').locator('.oxd-input-field-error-message')
    ).toHaveText('Required');
    await expect(
      this.inputGroupByLabel('SMTP Host').locator('.oxd-input-field-error-message')
    ).toHaveText('Required');
  }

  /** Submit invalid email format & non-numeric port on Email Configuration and verify inline errors. */
  async expectEmailInvalidFormatAndPortErrors(
    invalidEmail: string,
    invalidPort: string,
    validHost = 'smtp.example.com'
  ): Promise<void> {
    await this.selectSendingMethod('SECURE SMTP');
    await this.clearAndFill(this.inputGroupByLabel('Mail Sent As').locator('input'), invalidEmail);
    await this.clearAndFill(this.inputGroupByLabel('SMTP Host').locator('input'), validHost);
    await this.clearAndFill(this.inputGroupByLabel('SMTP Port').locator('input'), invalidPort);

    await this.saveButton.scrollIntoViewIfNeeded();
    await this.saveButton.click();
    await expect(this.page).toHaveURL(/\/admin\/listMailConfiguration/);

    await expect(
      this.inputGroupByLabel('Mail Sent As').locator('.oxd-input-field-error-message')
    ).toContainText(/Expected format:\s*admin@example\.com/i);
    await expect(
      this.inputGroupByLabel('SMTP Port').locator('.oxd-input-field-error-message')
    ).toContainText(/Should not exceed 10 characters/i);
  }

  /** Return the `.orangehrm-module-field-row` container matching `label`. */
  moduleRowByLabel(label: string): Locator {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page
      .locator('.orangehrm-module-field-row', {
        has: this.page.locator('.orangehrm-module-field-label', {
          hasText: new RegExp(`^\\s*${escaped}\\s*$`),
        }),
      })
      .first();
  }

  /** Toggle an optional module switch ON or OFF on Configuration -> Modules. */
  async setModuleEnabled(label: string, enabled: boolean): Promise<void> {
    await this.waitForSpinnerToClear();
    await expect(
      this.moduleRowByLabel('Admin Module').locator('input[type="checkbox"]')
    ).toBeChecked({ timeout: 25_000 });

    const row = this.moduleRowByLabel(label);
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();

    const checkbox = row.locator('input[type="checkbox"]');
    const isChecked = await checkbox.isChecked();
    if (isChecked !== enabled) {
      await row.locator('.oxd-switch-input').click();
    }
    await expect(checkbox).toBeChecked({ checked: enabled });
  }

  /** Save Module Configuration changes and wait for confirmation toast + reload hydration. */
  async saveModules(): Promise<void> {
    await this.saveButton.scrollIntoViewIfNeeded();
    const putPromise = this.page.waitForResponse(
      (res) => res.request().method() === 'PUT' && res.url().includes('/api/v2/admin/modules'),
      { timeout: 25_000 }
    );
    await this.saveButton.click();
    await putPromise;
    await this.expectSuccessToast(/Successfully Saved/i);
    await this.page.waitForLoadState('load').catch(() => undefined);
    await this.waitForSpinnerToClear();
    await expect(
      this.moduleRowByLabel('Admin Module').locator('input[type="checkbox"]')
    ).toBeChecked({ timeout: 25_000 });
  }

  /** Verify whether a module link is visible or hidden in the sidebar across desktop & mobile. */
  async expectSidebarModuleVisibility(menuName: string, visible: boolean): Promise<void> {
    const isMobile =
      (this.page.viewportSize()?.width ?? 1280) < 1024 ||
      (await this.mobileMenuButton.isVisible());

    if (isMobile) {
      await expect(this.mobileMenuButton).toBeVisible();
      const sidepanelClass = (await this.sidepanel.getAttribute('class')) ?? '';
      if (!sidepanelClass.includes('toggled')) {
        await this.mobileMenuButton.click();
        await expect(this.sidepanel).toHaveClass(/toggled/);
      }
    }

    const link = this.page.getByRole('link', { name: menuName, exact: true });
    if (visible) {
      await expect(link).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(link).toHaveCount(0);
    }

    if (isMobile) {
      const sidepanelClass = (await this.sidepanel.getAttribute('class')) ?? '';
      if (sidepanelClass.includes('toggled')) {
        await this.mobileDrawerCloseButton.click();
        await expect(this.sidepanel).not.toHaveClass(/toggled/);
      }
    }
  }

  /** Set the Corporate Branding Primary Color via its HEX color picker popover. */
  async setPrimaryColorHex(hexValue: string): Promise<void> {
    await this.waitForSpinnerToClear();
    const colorGroup = this.inputGroupByLabel('Primary Color');
    const colorTrigger = colorGroup.locator('.oxd-color-input');
    await colorTrigger.scrollIntoViewIfNeeded();
    await expect(colorTrigger).toBeVisible();
    await colorTrigger.click();

    await expect(this.colorPickerPopover).toBeVisible();
    const hexInput = this.colorPickerPopover.locator('input.oxd-input');
    await this.clearAndFill(hexInput, hexValue);
    await hexInput.press('Enter');

    if (await this.colorPickerPopover.isVisible()) {
      await this.page.getByRole('heading', { name: 'Corporate Branding' }).click();
    }
    await expect(this.colorPickerPopover).toBeHidden();
  }

  /** Return the computed background-color CSS value of the Primary Color preview swatch. */
  async getPrimaryColorPreviewBackgroundColor(): Promise<string> {
    const preview = this.inputGroupByLabel('Primary Color').locator('.oxd-color-input-preview');
    await expect(preview).toBeVisible();
    return preview.evaluate((el) => getComputedStyle(el).backgroundColor);
  }

  /** Publish Corporate Branding changes and wait for confirmation toast + reload to settle. */
  async publishBranding(): Promise<void> {
    await this.publishButton.scrollIntoViewIfNeeded();
    await Promise.all([
      this.expectSuccessToast(/Successfully Saved/i),
      this.publishButton.click(),
    ]);
    await this.waitForSpinnerToClear();
    await expect(this.publishButton).toBeVisible({ timeout: 25_000 });
  }

  /** Reset Corporate Branding theme back to OrangeHRM defaults and verify primary color reverts. */
  async resetBrandingToDefault(expectedDefaultRgb = 'rgb(255, 123, 29)'): Promise<void> {
    await this.resetToDefaultButton.scrollIntoViewIfNeeded();
    const resetResponsePromise = this.page
      .waitForResponse(
        (res) => res.request().method() === 'DELETE' && res.url().includes('/api/v2/admin/theme'),
        { timeout: 25_000 }
      )
      .catch(() => undefined);

    await this.resetToDefaultButton.click();
    await resetResponsePromise;
    await this.waitForSpinnerToClear();
    await expect(this.publishButton).toBeVisible({ timeout: 25_000 });
    await expect
      .poll(() => this.getPrimaryColorPreviewBackgroundColor(), { timeout: 20_000 })
      .toBe(expectedDefaultRgb);
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
