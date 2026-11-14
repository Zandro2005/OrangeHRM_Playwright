import { Locator, Page } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.getByRole('textbox', { name: 'Username' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.loginButton = page.getByRole('button', { name: 'Login' });
  }

  /** Navigate to the login page, retrying transient demo server stalls or 5xx responses. */
  async goto(maxAttempts = 3): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Step 1: Navigate with a bounded timeout so stalled requests fail fast enough to retry
        const response = await this.page.goto('/web/index.php/auth/login', {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        if (response && response.status() >= 500) {
          throw new Error(`Login page returned HTTP ${response.status()}`);
        }

        // Step 2: Confirm the Vue login form finished mounting before continuing
        await this.usernameInput.waitFor({ state: 'visible', timeout: 25_000 });
        return;
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts || this.page.isClosed()) {
          throw error;
        }
        await this.page.waitForTimeout(1_500);
      }
    }

    throw lastError;
  }

  async login(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }

  /** Focus Username and submit credentials purely with Tab and Enter keys. */
  async loginWithKeyboard(username: string, password: string): Promise<void> {
    // Step 1: Focus Username explicitly and enter username via keyboard
    await this.usernameInput.focus();
    await this.page.keyboard.type(username);

    // Step 2: Move focus to Password via Tab, type password, and submit with Enter
    await this.page.keyboard.press('Tab');
    await this.page.keyboard.type(password);
    await this.page.keyboard.press('Enter');
  }
}
