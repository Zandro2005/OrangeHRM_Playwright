import { expect, Locator, Page } from '@playwright/test';
import { gotoWithRetry, resetOrangeHrmThemeVariables, withRetry } from '../utils/apiHelpers';

export type LoginField = 'Username' | 'Password';

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly invalidCredentialsAlert: Locator;
  readonly forgotPasswordLink: Locator;
  readonly resetPasswordButton: Locator;
  readonly resetSuccessHeading: Locator;
  readonly requiredErrors: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.getByRole('textbox', { name: 'Username' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.loginButton = page.getByRole('button', { name: 'Login' });
    this.invalidCredentialsAlert = page.getByRole('alert');
    this.forgotPasswordLink = page.getByText('Forgot your password?');
    this.resetPasswordButton = page.getByRole('button', { name: 'Reset Password' });
    this.resetSuccessHeading = page.getByRole('heading', {
      name: /Reset Password link sent successfully/i,
    });
    this.requiredErrors = page.locator('.oxd-input-field-error-message');
  }

  private requiredErrorFor(field: LoginField): Locator {
    const input = field === 'Username' ? this.usernameInput : this.passwordInput;
    return this.page
      .locator('.oxd-input-group', { has: input })
      .locator('.oxd-input-field-error-message');
  }

  /** Navigate to the login page, retrying transient demo server stalls or 5xx responses. */
  async goto(maxAttempts = 4): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/auth/login', this.usernameInput, {
      maxAttempts,
    });
  }

  /**
   * Submit credentials and automatically retry if OrangeHRM's demo server transiently
   * redirects /auth/validate back to /auth/login with "Unexpected error occurred".
   */
  private async submitCredentialsWithRetry(
    username: string,
    password: string,
    submitAction: () => Promise<void>
  ): Promise<void> {
    if (!username || !password) {
      await submitAction();
      return;
    }

    await withRetry(
      async (attempt) => {
        if (attempt > 1) {
          if (/\/web\/index\.php\//.test(this.page.url()) && !/\/auth\//.test(this.page.url())) {
            return;
          }
          await this.goto();
        }

        const validateResponsePromise = this.page.waitForResponse(
          (res) => res.url().includes('/auth/validate') && res.request().method() === 'POST',
          { timeout: 22_000 }
        );

        await submitAction();

        const validateResponse = await validateResponsePromise;
        if (validateResponse.status() >= 500) {
          throw new Error(`POST /auth/validate returned HTTP ${validateResponse.status()}`);
        }

        const deadline = Date.now() + 22_000;
        while (Date.now() < deadline) {
          if (/\/web\/index\.php\/(?!auth\/)/.test(this.page.url())) {
            return;
          }

          if (await this.invalidCredentialsAlert.isVisible().catch(() => false)) {
            const alertText =
              (await this.invalidCredentialsAlert.textContent().catch(() => ''))?.trim() ?? '';
            if (/Invalid credentials|Account disabled/i.test(alertText)) {
              return;
            }
            if (alertText.length > 0) {
              throw new Error(`Transient server login error: "${alertText}"`);
            }
          }

          await this.page.waitForTimeout(250);
        }

        throw new Error(
          `Login submission did not reach Dashboard or Invalid credentials within 22s (url: ${this.page.url()})`
        );
      },
      {
        maxAttempts: 4,
        baseDelayMs: 1_500,
        shouldRetry: () => !this.page.isClosed(),
      }
    );
  }

  async login(username: string, password: string): Promise<void> {
    await this.submitCredentialsWithRetry(username, password, async () => {
      await this.usernameInput.fill(username);
      await this.passwordInput.fill(password);
      await this.loginButton.click();
    });
  }

  /** Focus Username and submit credentials purely with Tab and Enter keys. */
  async loginWithKeyboard(username: string, password: string): Promise<void> {
    await this.submitCredentialsWithRetry(username, password, async () => {
      // Step 1: Focus Username explicitly and enter username via keyboard
      await this.usernameInput.focus();
      await this.page.keyboard.type(username);

      // Step 2: Move focus to Password via Tab, type password, and submit with Enter
      await this.page.keyboard.press('Tab');
      await this.page.keyboard.type(password);
      await this.page.keyboard.press('Enter');
    });
  }

  /** Assert the invalid credentials alert banner displays and URL stays on login. */
  async expectInvalidCredentialsError(): Promise<void> {
    await expect(this.page).toHaveURL(/\/auth\/login/);
    await expect(this.invalidCredentialsAlert).toBeVisible();
    await expect(this.invalidCredentialsAlert).toContainText('Invalid credentials');
  }

  /** Assert the disabled-account alert banner displays and URL stays on login. */
  async expectAccountDisabledError(): Promise<void> {
    await expect(this.page).toHaveURL(/\/auth\/login/);
    await expect(this.invalidCredentialsAlert).toBeVisible();
    await expect(this.invalidCredentialsAlert).toContainText(/Account disabled/i);
  }

  /** Assert inline "Required" validation displays beneath the expected login field(s). */
  async expectRequiredValidation(expectedFields: LoginField[]): Promise<void> {
    await expect(this.page).toHaveURL(/\/auth\/login/);
    await expect(this.requiredErrors).toHaveCount(expectedFields.length);

    for (const field of expectedFields) {
      const error = this.requiredErrorFor(field);
      await expect(error).toBeVisible();
      await expect(error).toHaveText('Required');
    }
  }

  /** Assert Password input keeps characters masked via type="password". */
  async expectPasswordMasked(): Promise<void> {
    await expect(this.passwordInput).toHaveAttribute('type', 'password');
  }

  /** Navigate to Forgot Password and submit username, verifying confirmation page renders. */
  async completeForgotPasswordFlow(username: string): Promise<void> {
    await this.forgotPasswordLink.click();
    await expect(this.page).toHaveURL(/\/auth\/requestPasswordResetCode/);
    await expect(this.usernameInput).toBeVisible();

    let submittedBody = '';
    // Intercept the SMTP reset submission because OrangeHRM Demo's mail gateway times out with 504;
    // return HTTP 200 client redirect because WebKit forbids route.fulfill() with 3xx statuses.
    const resetEndpoint = '**/auth/requestResetPassword';
    await this.page.route(resetEndpoint, async (route) => {
      submittedBody = route.request().postData() ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<script>window.location.replace("/web/index.php/auth/sendPasswordReset");</script>',
      });
    });

    try {
      await this.usernameInput.fill(username);
      await this.resetPasswordButton.click();
      await expect(this.page).toHaveURL(/\/auth\/sendPasswordReset/);
      expect(submittedBody).toContain(`username=${encodeURIComponent(username)}`);
      await expect(this.resetSuccessHeading).toBeVisible();
    } finally {
      if (!this.page.isClosed()) {
        await this.page.unroute(resetEndpoint);
      }
    }
  }

  /** Verify keyboard Tab progression moves cleanly from Username to Password to Login. */
  async expectKeyboardTabOrder(): Promise<void> {
    await this.usernameInput.focus();
    await expect(this.usernameInput).toBeFocused();

    await this.page.keyboard.press('Tab');
    await expect(this.passwordInput).toBeFocused();

    await this.page.keyboard.press('Tab');
    await expect(this.loginButton).toBeFocused();
  }

  /** Wait for web fonts and branding images before visual snapshot comparison. */
  async waitForVisualStability(): Promise<void> {
    await this.usernameInput.waitFor({ state: 'visible' });
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
}
