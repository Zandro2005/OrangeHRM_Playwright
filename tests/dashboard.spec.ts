import type { Page, Route } from '@playwright/test';
import { expect, test } from '../fixtures/authFixture';
import { runA11yAudit } from '../utils/accessibility';

interface BackgroundWidgetStubOptions {
  employeeEndpoints?: readonly string[];
  stubShortcuts?: boolean;
  stubPimList?: boolean;
}

/**
 * Stub unrelated background Dashboard widget XHRs and heartbeat calls so concurrent requests
 * sharing the `_orangehrm` PHP session cookie do not block page navigations or target widget APIs.
 */
async function stubBackgroundDashboardWidgets(
  page: Page,
  options: BackgroundWidgetStubOptions = {}
): Promise<() => Promise<void>> {
  const registered: Array<{
    pattern: string | RegExp;
    handler: (route: Route) => Promise<void>;
  }> = [];

  const registerJsonStub = async (
    pattern: string | RegExp,
    payload: Record<string, unknown>
  ): Promise<void> => {
    const body = JSON.stringify(payload);
    const handler = async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body,
      });
    };
    await page.route(pattern, handler);
    registered.push({ pattern, handler });
  };

  await registerJsonStub('**/api/v2/buzz/feed**', { data: [], meta: { total: 0 } });
  await registerJsonStub('**/events/push**', {});

  const employeePattern: string | RegExp = options.employeeEndpoints?.length
    ? new RegExp(`/api/v2/dashboard/employees/(?:${options.employeeEndpoints.join('|')})(?:\\?|$)`)
    : '**/api/v2/dashboard/employees/**';
  await registerJsonStub(employeePattern, { data: [], meta: { leavePeriodDefined: true } });

  if (options.stubShortcuts !== false) {
    await registerJsonStub('**/api/v2/dashboard/shortcuts**', {
      data: {
        'leave.assign_leave': true,
        'leave.leave_list': true,
        'time.view_timesheets': true,
        'leave.apply_leave': true,
        'leave.my_leave': true,
        'time.my_timesheet': true,
      },
      meta: [],
      rels: [],
    });
  }

  if (options.stubPimList) {
    await registerJsonStub('**/api/v2/pim/employees**', {
      data: [],
      meta: { total: 0 },
      rels: [],
    });
  }

  return async () => {
    if (page.isClosed()) {
      return;
    }
    for (const { pattern, handler } of registered) {
      await page.unroute(pattern, handler);
    }
  };
}

test.describe('Module 2: Dashboard', () => {
  test('TC-DASH-001: Dashboard loads with zero console & network errors @functional @smoke', async ({
    authenticatedDashboardPage,
    telemetry,
  }) => {
    await authenticatedDashboardPage.goto();
    await authenticatedDashboardPage.waitForDashboardIdle();

    expect(telemetry.consoleErrors, 'Unexpected console/page errors on Dashboard').toEqual([]);
    expect(telemetry.serverErrors, 'Unexpected HTTP 5xx responses on Dashboard').toEqual([]);
  });

  test('TC-DASH-002: Verify all core Dashboard widgets render @functional @regression', async ({
    authenticatedDashboardPage,
  }) => {
    await authenticatedDashboardPage.goto();
    await authenticatedDashboardPage.expectAllCoreWidgetsVisible();
  });

  test('TC-DASH-003: Verify sidebar navigation, search & collapse toggle @functional @e2e', async ({
    authenticatedDashboardPage,
  }) => {
    const page = authenticatedDashboardPage.page;
    const unrouteBackground = await stubBackgroundDashboardWidgets(page, { stubPimList: true });

    try {
      await authenticatedDashboardPage.goto();

      await test.step('Filter sidebar menu by keyword and clear search', async () => {
        await authenticatedDashboardPage.filterSidebarAndClear('PIM', 'PIM', 'Admin');
      });

      await test.step('Toggle sidebar collapse/expand state', async () => {
        await authenticatedDashboardPage.toggleSidebarCollapseAndExpand();
      });

      await test.step('Open and close user profile About modal', async () => {
        await authenticatedDashboardPage.openAndCloseAboutModal();
      });

      await test.step('Navigate between modules via sidebar links', async () => {
        await authenticatedDashboardPage.navigateViaSidebar('PIM', /\/pim\/viewEmployeeList/);
        await authenticatedDashboardPage.navigateViaSidebar('Dashboard', /\/dashboard\/index/);
      });
    } finally {
      await unrouteBackground();
    }
  });

  test('TC-DASH-004: Employee Distribution charts & interactive legends @functional @regression', async ({
    authenticatedDashboardPage,
  }) => {
    const page = authenticatedDashboardPage.page;
    const subunitRoute = '**/api/v2/dashboard/employees/subunit';
    const locationsRoute = '**/api/v2/dashboard/employees/locations';

    const unrouteBackground = await stubBackgroundDashboardWidgets(page, {
      employeeEndpoints: ['time-at-work', 'action-summary', 'leaves'],
    });

    const attachFallbackIfEmpty = async (
      pattern: string,
      fallbackData: Record<string, unknown>[]
    ): Promise<void> => {
      await page.route(pattern, async (route) => {
        try {
          const response = await route.fetch({ timeout: 10_000 });
          const body = (await response.json()) as { data?: unknown[]; meta?: unknown };
          if (Array.isArray(body.data) && body.data.length > 0) {
            await route.fulfill({ response });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: fallbackData, meta: { total: fallbackData.length } }),
          });
        } catch {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: fallbackData, meta: [], rels: [] }),
          });
        }
      });
    };

    await attachFallbackIfEmpty(subunitRoute, [
      { subunit: { id: 1, name: 'Human Resources' }, count: 4 },
    ]);
    await attachFallbackIfEmpty(locationsRoute, [
      { location: { id: 1, name: 'Texas R&D' }, count: 4 },
    ]);

    try {
      await authenticatedDashboardPage.goto();
      await authenticatedDashboardPage.expectDistributionChartsAndToggleLegend();
    } finally {
      await unrouteBackground();
      if (!page.isClosed()) {
        await page.unroute(subunitRoute);
        await page.unroute(locationsRoute);
      }
    }
  });

  test('TC-DASH-005: Quick Launch shortcuts & My Actions navigation @functional @e2e', async ({
    authenticatedDashboardPage,
  }) => {
    const unrouteBackground = await stubBackgroundDashboardWidgets(authenticatedDashboardPage.page, {
      employeeEndpoints: ['time-at-work', 'leaves', 'subunit', 'locations'],
      stubShortcuts: false,
    });

    try {
      await authenticatedDashboardPage.goto();
      await authenticatedDashboardPage.expectQuickLaunchAndMyActions();
    } finally {
      await unrouteBackground();
    }
  });

  test('TC-DASH-006: API mocking empty payloads & HTTP 500 error resilience @integration @negative', async ({
    authenticatedDashboardPage,
  }) => {
    const page = authenticatedDashboardPage.page;
    const employeeWidgetsPattern = '**/api/v2/dashboard/employees/**';
    const buzzFeedPattern = '**/api/v2/buzz/feed**';

    try {
      await test.step('Mock empty widget API payloads and verify clean empty states', async () => {
        await page.route(employeeWidgetsPattern, async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: [], meta: { leavePeriodDefined: true } }),
          });
        });
        await page.route(buzzFeedPattern, async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: [], meta: { total: 0 } }),
          });
        });

        await authenticatedDashboardPage.goto();
        await authenticatedDashboardPage.expectLoaded();

        await expect(
          page.locator('.orangehrm-dashboard-widget-body-nocontent', {
            hasText: 'No Pending Actions to Perform',
          })
        ).toBeVisible();
        await expect(
          page.locator('.orangehrm-dashboard-widget-body-nocontent', {
            hasText: 'No Employees are on Leave Today',
          })
        ).toBeVisible();

        await page.unroute(employeeWidgetsPattern);
        await page.unroute(buzzFeedPattern);
      });

      await test.step('Mock HTTP 500 responses and verify Dashboard remains resilient', async () => {
        const fulfillServerError = async (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { status: '500', message: 'Internal Server Error' } }),
          });
        };
        await page.route(employeeWidgetsPattern, fulfillServerError);
        await page.route(buzzFeedPattern, fulfillServerError);

        await authenticatedDashboardPage.goto();
        await authenticatedDashboardPage.expectLoaded();
        await authenticatedDashboardPage.expectAllCoreWidgetsVisible();
      });
    } finally {
      if (!page.isClosed()) {
        await page.unroute(employeeWidgetsPattern);
        await page.unroute(buzzFeedPattern);
      }
    }
  });

  test('TC-DASH-007: Mobile drawer navigation on Mobile Chrome & Safari @cross-browser @functional', async ({
    authenticatedDashboardPage,
  }) => {
    const unrouteBackground = await stubBackgroundDashboardWidgets(authenticatedDashboardPage.page, {
      stubPimList: true,
    });

    try {
      await authenticatedDashboardPage.goto();
      await authenticatedDashboardPage.verifyMobileDrawerNavigation();
    } finally {
      await unrouteBackground();
    }
  });

  test('TC-DASH-008: Dashboard visual regression & WCAG accessibility audit @visual @a11y', async ({
    authenticatedDashboardPage,
  }, testInfo) => {
    const page = authenticatedDashboardPage.page;
    const unrouteBackground = await stubBackgroundDashboardWidgets(page);

    try {
      await authenticatedDashboardPage.goto();
      await authenticatedDashboardPage.waitForVisualStability();

      await expect(page).toHaveScreenshot('dashboard-default.png', {
        mask: authenticatedDashboardPage.getVisualMasks(),
      });

      // Document known upstream OrangeHRM OS 5.9 template accessibility findings without blocking CI
      await runA11yAudit(page, testInfo, {
        knownBaselineRuleIds: [
          'button-name',
          'color-contrast',
          'html-has-lang',
          'list',
          'link-name',
          'image-alt',
        ],
      });
    } finally {
      await unrouteBackground();
    }
  });
});
