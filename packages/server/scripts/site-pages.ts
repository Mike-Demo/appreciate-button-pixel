/**
 * Builds the site's content pages (the keyword pages, the platform guides and
 * the comparisons) from `site-pages/` into `site/`, all from one layout, and
 * writes `site/sitemap.xml` listing every page by its canonical URL.
 *
 * The output is committed: the server serves `site/` as it is, straight from
 * the repository in development and copied into the build. So:
 *
 *   npm run site:pages              writes the pages
 *   npm run site:pages -- --check   fails if any of them is out of date
 *
 * A source page is an HTML fragment that starts with a front block:
 *
 *   <!--
 *   title: Clap button for any website — Appreciator
 *   description: One sentence for search results.
 *   crumb: Clap button
 *   -->
 *
 * Each source is written to the same place under `site/`, and served at its
 * clean URL: `site-pages/clap-button.html` at `/clap-button`,
 * `site-pages/guides/index.html` at `/guides/`.
 *
 * In the fragment and the layout, `{{root}}` is the relative way back to the
 * site root, so every link is relative like the rest of the site's, and
 * `{{origin}}` is the site's canonical origin. Any other `_name.html` at the
 * top of `site-pages/` is a partial: `{{name}}` in a page is replaced by it.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { format, resolveConfig } from 'prettier';

/** Where the site lives, so what every canonical URL and the sitemap start with. */
export const SITE_ORIGIN = 'https://appreciate-button.com';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE_DIR = join(REPO_ROOT, 'site-pages');
const SITE_DIR = join(REPO_ROOT, 'site');

/** The hand-written pages the sitemap lists before the generated ones. */
const HAND_WRITTEN_PATHS = ['', 'leaderboard'];

/** The fields every source page's front block must have. */
type FrontKey = 'title' | 'description' | 'crumb';

export interface Page {
  title: string;
  description: string;
  /** The clean URL without its leading slash: `clap-button`, `guides/`, `guides/hugo`. */
  path: string;
  /** The page's short name in breadcrumbs. */
  crumb: string;
  body: string;
}

/** The clean URL of the page in `file`, relative to `site-pages/`: `guides/hugo.html` is `guides/hugo`. */
export function pathFor(file: string): string {
  const path = file
    .split('\\')
    .join('/')
    .replace(/\.html$/, '');
  return path === 'index' || path.endsWith('/index') ? path.slice(0, -'index'.length) : path;
}

/** Reads a source page's front block and body; `file` is its path relative to `site-pages/`. */
export function parsePage(source: string, file: string): Page {
  const match = /^<!--\n([\s\S]*?)\n-->\n/.exec(source);
  if (match === null) throw new Error(`${file}: no front block at the top`);
  const front = new Map<string, string>();
  for (const line of (match[1] ?? '').split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) throw new Error(`${file}: front line without a key: ${line}`);
    front.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const required = (key: FrontKey): string => {
    const value = front.get(key);
    if (!value) throw new Error(`${file}: front block needs ${key}`);
    return value;
  };
  const path = pathFor(file);
  // The home page is written by hand (site/index.html), not generated.
  if (path === '') throw new Error(`${file}: the home page is site/index.html, not a source page`);
  return {
    title: required('title'),
    description: required('description'),
    path,
    crumb: required('crumb'),
    body: source.slice(match[0].length),
  };
}

/** The relative way back to the site root from a page at `path`. */
export function rootFor(path: string): string {
  const depth = path.split('/').length - 1;
  return depth === 0 ? './' : '../'.repeat(depth);
}

/** Where a page at `path` is written, relative to `site/`. */
export function outputFile(path: string): string {
  return path.endsWith('/') ? `${path}index.html` : `${path}.html`;
}

export function canonicalUrl(path: string): string {
  return `${SITE_ORIGIN}/${path}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The trail from the home page to `page`, through the folder page above it
 * (`guides/` for `guides/hugo`) when there is one.
 */
export function breadcrumbs(page: Page, pages: readonly Page[]): { name: string; path: string }[] {
  const trail = [{ name: 'Appreciator', path: '' }];
  const slash = page.path.indexOf('/');
  if (slash !== -1 && slash !== page.path.length - 1) {
    const folder = page.path.slice(0, slash + 1);
    const parent = pages.find((candidate) => candidate.path === folder);
    if (parent === undefined) throw new Error(`${page.path}: no page for its folder ${folder}`);
    trail.push({ name: parent.crumb, path: parent.path });
  }
  trail.push({ name: page.crumb, path: page.path });
  return trail;
}

/**
 * The page's structured data: the page itself, part of the site and about
 * the software, and its breadcrumb trail. `<` is escaped so no text in it
 * can close the script element.
 */
export function structuredData(page: Page, pages: readonly Page[]): string {
  const url = canonicalUrl(page.path);
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': url,
        url,
        name: page.title,
        description: page.description,
        isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
        about: { '@id': `${SITE_ORIGIN}/#software` },
        breadcrumb: { '@id': `${url}#breadcrumb` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumb`,
        itemListElement: breadcrumbs(page, pages).map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: canonicalUrl(crumb.path),
        })),
      },
    ],
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function breadcrumbHtml(page: Page, pages: readonly Page[], root: string): string {
  const trail = breadcrumbs(page, pages);
  const items = trail.map((crumb, index) =>
    index === trail.length - 1
      ? `<li aria-current="page">${escapeHtml(crumb.name)}</li>`
      : `<li><a href="${root}${crumb.path}">${escapeHtml(crumb.name)}</a></li>`,
  );
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.join('')}</ol></nav>`;
}

/** Fills `{{name}}` placeholders, and refuses to leave any unknown one behind. */
function fill(template: string, values: Record<string, string>, file: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`${file}: unknown placeholder {{${name}}}`);
    return value;
  });
}

/** A page's full HTML, before formatting. `partials` are the shared fragments by name. */
export function renderPage(
  layout: string,
  page: Page,
  pages: readonly Page[],
  partials: Readonly<Record<string, string>> = {},
): string {
  const root = rootFor(page.path);
  const file = outputFile(page.path);
  const links = { root, origin: SITE_ORIGIN };
  const shared = Object.fromEntries(
    Object.entries(partials).map(([name, partial]) => [
      name,
      fill(partial, links, `_${name}.html`),
    ]),
  );
  const body = fill(page.body, { ...shared, ...links }, file);
  return fill(
    layout,
    {
      root,
      origin: SITE_ORIGIN,
      source: `site-pages/${file}`,
      title: escapeHtml(page.title),
      description: escapeHtml(page.description),
      canonical: canonicalUrl(page.path),
      structuredData: structuredData(page, pages),
      breadcrumbs: breadcrumbHtml(page, pages, root),
      content: body,
    },
    'site-pages/_layout.html',
  );
}

/** Every page's canonical URL, the hand-written ones first. */
export function renderSitemap(pages: readonly Page[]): string {
  const urls = [...HAND_WRITTEN_PATHS, ...pages.map((page) => page.path)].map(
    (path) => `  <url><loc>${canonicalUrl(path)}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** The HTML files under `dir`, in path order. */
async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** Every output file and its content, formatted as the repository formats HTML. */
export async function buildSite(): Promise<Map<string, string>> {
  const layout = await readFile(join(SOURCE_DIR, '_layout.html'), 'utf8');
  const pages: Page[] = [];
  const partials: Record<string, string> = {};
  for (const file of await htmlFiles(SOURCE_DIR)) {
    const name = relative(SOURCE_DIR, file);
    if (name === '_layout.html') continue;
    const source = await readFile(file, 'utf8');
    if (name.startsWith('_')) partials[name.slice(1, -'.html'.length)] = source.trim();
    else pages.push(parsePage(source, name));
  }

  const output = new Map<string, string>();
  for (const page of pages) {
    const target = join(SITE_DIR, outputFile(page.path));
    const options = (await resolveConfig(target)) ?? {};
    output.set(
      target,
      await format(renderPage(layout, page, pages, partials), { ...options, parser: 'html' }),
    );
  }
  output.set(join(SITE_DIR, 'sitemap.xml'), renderSitemap(pages));
  return output;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const output = await buildSite();
  const stale: string[] = [];
  for (const [file, content] of output) {
    const current = await readFile(file, 'utf8').catch(() => null);
    if (current === content) continue;
    if (check) {
      stale.push(file);
    } else {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
  }
  if (check && stale.length > 0) {
    console.error(
      `Out of date; run npm run site:pages:\n${stale.map((file) => `  ${file}`).join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(check ? `${output.size} files up to date` : `Wrote ${output.size} files`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
