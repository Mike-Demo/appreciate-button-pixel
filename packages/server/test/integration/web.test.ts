import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_COLORS, DEFAULT_SVG_SOURCE } from '../../src/lib/default-icon.js';
import { DEFAULT_THANKS_MESSAGE } from '../../src/lib/default-thanks.js';
import { closeTestContext, createTestContext, type TestContext } from './helpers.js';

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "img-src 'self' data: https://avatars.githubusercontent.com; form-action 'self'; base-uri 'none'";

describe('web pages', () => {
  const contexts: TestContext[] = [];

  async function context(overrides: Parameters<typeof createTestContext>[0] = {}) {
    const created = await createTestContext(overrides);
    contexts.push(created);
    return created;
  }

  afterEach(async () => {
    await Promise.all(contexts.splice(0).map((created) => closeTestContext(created)));
  });

  function get(app: TestContext['app'], url: string) {
    return app.inject({ method: 'GET', url });
  }

  function expectSecurityHeaders(headers: Record<string, unknown>): void {
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toBe(CSP);
  }

  /**
   * The CSP forbids inline script and style, so the markup must not rely on
   * any. Structured data (`application/ld+json`) is the one inline script
   * allowed: it is data, which the browser never runs.
   */
  function expectNoInlineCode(html: string): void {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")/i);
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  }

  it.each([
    ['/', 'landing.js'],
    ['/leaderboard', 'leaderboard.js'],
    ['/dashboard', '/web/dashboard.js'],
  ])(
    'serves the page at %s uncached, with security headers and no inline code',
    async (url, script) => {
      const { app } = await context();

      const response = await get(app, url);

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(response.headers['cache-control']).toBe('no-store');
      expectSecurityHeaders(response.headers);
      expect(response.body).toContain(`<script src="${script}"></script>`);
      expectNoInlineCode(response.body);
    },
  );

  it.each([
    ['/site/site.css', 'text/css; charset=utf-8'],
    ['/site/landing.js', 'application/javascript; charset=utf-8'],
    ['/site/img/heart.svg', 'image/svg+xml'],
    ['/site.css', 'text/css; charset=utf-8'],
    ['/img/heart.svg', 'image/svg+xml'],
    ['/web/dashboard.css', 'text/css; charset=utf-8'],
    ['/web/dashboard.js', 'application/javascript; charset=utf-8'],
    ['/robots.txt', 'text/plain; charset=utf-8'],
    ['/sitemap.xml', 'application/xml; charset=utf-8'],
    ['/img/og.png', 'image/png'],
  ])('serves the asset at %s checked on every load, with security headers', async (url, type) => {
    const { app } = await context();

    const response = await get(app, url);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe(type);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers.etag).toMatch(/^"[\w-]{22}"$/);
    expectSecurityHeaders(response.headers);
    expect(response.body.length).toBeGreaterThan(0);

    // Unchanged since the browser's copy: a bodiless 304 it can reuse.
    const again = await app.inject({
      method: 'GET',
      url,
      headers: { 'if-none-match': String(response.headers.etag) },
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect(again.headers.etag).toBe(response.headers.etag);
  });

  it('sends an asset again when the browser holds a different version', async () => {
    const { app } = await context();

    const response = await app.inject({
      method: 'GET',
      url: '/web/dashboard.css',
      headers: { 'if-none-match': '"an-older-version-of-it"' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('serves a page by its clean URL, without .html, as GitHub Pages does', async () => {
    const { app } = await context();

    const clean = await get(app, '/index');

    expect(clean.statusCode).toBe(200);
    expect(clean.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(clean.headers['cache-control']).toBe('no-store');
    expect(clean.body).toBe((await get(app, '/index.html')).body);
  });

  it.each(['/clap-button', '/guides/', '/guides/hugo', '/alternatives/applause-button'])(
    'serves the generated page at %s like the hand-written ones',
    async (url) => {
      const { app } = await context();

      const response = await get(app, url);

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(response.headers['cache-control']).toBe('no-store');
      expectSecurityHeaders(response.headers);
      expect(response.body).toContain(
        `<link rel="canonical" href="https://appreciator.medhat.dev${url}" />`,
      );
      expectNoInlineCode(response.body);
    },
  );

  it('sends a folder of pages asked for without its slash to the folder', async () => {
    const { app } = await context();

    const response = await get(app, '/guides');

    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe('/guides/');
  });

  it('refuses inline script that is not structured data', () => {
    expect(() => expectNoInlineCode('<script>alert(1)</script>')).toThrow();
    expect(() => expectNoInlineCode('<script type="module">alert(1)</script>')).toThrow();
    expect(() =>
      expectNoInlineCode('<script type="application/ld+json">{}</script>'),
    ).not.toThrow();
  });

  it.each(['/', '/leaderboard', '/dashboard', '/guides/hugo'])(
    'credits the author in the footer of %s',
    async (url) => {
      const { app } = await context();

      expect((await get(app, url)).body).toMatch(
        /<p class="credit">[\s\S]*<a href="https:\/\/medhat\.dev">Medhat Dawoud<\/a>/,
      );
    },
  );

  it('keeps the dashboard out of search results', async () => {
    const { app } = await context();

    expect((await get(app, '/dashboard')).body).toContain(
      '<meta name="robots" content="noindex" />',
    );
    expect((await get(app, '/robots.txt')).body).toMatch(/^Disallow: \/dashboard$/m);
  });

  it('serves the same bytes under /site/ as at the root', async () => {
    const { app } = await context();

    expect((await get(app, '/site/site.css')).body).toBe((await get(app, '/site.css')).body);
  });

  it.each([
    '/site/../package.json',
    '/site/../../package.json',
    '/site/README.md',
    '/site/nope.css',
    '/site/img',
    '/web/../package.json',
    '/web/nope.js',
    '/README.md',
    '/README',
    '/nope',
    '/img',
    '/img/',
    '/..%2fpackage',
  ])('answers the usual 404 for %s', async (url) => {
    const { app } = await context();

    const response = await get(app, url);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404, error: 'not_found' });
  });

  it('serves the web config at /config.json for the landing page, identical to /web/config.json', async () => {
    const { app } = await context({ signInEnabled: true, leaderboardEnabled: false });

    const [root, web] = await Promise.all([get(app, '/config.json'), get(app, '/web/config.json')]);

    expect(root.statusCode).toBe(200);
    expect(root.headers['cache-control']).toBe('no-store');
    expect(root.json()).toEqual(web.json());
    expect(root.json()).toEqual({
      apiUrl: 'https://appreciator.test',
      demoKey: null,
      signInEnabled: true,
      repoUrl: 'https://github.com/medhatdawoud/appreciator',
      leaderboardEnabled: false,
      defaultIcon: { svgSource: DEFAULT_SVG_SOURCE, colors: DEFAULT_COLORS },
      defaultThanksMessage: DEFAULT_THANKS_MESSAGE,
    });
  });
});
