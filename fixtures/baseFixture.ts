import { test as base, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

export interface PageTelemetry {
  consoleErrors: string[];
  serverErrors: string[];
  attach: (targetPage: Page) => void;
}

export interface BaseFixtures {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  telemetry: PageTelemetry;
}

export const test = base.extend<BaseFixtures>({
  telemetry: async ({ page }, use) => {
    const consoleErrors: string[] = [];
    const serverErrors: string[] = [];
    const attachedPages = new WeakSet<Page>();

    const attach = (targetPage: Page): void => {
      if (attachedPages.has(targetPage)) {
        return;
      }
      attachedPages.add(targetPage);

      targetPage.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Ignore browser-level 404 noise for optional assets (e.g., favicon); fail on real JS/app errors
          if (!text.includes('status of 404')) {
            consoleErrors.push(text);
          }
        }
      });

      targetPage.on('pageerror', (error) => {
        consoleErrors.push(error.message);
      });

      targetPage.on('response', (res) => {
        const url = res.url();
        if (
          res.status() >= 500 &&
          (url.includes('/web/index.php/') || url.includes('/api/v2/'))
        ) {
          serverErrors.push(`${res.status()} ${res.request().method()} ${url}`);
        }
      });
    };

    attach(page);
    await use({ consoleErrors, serverErrors, attach });
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
});

export { expect };
