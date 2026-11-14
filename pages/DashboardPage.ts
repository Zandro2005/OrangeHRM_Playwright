import { expect, Locator, Page } from '@playwright/test';
import { gotoWithRetry } from '../utils/apiHelpers';

export class DashboardPage {
  readonly page: Page;
  readonly pageHeading: Locator;
  readonly userDropdown: Locator;
  readonly mobileMenuButton: Locator;
  readonly logoutMenuItem: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageHeading = page.getByRole('heading', { name: 'Dashboard' });
    this.userDropdown = page.locator('.oxd-userdropdown-tab');
    this.mobileMenuButton = page.locator('.oxd-topbar-header-hamburger');
    this.logoutMenuItem = page.getByRole('menuitem', { name: 'Logout' });
  }

  private navLink(menuName: string): Locator {
    return this.page.getByRole('link', { name: menuName, exact: true });
  }

  /** Navigate directly to Dashboard with transient network retry handling. */
  async goto(maxAttempts = 4): Promise<void> {
    await gotoWithRetry(this.page, '/web/index.php/dashboard/index', this.pageHeading, {
      maxAttempts,
    });
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

  /** Log out via the user dropdown menu and verify redirect back to Login. */
  async logout(): Promise<void> {
    await this.userDropdown.click();
    await this.logoutMenuItem.click();
    await expect(this.page).toHaveURL(/\/auth\/login/);
  }

  /** Attempt direct access to a protected route and verify redirect back to Login. */
  async expectProtectedRouteBlocked(route = '/web/index.php/dashboard/index'): Promise<void> {
    await gotoWithRetry(this.page, route);
    await expect(this.page).toHaveURL(/\/auth\/login/);
    await expect(this.page.getByRole('textbox', { name: 'Username' })).toBeVisible();
  }
}
