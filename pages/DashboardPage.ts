import { expect, Locator, Page } from '@playwright/test';
import { gotoWithRetry, resetOrangeHrmThemeVariables, withRetry } from '../utils/apiHelpers';

export class DashboardPage {
  static readonly CORE_WIDGET_TITLES = [
    'Time at Work',
    'My Actions',
    'Quick Launch',
    'Buzz Latest Posts',
    'Employees on Leave Today',
  ] as const;

  static readonly CHART_WIDGET_TITLES = [
    'Employee Distribution by Sub Unit',
    'Employee Distribution by Location',
  ] as const;

  static readonly QUICK_LAUNCH_TITLES = [
    'Assign Leave',
    'Leave List',
    'Timesheets',
    'Apply Leave',
    'My Leave',
    'My Timesheet',
  ] as const;

  readonly page: Page;
  readonly pageHeading: Locator;
  readonly userDropdown: Locator;
  readonly mobileMenuButton: Locator;
  readonly logoutMenuItem: Locator;
  readonly sidepanel: Locator;
  readonly sidebarSearchInput: Locator;
  readonly sidebarCollapseButton: Locator;
  readonly mobileDrawerCloseButton: Locator;
  readonly aboutMenuItem: Locator;
  readonly aboutDialog: Locator;
  readonly aboutDialogCloseButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageHeading = page.getByRole('heading', { name: 'Dashboard' });
    this.userDropdown = page.locator('.oxd-userdropdown-tab');
    this.mobileMenuButton = page.locator('.oxd-topbar-header-hamburger');
    this.logoutMenuItem = page.getByRole('menuitem', { name: 'Logout' });
    this.sidepanel = page.locator('.oxd-sidepanel');
    this.sidebarSearchInput = page.locator('.oxd-main-menu-search input');
    this.sidebarCollapseButton = page.locator('.oxd-main-menu-button');
    this.mobileDrawerCloseButton = page.locator('.oxd-sidepanel-header-close');
    this.aboutMenuItem = page.getByRole('menuitem', { name: 'About' });
    this.aboutDialog = page.locator('.oxd-dialog-sheet');
    this.aboutDialogCloseButton = page.locator('.oxd-dialog-close-button');
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

  private async isMobileLayout(): Promise<boolean> {
    await expect(this.sidepanel).toBeAttached();
    await expect(this.userDropdown).toBeVisible();
    return (
      (this.page.viewportSize()?.width ?? 1280) < 1024 ||
      (await this.mobileMenuButton.isVisible())
    );
  }

  /** Assert Dashboard loaded with ESS sidebar permissions (self-service visible, Admin hidden). */
  async expectEssViewLoaded(visibleMenus: string[], hiddenMenus: string[]): Promise<void> {
    await this.expectLoaded();
    await this.ensureSidebarOpen();

    for (const menu of visibleMenus) {
      await expect(this.navLink(menu)).toBeVisible();
    }

    for (const menu of hiddenMenus) {
      await expect(this.navLink(menu)).toHaveCount(0);
    }
  }

  /** Close the mobile slide-over navigation drawer if currently open. */
  async closeMobileDrawerIfOpen(): Promise<void> {
    if (await this.isMobileLayout()) {
      const sidepanelClass = (await this.sidepanel.getAttribute('class')) ?? '';
      if (sidepanelClass.includes('toggled')) {
        await this.mobileDrawerCloseButton.click();
        await expect(this.sidepanel).not.toHaveClass(/toggled/);
      }
    }
  }

  /** Verify all expected Admin sidebar module links are visible and enabled. */
  async expectAdminSidebarModulesVisible(
    modules: readonly string[] = ['Admin', 'PIM', 'Maintenance', 'Leave', 'Time']
  ): Promise<void> {
    await this.ensureSidebarOpen();
    for (const menu of modules) {
      const link = this.navLink(menu);
      await expect(link).toBeVisible();
      await expect(link).toBeEnabled();
    }
    await this.closeMobileDrawerIfOpen();
  }

  /** Verify direct navigation to a privileged route is blocked for the active non-Admin session. */
  async expectPrivilegedRouteBlocked(route: string): Promise<void> {
    const response = await this.page.goto(route, {
      waitUntil: 'domcontentloaded',
      timeout: 35_000,
    });
    const status = response?.status() ?? 0;
    const isHttpBlocked = status === 401 || status === 403;
    const bodyText = (await this.page.locator('body').textContent()) ?? '';
    const hasBlockedMessage = /Credential Required|Access Denied/i.test(bodyText);
    const redirectedAway = !this.page.url().includes(route);

    expect(
      isHttpBlocked || hasBlockedMessage || redirectedAway,
      `Expected privileged route ${route} to be blocked, got status=${status}, url=${this.page.url()}`
    ).toBe(true);

    await expect(this.page.locator('input[name="firstName"]')).toHaveCount(0);
    await expect(this.page.locator('.oxd-table-filter')).toHaveCount(0);
    await expect(this.page.locator('input[type="password"]')).toHaveCount(0);
  }

  /** Log out via the user dropdown menu and verify redirect back to Login. */
  async logout(): Promise<void> {
    await this.closeMobileDrawerIfOpen();

    await withRetry(
      async () => {
        if (/\/auth\/login/.test(this.page.url())) {
          return;
        }
        if (!(await this.logoutMenuItem.isVisible())) {
          await this.userDropdown.click();
        }
        await expect(this.logoutMenuItem).toBeVisible();
        await this.logoutMenuItem.click({ noWaitAfter: true });
        await this.page.waitForURL(/\/auth\/login/, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1_000,
        shouldRetry: () => !this.page.isClosed(),
      }
    );
    await expect(this.page).toHaveURL(/\/auth\/login/);
  }

  /** Attempt direct access to a protected route and verify redirect back to Login. */
  async expectProtectedRouteBlocked(route = '/web/index.php/dashboard/index'): Promise<void> {
    await gotoWithRetry(this.page, route);
    await expect(this.page).toHaveURL(/\/auth\/login/);
    await expect(this.page.getByRole('textbox', { name: 'Username' })).toBeVisible();
  }

  /** Wait until Dashboard header, widgets, and all loading spinners finish settling. */
  async waitForDashboardIdle(): Promise<void> {
    await this.expectLoaded();
    await expect(this.page.locator('.oxd-loading-spinner')).toHaveCount(0);
    await expect(this.page.locator('.orangehrm-dashboard-widget-name').first()).toBeVisible();
  }

  /** Scope queries to a single Dashboard widget card identified by its header text. */
  widgetCard(title: string): Locator {
    return this.page
      .locator('.oxd-grid-item.orangehrm-dashboard-widget', {
        has: this.page.locator('.orangehrm-dashboard-widget-name', { hasText: title }),
      })
      .first();
  }

  /** Assert all 5 core Dashboard widgets render visibly with their card headers. */
  async expectAllCoreWidgetsVisible(): Promise<void> {
    for (const title of DashboardPage.CORE_WIDGET_TITLES) {
      const card = this.widgetCard(title);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      await expect(
        card.locator('.orangehrm-dashboard-widget-name', { hasText: title })
      ).toBeVisible();
    }
  }

  /** Ensure the sidebar navigation panel is open (opening the mobile drawer if needed). */
  async ensureSidebarOpen(): Promise<void> {
    if (await this.isMobileLayout()) {
      await expect(this.mobileMenuButton).toBeVisible();
      const sidepanelClass = (await this.sidepanel.getAttribute('class')) ?? '';
      if (!sidepanelClass.includes('toggled')) {
        await this.mobileMenuButton.click();
      }
      await expect(this.sidepanel).toHaveClass(/toggled/);
      await expect(this.sidebarSearchInput).toBeVisible();
    }
  }

  /** Filter the sidebar menu with a search term, assert filtering works, then clear it. */
  async filterSidebarAndClear(
    searchTerm: string,
    expectedMenu: string,
    hiddenMenu: string
  ): Promise<void> {
    await this.ensureSidebarOpen();
    await this.sidebarSearchInput.fill(searchTerm);
    await expect(this.navLink(expectedMenu)).toBeVisible();
    await expect(this.navLink(hiddenMenu)).toHaveCount(0);

    await this.sidebarSearchInput.fill('');
    await expect(this.navLink(expectedMenu)).toBeVisible();
    await expect(this.navLink(hiddenMenu)).toBeVisible();
  }

  /** Toggle sidebar collapsed/expanded state on desktop or drawer state on mobile viewports. */
  async toggleSidebarCollapseAndExpand(): Promise<void> {
    if (!(await this.isMobileLayout())) {
      await expect(this.sidebarCollapseButton).toBeVisible();
      await this.sidebarCollapseButton.click();
      await expect(this.sidepanel).toHaveClass(/toggled/);

      await this.sidebarCollapseButton.click();
      await expect(this.sidepanel).not.toHaveClass(/toggled/);
      return;
    }

    await this.ensureSidebarOpen();
    await expect(this.sidepanel).toHaveClass(/toggled/);

    await this.mobileDrawerCloseButton.click();
    await expect(this.sidepanel).not.toHaveClass(/toggled/);

    await this.ensureSidebarOpen();
    await expect(this.sidepanel).toHaveClass(/toggled/);
  }

  /** Open the profile dropdown About modal, verify details, and close it cleanly. */
  async openAndCloseAboutModal(): Promise<void> {
    await this.closeMobileDrawerIfOpen();

    await this.userDropdown.click();
    await this.aboutMenuItem.click();
    await expect(this.aboutDialog).toBeVisible();
    await expect(this.aboutDialog).toContainText('About');

    await this.aboutDialogCloseButton.click();
    await expect(this.aboutDialog).toBeHidden();
  }

  /** Navigate to another OrangeHRM module via the sidebar link and verify target URL. */
  async navigateViaSidebar(menuName: string, expectedUrl: RegExp): Promise<void> {
    await withRetry(
      async (attempt) => {
        if (expectedUrl.test(this.page.url())) {
          if (attempt > 1) {
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
          }
          await expect(this.userDropdown).toBeVisible({ timeout: 20_000 });
          return;
        }
        await this.ensureSidebarOpen();
        if (expectedUrl.test(this.page.url())) {
          return;
        }
        await this.navLink(menuName).click({ noWaitAfter: true });
        await this.page.waitForURL(expectedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 40_000,
        });
        await expect(this.userDropdown).toBeVisible({ timeout: 20_000 });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1_500,
        shouldRetry: () => !this.page.isClosed(),
      }
    );
  }

  /** Verify both distribution pie charts render non-zero canvases and toggle a legend slice. */
  async expectDistributionChartsAndToggleLegend(): Promise<void> {
    for (const title of DashboardPage.CHART_WIDGET_TITLES) {
      const card = this.widgetCard(title);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeVisible();
      await expect(card.locator('.oxd-loading-spinner')).toHaveCount(0, { timeout: 30_000 });

      const canvas = card.locator('.oxd-pie-chart canvas');
      await expect(canvas).toBeVisible();

      const hasDimensions = await canvas.evaluate(
        (el) => (el as HTMLCanvasElement).width > 0 && (el as HTMLCanvasElement).height > 0
      );
      expect(hasDimensions, `Expected non-zero canvas dimensions for ${title}`).toBe(true);
    }

    const firstLegendItem = this.page.locator('.oxd-chart-legend li').first();
    await firstLegendItem.scrollIntoViewIfNeeded();
    await expect(firstLegendItem).toBeVisible();

    const labelSpan = firstLegendItem.locator('span.oxd-text');
    await firstLegendItem.click();
    await expect(labelSpan).toHaveAttribute('style', /line-through/);

    await firstLegendItem.click();
    await expect(labelSpan).not.toHaveAttribute('style', /line-through/);
  }

  /** Verify all 6 Quick Launch icons, inspect My Actions state, and open Leave List. */
  async expectQuickLaunchAndMyActions(): Promise<void> {
    const quickLaunchCard = this.widgetCard('Quick Launch');
    await quickLaunchCard.scrollIntoViewIfNeeded();
    await expect(quickLaunchCard).toBeVisible();
    await expect(quickLaunchCard.locator('.oxd-loading-spinner')).toHaveCount(0, {
      timeout: 30_000,
    });

    for (const title of DashboardPage.QUICK_LAUNCH_TITLES) {
      const shortcut = this.page.locator(`button.orangehrm-quick-launch-icon[title="${title}"]`);
      await shortcut.scrollIntoViewIfNeeded();
      await expect(shortcut).toBeVisible();
    }

    const myActionsCard = this.widgetCard('My Actions');
    await myActionsCard.scrollIntoViewIfNeeded();
    await expect(myActionsCard).toBeVisible();
    await expect(myActionsCard.locator('.oxd-loading-spinner')).toHaveCount(0, { timeout: 30_000 });
    const myActionsContent = myActionsCard
      .locator('.orangehrm-todo-list-item, .orangehrm-dashboard-widget-body-nocontent')
      .first();
    await expect(myActionsContent).toBeVisible();

    await withRetry(
      async (attempt) => {
        if (/\/leave\/viewLeaveList/.test(this.page.url())) {
          return;
        }
        if (attempt > 1) {
          await this.goto();
        }
        const leaveListButton = this.page.locator(
          'button.orangehrm-quick-launch-icon[title="Leave List"]'
        );
        await leaveListButton.scrollIntoViewIfNeeded();
        await expect(leaveListButton).toBeVisible();
        await leaveListButton.click({ noWaitAfter: true });
        await this.page.waitForURL(/\/leave\/viewLeaveList/, {
          waitUntil: 'domcontentloaded',
          timeout: 40_000,
        });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1_500,
        shouldRetry: () => !this.page.isClosed(),
      }
    );
    await expect(this.page).toHaveURL(/\/leave\/viewLeaveList/);
  }

  /** Verify responsive hamburger menu drawer opens, closes, and navigates on mobile viewports. */
  async verifyMobileDrawerNavigation(): Promise<void> {
    if ((this.page.viewportSize()?.width ?? 1280) >= 1024) {
      await this.page.setViewportSize({ width: 393, height: 851 });
    }

    await expect(this.mobileMenuButton).toBeVisible();
    await expect(this.sidepanel).not.toHaveClass(/toggled/);

    await this.mobileMenuButton.click();
    await expect(this.sidepanel).toHaveClass(/toggled/);
    await expect(this.navLink('PIM')).toBeVisible();

    await this.mobileDrawerCloseButton.click();
    await expect(this.sidepanel).not.toHaveClass(/toggled/);

    await withRetry(
      async (attempt) => {
        if (/\/pim\/viewEmployeeList/.test(this.page.url())) {
          if (attempt > 1) {
            await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
          }
          await expect(this.userDropdown).toBeVisible({ timeout: 20_000 });
          return;
        }
        await this.ensureSidebarOpen();
        await this.navLink('PIM').click({ noWaitAfter: true });
        await this.page.waitForURL(/\/pim\/viewEmployeeList/, {
          waitUntil: 'domcontentloaded',
          timeout: 40_000,
        });
        await expect(this.userDropdown).toBeVisible({ timeout: 20_000 });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1_500,
        shouldRetry: () => !this.page.isClosed(),
      }
    );
    await expect(this.sidepanel).not.toHaveClass(/toggled/);
  }

  /** Wait for web fonts and active images to settle before visual snapshot comparison. */
  private async waitForFontsAndImages(): Promise<void> {
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

  /** Wait until Dashboard chrome, spinners, web fonts, and images stabilize for screenshot diffing. */
  async waitForVisualStability(): Promise<void> {
    await this.waitForDashboardIdle();
    await resetOrangeHrmThemeVariables(this.page);
    await this.waitForFontsAndImages();
  }

  /** Ensure sidebar drawer/panel, theme CSS variables, fonts, and images are stable before diffing. */
  async waitForSidebarVisualStability(): Promise<void> {
    await this.ensureSidebarOpen();
    await resetOrangeHrmThemeVariables(this.page);
    await this.waitForFontsAndImages();
  }

  /** Return locators for dynamic user/widget content areas to mask in visual snapshots. */
  getVisualMasks(): Locator[] {
    return [
      this.page.locator('.oxd-userdropdown-tab'),
      this.page.locator('.orangehrm-dashboard-widget-body'),
      this.page.locator('.oxd-brand-logo'),
      this.page.locator('.oxd-brand-banner'),
    ];
  }
}
