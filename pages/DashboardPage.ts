import { expect, Locator, Page } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly pageHeading: Locator;
  readonly userDropdown: Locator;
  readonly mobileMenuButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageHeading = page.getByRole('heading', { name: 'Dashboard' });
    this.userDropdown = page.locator('.oxd-userdropdown-tab');
    this.mobileMenuButton = page.locator('.oxd-topbar-header-hamburger');
  }

  private navLink(menuName: string): Locator {
    return this.page.getByRole('link', { name: menuName, exact: true });
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/dashboard\/index/);
    await expect(this.pageHeading).toBeVisible();
    await expect(this.userDropdown).toBeVisible();
  }

  /** Assert Dashboard loaded with ESS sidebar permissions (self-service visible, Admin hidden). */
  async expectEssViewLoaded(visibleMenus: string[], hiddenMenus: string[]): Promise<void> {
    await this.expectLoaded();

    // Open mobile navigation drawer when present so sidebar links are in view across viewports
    if (await this.mobileMenuButton.isVisible()) {
      await this.mobileMenuButton.click();
    }

    for (const menu of visibleMenus) {
      await expect(this.navLink(menu)).toBeVisible();
    }

    for (const menu of hiddenMenus) {
      await expect(this.navLink(menu)).toHaveCount(0);
    }
  }
}
