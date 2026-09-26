import type { Page } from '@playwright/test';

export interface PageProblems {
  console: string[];
  csp: () => Promise<string[]>;
}

/**
 * Collects everything that would betray a broken page: console errors,
 * uncaught exceptions, and Content-Security-Policy violations, which the
 * browser reports as an event rather than an error.
 */
export async function watchProblems(page: Page): Promise<PageProblems> {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = violations;
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });
  return {
    console: problems,
    csp: () =>
      page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations),
  };
}
