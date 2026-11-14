import { expect, Locator, Page } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly pageHeading: Locator;
  readonly userDropdown: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageHeading = page.getByRole('heading', { name: 'Dashboard' });
    this.userDropdown = page.locator('.oxd-userdropdown-tab');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/dashboard\/index/);
    await expect(this.pageHeading).toBeVisible();
    await expect(this.userDropdown).toBeVisible();
  }
}
