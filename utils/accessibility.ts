import AxeBuilder from '@axe-core/playwright';
import { expect, Page, TestInfo } from '@playwright/test';

export interface A11yAuditOptions {
  /** Rule IDs with known upstream third-party defects to record without blocking CI. */
  knownBaselineRuleIds?: string[];
  /** CSS selectors to include in the scan scope. */
  include?: string[];
  /** CSS selectors to exclude from the scan scope. */
  exclude?: string[];
}

/** Run a WCAG 2.1 AA accessibility scan via AxeBuilder and fail on critical/serious violations. */
export async function runA11yAudit(
  page: Page,
  testInfo: TestInfo,
  options: A11yAuditOptions = {}
): Promise<void> {
  type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
  // Bridge minor nested playwright-core type differences when @axe-core/playwright bundles an older peer copy
  let builder = new AxeBuilder({ page: page as unknown as AxePage }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
  ]);

  for (const selector of options.include ?? []) {
    builder = builder.include(selector);
  }
  for (const selector of options.exclude ?? []) {
    builder = builder.exclude(selector);
  }

  const results = await builder.analyze();
  const knownRules = new Set(options.knownBaselineRuleIds ?? []);

  await testInfo.attach('axe-a11y-audit', {
    body: JSON.stringify(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.map((n) => n.target),
        baselined: knownRules.has(v.id),
      })),
      null,
      2
    ),
    contentType: 'application/json',
  });

  const blocking = results.violations.filter(
    (v) => (v.impact === 'critical' || v.impact === 'serious') && !knownRules.has(v.id)
  );

  expect(blocking, 'Unexpected critical or serious WCAG 2.1 AA violations found').toEqual([]);
}
