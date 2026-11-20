import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures/adminFixture';
import { LoginPage } from '../pages/LoginPage';
import { SettingsPage } from '../pages/SettingsPage';
import { runA11yAudit } from '../utils/accessibility';
import {
  AdminCredentials,
  gotoWithRetry,
  loadSettingsData,
  restoreDefaultLocalizationViaApi,
  restoreDefaultModulesViaApi,
  restoreDefaultThemeViaApi,
  saveStorageStateAtomically,
  withCrossWorkerLock,
} from '../utils/apiHelpers';

async function withFreshAuthenticatedSettingsContext(
  browser: Browser,
  baseURL: string | undefined,
  storageStatePath: string,
  adminCredentials: AdminCredentials,
  url: string,
  readyLocator: (page: Page, settings: SettingsPage) => Locator,
  assertFn: (page: Page, settings: SettingsPage) => Promise<void>
): Promise<void> {
  const freshContext: BrowserContext = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: storageStatePath,
  });
  try {
    const freshPage = await freshContext.newPage();
    await freshPage.route('**/events/push**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    const freshSettings = new SettingsPage(freshPage);
    const loginPage = new LoginPage(freshPage);
    const ready = readyLocator(freshPage, freshSettings);

    await gotoWithRetry(freshPage, url, ready.or(loginPage.usernameInput));
    if (freshPage.url().includes('/auth/login')) {
      await loginPage.login(adminCredentials.username, adminCredentials.password);
      const landedOnTarget =
        freshPage.url().includes(url) &&
        (await ready
          .waitFor({ state: 'visible', timeout: 25_000 })
          .then(() => true)
          .catch(() => false));
      if (!landedOnTarget) {
        await gotoWithRetry(freshPage, url, ready);
      }
      await saveStorageStateAtomically(freshContext, storageStatePath).catch(() => undefined);
    }
    await freshSettings.waitForSpinnerToClear();
    await assertFn(freshPage, freshSettings);
  } finally {
    await freshContext.close().catch(() => undefined);
  }
}

test.describe('Module 7: Settings & Configuration', () => {
  test('TC-SET-001: Open Admin Configuration & Corporate Branding pages @functional @smoke', async ({
    settingsPage,
  }) => {
    await settingsPage.gotoEmailConfiguration();
    await expect(settingsPage.page).toHaveURL(/\/admin\/listMailConfiguration/);
    await expect(settingsPage.saveButton).toBeVisible();
    await expect(settingsPage.saveButton).toBeEnabled();

    await settingsPage.navigateViaAdminTopbar('Localization');
    await expect(settingsPage.page.getByRole('heading', { name: 'Localization' })).toBeVisible();

    await settingsPage.navigateViaAdminTopbar('Modules');
    await expect(
      settingsPage.page.getByRole('heading', { name: 'Module Configuration' })
    ).toBeVisible();

    await settingsPage.navigateViaAdminTopbar('Corporate Branding');
    await expect(
      settingsPage.page.getByRole('heading', { name: 'Corporate Branding' })
    ).toBeVisible();
    await expect(settingsPage.publishButton).toBeVisible();
    await expect(settingsPage.resetToDefaultButton).toBeVisible();

    await settingsPage.navigateViaAdminTopbar('Email Configuration');
    await expect(settingsPage.saveButton).toBeVisible();
  });

  test('TC-SET-002: Update Localization settings & verify save confirmation @functional @e2e', async ({
    browser,
    baseURL,
    adminCredentials,
    settingsPage,
  }) => {
    test.slow();
    const settingsData = loadSettingsData();

    await withCrossWorkerLock(
      'settings-localization',
      async () => {
        try {
          await settingsPage.gotoLocalization();
          await settingsPage.selectLocalizationOptions({
            language: settingsData.localization.defaultLanguage,
            dateFormatPrefix: settingsData.localization.updatedDateFormatPrefix,
          });
          await settingsPage.saveLocalization();
          await settingsPage.expectLocalizationValues({
            language: settingsData.localization.defaultLanguage,
            dateFormatPrefix: settingsData.localization.updatedDateFormatPrefix,
          });
        } finally {
          await restoreDefaultLocalizationViaApi(browser, adminCredentials, baseURL).catch(
            () => undefined
          );
        }
      },
      { baseURL }
    );
  });

  test('TC-SET-003: Verify Localization changes persist across reload & contexts @functional @regression', async ({
    browser,
    baseURL,
    storageStatePath,
    adminCredentials,
    settingsPage,
  }) => {
    test.slow();
    const settingsData = loadSettingsData();

    await withCrossWorkerLock(
      'settings-localization',
      async () => {
        try {
          await settingsPage.gotoLocalization();
          await settingsPage.selectLocalizationOptions({
            language: settingsData.localization.defaultLanguage,
            dateFormatPrefix: settingsData.localization.updatedDateFormatPrefix,
          });
          await settingsPage.saveLocalization();

          await test.step('Reload Localization page and verify updated Date Format persists', async () => {
            await settingsPage.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
            await settingsPage.waitForSpinnerToClear();
            await settingsPage.expectLocalizationValues({
              language: settingsData.localization.defaultLanguage,
              dateFormatPrefix: settingsData.localization.updatedDateFormatPrefix,
            });
          });

          await test.step('Verify updated Localization persists in a fresh BrowserContext', async () => {
            await withFreshAuthenticatedSettingsContext(
              browser,
              baseURL,
              storageStatePath,
              adminCredentials,
              '/web/index.php/admin/localization',
              (_page, settings) => settings.saveButton,
              async (_page, freshSettings) => {
                await freshSettings.expectLocalizationValues({
                  language: settingsData.localization.defaultLanguage,
                  dateFormatPrefix: settingsData.localization.updatedDateFormatPrefix,
                });
              }
            );
          });

          await test.step('Restore default Date Format via UI', async () => {
            await settingsPage.selectLocalizationOptions({
              language: settingsData.localization.defaultLanguage,
              dateFormatPrefix: settingsData.localization.defaultDateFormatPrefix,
            });
            await settingsPage.saveLocalization();
            await settingsPage.expectLocalizationValues({
              language: settingsData.localization.defaultLanguage,
              dateFormatPrefix: settingsData.localization.defaultDateFormatPrefix,
            });
          });
        } finally {
          await restoreDefaultLocalizationViaApi(browser, adminCredentials, baseURL).catch(
            () => undefined
          );
        }
      },
      { baseURL }
    );
  });

  test('TC-SET-004: Email Configuration required fields & format validation @negative @regression', async ({
    settingsPage,
  }) => {
    const settingsData = loadSettingsData();

    await settingsPage.gotoEmailConfiguration();

    await test.step('Blank Mail Sent As and SMTP Host trigger Required inline errors', async () => {
      await settingsPage.expectEmailBlankRequiredErrors();
    });

    await test.step('Invalid email format and >10 char non-numeric port show inline validation', async () => {
      await settingsPage.expectEmailInvalidFormatAndPortErrors(
        settingsData.emailConfiguration.invalidEmailFormat,
        settingsData.emailConfiguration.invalidNonNumericPort,
        settingsData.emailConfiguration.validSmtpHost
      );
    });
  });

  test('TC-SET-005: Module Configuration toggles sidebar item & persists @functional @integration', async ({
    browser,
    baseURL,
    storageStatePath,
    adminCredentials,
    settingsPage,
  }) => {
    test.slow();
    const settingsData = loadSettingsData();
    const { optionalModuleLabel, optionalModuleSidebarName } = settingsData.modules;

    await withCrossWorkerLock(
      'settings-modules',
      async () => {
        try {
          await settingsPage.gotoModules();

          await test.step('Disable optional Buzz module and verify hidden in sidebar', async () => {
            await settingsPage.setModuleEnabled(optionalModuleLabel, false);
            await settingsPage.saveModules();
            await settingsPage.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
            await settingsPage.waitForSpinnerToClear();
            await settingsPage.expectSidebarModuleVisibility(optionalModuleSidebarName, false);
          });

          await test.step('Verify disabled module stays hidden in a fresh BrowserContext', async () => {
            await withFreshAuthenticatedSettingsContext(
              browser,
              baseURL,
              storageStatePath,
              adminCredentials,
              '/web/index.php/dashboard/index',
              (freshPage) => freshPage.getByRole('heading', { name: 'Dashboard' }),
              async (_page, freshSettings) => {
                await freshSettings.expectSidebarModuleVisibility(optionalModuleSidebarName, false);
              }
            );
          });

          await test.step('Re-enable Buzz module and verify restored in sidebar', async () => {
            await settingsPage.setModuleEnabled(optionalModuleLabel, true);
            await settingsPage.saveModules();
            await settingsPage.page.reload({ waitUntil: 'domcontentloaded', timeout: 35_000 });
            await settingsPage.waitForSpinnerToClear();
            await settingsPage.expectSidebarModuleVisibility(optionalModuleSidebarName, true);
          });
        } finally {
          await restoreDefaultModulesViaApi(browser, adminCredentials, baseURL).catch(
            () => undefined
          );
        }
      },
      { baseURL }
    );
  });

  test('TC-SET-006: Corporate Branding update/reset & HTTP 500 save mock @integration @negative', async ({
    browser,
    baseURL,
    adminCredentials,
    settingsPage,
  }) => {
    test.slow();
    const settingsData = loadSettingsData();
    const page = settingsPage.page;

    await test.step('Update Corporate Branding Primary Color -> Publish -> Reset to Default', async () => {
      await withCrossWorkerLock(
        'settings-branding',
        async () => {
          try {
            await settingsPage.gotoCorporateBranding();
            await settingsPage.setPrimaryColorHex(
              settingsData.corporateBranding.updatedPrimaryColorHex
            );
            await settingsPage.publishBranding();

            await expect
              .poll(() => settingsPage.getPrimaryColorPreviewBackgroundColor(), { timeout: 20_000 })
              .toBe(settingsData.corporateBranding.updatedPrimaryColorRgb);

            await settingsPage.resetBrandingToDefault(
              settingsData.corporateBranding.defaultPrimaryColorRgb
            );
          } finally {
            await restoreDefaultThemeViaApi(browser, adminCredentials, baseURL).catch(
              () => undefined
            );
          }
        },
        { baseURL }
      );
    });

    await test.step('Mock PUT Localization HTTP 500 and verify graceful error handling', async () => {
      const localizationPutPattern = '**/api/v2/admin/localization';
      await settingsPage.gotoLocalization();

      await page.route(localizationPutPattern, async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { status: '500', message: 'Internal Server Error' } }),
          });
          return;
        }
        await route.continue();
      });

      try {
        await settingsPage.saveButton.scrollIntoViewIfNeeded();
        await settingsPage.saveButton.click();
        await settingsPage.expectErrorToast(/Internal Server Error/i);
        await expect(settingsPage.saveButton).toBeVisible();
      } finally {
        if (!page.isClosed()) {
          await page.unroute(localizationPutPattern);
        }
      }
    });
  });

  test('TC-SET-007: Cross-browser parity, visual regression & a11y audit @cross-browser @visual @a11y', async ({
    browser,
    baseURL,
    adminCredentials,
    settingsPage,
  }, testInfo) => {
    test.slow();
    const page = settingsPage.page;
    const settingsData = loadSettingsData();

    await withCrossWorkerLock(
      'settings-modules',
      async () => {
        await test.step('Verify Module Configuration core switches disabled and optional switches enabled', async () => {
          await settingsPage.gotoModules();
          await expect(
            settingsPage.moduleRowByLabel('Admin Module').locator('input[type="checkbox"]')
          ).toBeChecked({ timeout: 25_000 });

          for (const lockedLabel of settingsData.modules.coreLockedModuleLabels) {
            await expect(
              settingsPage.moduleRowByLabel(lockedLabel).locator('input[type="checkbox"]')
            ).toBeDisabled();
          }

          const optionalCheckbox = settingsPage
            .moduleRowByLabel(settingsData.modules.optionalModuleLabel)
            .locator('input[type="checkbox"]');
          await expect(optionalCheckbox).toBeEnabled();

          // Self-heal sidebar state if an interrupted run or public demo user left Buzz disabled
          if (!(await optionalCheckbox.isChecked())) {
            await restoreDefaultModulesViaApi(browser, adminCredentials, baseURL);
          }
        });

        await test.step('Capture deterministic Localization visual baseline & WCAG audit', async () => {
          const localizationPattern = '**/api/v2/admin/localization';
          await page.route(localizationPattern, async (route) => {
            if (route.request().method() === 'GET') {
              await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                  data: {
                    language: settingsData.localization.defaultLanguageCode,
                    dateFormat: settingsData.localization.defaultDateFormatCode,
                  },
                  meta: [],
                  rels: [],
                }),
              });
              return;
            }
            await route.continue();
          });

          try {
            await settingsPage.gotoLocalization();
            await settingsPage.waitForVisualStability();
            await expect(page).toHaveScreenshot('settings-localization-default.png', {
              mask: settingsPage.getVisualMasks(),
            });
            await runA11yAudit(page, testInfo, {
              knownBaselineRuleIds: ['button-name', 'color-contrast', 'html-has-lang', 'list'],
            });
          } finally {
            if (!page.isClosed()) {
              await page.unroute(localizationPattern);
            }
          }
        });

        await test.step('Capture deterministic Corporate Branding visual baseline & WCAG audit', async () => {
          const themePattern = '**/api/v2/admin/theme';
          await page.route(themePattern, async (route) => {
            if (route.request().method() === 'GET') {
              await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                  data: {
                    name: 'default',
                    variables: {
                      primaryColor: '#FF7B1D',
                      primaryFontColor: '#FFFFFF',
                      secondaryColor: '#76BC21',
                      secondaryFontColor: '#FFFFFF',
                      primaryGradientStartColor: '#FF920B',
                      primaryGradientEndColor: '#F35C17',
                    },
                    showSocialMediaImages: true,
                    clientLogo: null,
                    clientBanner: null,
                    loginBanner: null,
                  },
                  meta: [],
                  rels: [],
                }),
              });
              return;
            }
            await route.continue();
          });

          try {
            await settingsPage.gotoCorporateBranding();
            await settingsPage.waitForVisualStability();
            await expect(page).toHaveScreenshot('settings-branding-default.png', {
              mask: settingsPage.getVisualMasks(),
            });
            await runA11yAudit(page, testInfo, {
              knownBaselineRuleIds: [
                'button-name',
                'color-contrast',
                'html-has-lang',
                'label',
                'list',
              ],
            });
          } finally {
            if (!page.isClosed()) {
              await page.unroute(themePattern);
            }
          }
        });
      },
      { baseURL }
    );
  });
});
