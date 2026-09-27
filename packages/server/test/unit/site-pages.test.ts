import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  SITE_ORIGIN,
  breadcrumbs,
  buildSite,
  canonicalUrl,
  outputFile,
  parsePage,
  pathFor,
  renderPage,
  renderSitemap,
  rootFor,
  structuredData,
  type Page,
} from '../../scripts/site-pages.js';

function page(overrides: Partial<Page> = {}): Page {
  return {
    title: 'Hugo guide',
    description: 'How to add it to Hugo.',
    path: 'guides/hugo',
    crumb: 'Hugo',
    body: '<h1>Hugo</h1>',
    ...overrides,
  };
}

const guides = page({ title: 'Guides', path: 'guides/', crumb: 'Guides' });
const hugo = page();

describe('site pages', () => {
  describe('paths', () => {
    it('serves each source file at its clean URL', () => {
      expect(pathFor('clap-button.html')).toBe('clap-button');
      expect(pathFor('guides/hugo.html')).toBe('guides/hugo');
      expect(pathFor('guides/index.html')).toBe('guides/');
    });

    it('writes each page where its clean URL finds it', () => {
      expect(outputFile('clap-button')).toBe('clap-button.html');
      expect(outputFile('guides/hugo')).toBe('guides/hugo.html');
      expect(outputFile('guides/')).toBe('guides/index.html');
    });

    it('links back to the site root relatively, one level per folder', () => {
      expect(rootFor('clap-button')).toBe('./');
      expect(rootFor('guides/')).toBe('../');
      expect(rootFor('guides/hugo')).toBe('../');
    });

    it('gives every page one canonical URL on the site origin', () => {
      expect(canonicalUrl('guides/hugo')).toBe(`${SITE_ORIGIN}/guides/hugo`);
      expect(canonicalUrl('')).toBe(`${SITE_ORIGIN}/`);
    });
  });

  describe('parsePage', () => {
    const source = '<!--\ntitle: A: title\ndescription: Words.\ncrumb: Short\n-->\n<h1>Body</h1>\n';

    it('reads the front block and keeps the body', () => {
      expect(parsePage(source, 'guides/x.html')).toEqual({
        title: 'A: title',
        description: 'Words.',
        crumb: 'Short',
        path: 'guides/x',
        body: '<h1>Body</h1>\n',
      });
    });

    it('refuses a page without a front block, or missing a field', () => {
      expect(() => parsePage('<h1>Body</h1>', 'x.html')).toThrow(/no front block/);
      expect(() => parsePage('<!--\ntitle: T\ncrumb: C\n-->\n', 'x.html')).toThrow(
        /needs description/,
      );
    });

    it('refuses a source for the home page, which is written by hand', () => {
      expect(() => parsePage(source, 'index.html')).toThrow(/home page/);
    });
  });

  describe('breadcrumbs and structured data', () => {
    it('leads from the home page through the folder page', () => {
      expect(breadcrumbs(hugo, [guides, hugo])).toEqual([
        { name: 'Appreciate Button', path: '' },
        { name: 'Guides', path: 'guides/' },
        { name: 'Hugo', path: 'guides/hugo' },
      ]);
      expect(breadcrumbs(guides, [guides, hugo])).toHaveLength(2);
    });

    it('refuses a page whose folder has no page of its own', () => {
      expect(() => breadcrumbs(hugo, [hugo])).toThrow(/no page for its folder guides\//);
    });

    it('describes the page and its trail, with nothing that could close the script', () => {
      const data = structuredData(page({ title: 'A </script> title' }), [guides]);

      expect(data).not.toContain('<');
      const parsed = JSON.parse(data);
      expect(parsed['@graph'][0]).toMatchObject({
        '@type': 'WebPage',
        url: `${SITE_ORIGIN}/guides/hugo`,
        name: 'A </script> title',
      });
      expect(
        parsed['@graph'][1].itemListElement.map((item: { item: string }) => item.item),
      ).toEqual([`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/guides/`, `${SITE_ORIGIN}/guides/hugo`]);
    });
  });

  describe('renderPage', () => {
    const layout =
      '<title>{{title}}</title><link rel="canonical" href="{{canonical}}" />' +
      '<a href="{{root}}">home</a><main>{{breadcrumbs}}{{content}}</main>';

    it('fills the layout, escaping the title and resolving links from the page', () => {
      const html = renderPage(
        layout,
        page({ title: 'Hugo & friends', body: '<a href="{{root}}guides/">all</a>{{before}}' }),
        [guides],
        { before: '<a href="{{root}}#install">install</a>' },
      );

      expect(html).toContain('<title>Hugo &amp; friends</title>');
      expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/guides/hugo" />`);
      expect(html).toContain('<a href="../guides/">all</a>');
      expect(html).toContain('<a href="../#install">install</a>');
      expect(html).toContain('<li><a href="../guides/">Guides</a></li>');
      expect(html).toContain('<li aria-current="page">Hugo</li>');
    });

    it("leaves other templates' syntax alone, and refuses an unknown placeholder", () => {
      const kept = renderPage(layout, page({ body: '<code>{{ .Content }}</code>' }), [guides]);
      expect(kept).toContain('<code>{{ .Content }}</code>');

      expect(() => renderPage(layout, page({ body: '{{nope}}' }), [guides])).toThrow(
        /unknown placeholder \{\{nope\}\}/,
      );
    });
  });

  it('lists the hand-written pages and every generated one in the sitemap, by canonical URL', () => {
    const sitemap = renderSitemap([guides, hugo]);

    expect([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1])).toEqual([
      `${SITE_ORIGIN}/`,
      `${SITE_ORIGIN}/leaderboard`,
      `${SITE_ORIGIN}/guides/`,
      `${SITE_ORIGIN}/guides/hugo`,
    ]);
  });

  it('matches the committed pages: run npm run site:pages after changing site-pages/', async () => {
    const output = await buildSite();

    expect(output.size).toBeGreaterThan(1);
    for (const [file, content] of output) {
      expect(await readFile(file, 'utf8'), file).toBe(content);
    }
  });
});
