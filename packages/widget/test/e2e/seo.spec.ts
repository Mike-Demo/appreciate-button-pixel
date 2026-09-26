import { expect, test, type Page } from '@playwright/test';

import { API_ORIGIN } from './constants.js';
import { watchProblems } from './problems.js';

/** Where the site says it lives: every canonical URL starts with it. */
const SITE_ORIGIN = 'https://appreciator.medhat.dev';

/** Paths that are not pages for search results, and are not crawled. */
const NOT_PAGES = /^\/(dashboard|auth\/|v1\/)/;

const GUIDES = [
  '/guides/html',
  '/guides/wordpress',
  '/guides/ghost',
  '/guides/hugo',
  '/guides/jekyll',
  '/guides/eleventy',
  '/guides/astro',
  '/guides/nextjs',
];

interface PageFacts {
  path: string;
  status: number;
  title: string;
  description: string | null;
  canonical: string | null;
  ogImage: string | null;
  h1s: number;
  jsonLd: unknown[];
  links: string[];
  problems: string[];
}

/** Loads one page and reads what search engines read from it, and where it links. */
async function visit(page: Page, path: string): Promise<PageFacts> {
  const problems = await watchProblems(page);
  const response = await page.goto(`${API_ORIGIN}${path}`);
  // Let the page's own script finish, so its failures are counted too.
  await page.waitForLoadState('networkidle');
  const facts = await page.evaluate(() => {
    const meta = (selector: string) =>
      document.querySelector(selector)?.getAttribute('content') ?? null;
    return {
      title: document.title,
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      ogImage: meta('meta[property="og:image"]'),
      h1s: document.querySelectorAll('h1').length,
      jsonLd: Array.from(
        document.querySelectorAll('script[type="application/ld+json"]'),
        (script) => JSON.parse(script.textContent ?? '') as unknown,
      ),
      links: Array.from(
        document.querySelectorAll('a[href]'),
        (link) => (link as HTMLAnchorElement).href,
      ),
    };
  });
  const links = facts.links
    .map((href) => new URL(href))
    .filter((url) => url.origin === API_ORIGIN && !NOT_PAGES.test(url.pathname))
    .map((url) => url.pathname);
  return {
    path,
    status: response?.status() ?? 0,
    ...facts,
    links,
    problems: [...problems.console, ...(await problems.csp())],
  };
}

/** Every page reachable from the home page by its links, each read once. */
async function crawl(page: Page): Promise<Map<string, PageFacts>> {
  const seen = new Map<string, PageFacts>();
  const queue = ['/'];
  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (seen.has(path)) continue;
    const facts = await visit(page, path);
    seen.set(path, facts);
    for (const link of facts.links) if (!seen.has(link)) queue.push(link);
  }
  return seen;
}

test('every page linked from the home page is whole, distinct and says where it lives', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const pages = await crawl(page);

  expect([...pages.keys()]).toEqual(expect.arrayContaining(['/', '/leaderboard', ...GUIDES]));
  for (const facts of pages.values()) {
    const where = facts.path;
    expect(facts.status, where).toBe(200);
    expect(facts.problems, where).toEqual([]);
    expect(facts.h1s, where).toBe(1);
    expect(facts.title, where).toMatch(/Appreciator/);
    expect(facts.description?.length ?? 0, where).toBeGreaterThan(50);
    expect(facts.canonical, where).toBe(`${SITE_ORIGIN}${where}`);
    expect(facts.ogImage, where).toBe(`${SITE_ORIGIN}/img/og.png`);
  }
  const all = [...pages.values()];
  expect(new Set(all.map((facts) => facts.title)).size).toBe(all.length);
  expect(new Set(all.map((facts) => facts.description)).size).toBe(all.length);

  // Structured data on every generated page, and the software described on the home page.
  for (const facts of all.filter((facts) => facts.path !== '/leaderboard')) {
    expect(facts.jsonLd, facts.path).toHaveLength(1);
  }
  expect(JSON.stringify(pages.get('/')?.jsonLd)).toContain('"SoftwareApplication"');
});

test('the sitemap lists exactly the pages the links reach, and each one answers', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const sitemap = await (await request.get(`${API_ORIGIN}/sitemap.xml`)).text();
  const listed = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => {
    const url = new URL(match[1] ?? '');
    expect(url.origin).toBe(SITE_ORIGIN);
    return url.pathname;
  });

  for (const path of listed) {
    expect((await request.get(`${API_ORIGIN}${path}`)).status(), path).toBe(200);
  }
  const reached = [...(await crawl(page)).keys()];
  expect([...listed].sort()).toEqual([...reached].sort());

  const robots = await (await request.get(`${API_ORIGIN}/robots.txt`)).text();
  expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
});

test('a keyword page runs its live demo, and counts a click', async ({ page }) => {
  const problems = await watchProblems(page);
  await page.goto(`${API_ORIGIN}/clap-button`);

  const demo = page.locator('[data-demo-slot="clap-button"] appreciator-button');
  await expect(demo).toHaveAttribute('data-state', 'default');
  const count = demo.locator('[part="count"]');
  const before = Number(await count.textContent());
  await demo.locator('button').click();
  await expect(count).toHaveText(String(before + 1));

  await expect(page.locator('[data-signin-link]')).toHaveAttribute(
    'href',
    `${API_ORIGIN}/dashboard`,
  );
  expect(await problems.csp()).toEqual([]);
  expect(problems.console).toEqual([]);
});

test("a guide's snippets name the instance serving it, and copy as shown", async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${API_ORIGIN}/guides/hugo`);

  const snippet = page.locator('#hugo-tag');
  await expect(snippet).toContainText(`<script src="${API_ORIGIN}/widget.js"`);
  await expect(snippet).not.toContainText(SITE_ORIGIN);
  // Hugo's own template syntax is left as it is.
  await expect(snippet).toContainText('{{ .Content }}');

  await page.locator('[data-copy="#hugo-tag"]').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await snippet.textContent(),
  );
});

test('a folder of pages without its slash is sent to the folder', async ({ page }) => {
  await page.goto(`${API_ORIGIN}/guides`);

  expect(new URL(page.url()).pathname).toBe('/guides/');
  await expect(page.locator('h1')).toHaveText('Add the button to your site');
});
