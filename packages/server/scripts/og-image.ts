/**
 * Renders the site's link-preview image, `site/img/og.png` (1200×630, the
 * size Open Graph and X's large cards expect), from a small HTML card. Run it
 * again after changing the card; the image is committed.
 *
 *   npm run site:og-image
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUTPUT = join(REPO_ROOT, 'site', 'img', 'og.png');

const heart = await readFile(join(REPO_ROOT, 'site', 'img', 'heart.svg'), 'utf8');

const card = `<!doctype html>
<html>
  <head>
    <style>
      body {
        margin: 0;
        width: 1200px;
        height: 630px;
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 72px;
        padding: 0 96px;
        box-sizing: border-box;
        background: #fffdfc;
        color: #1f1a1c;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        border-bottom: 16px solid #e11d48;
      }
      .icon { width: 260px; height: 260px; }
      .icon svg { width: 100%; height: 100%; }
      h1 { margin: 0 0 20px; font-size: 88px; letter-spacing: -0.02em; line-height: 1; }
      p { margin: 0; font-size: 40px; line-height: 1.3; color: #4b4246; }
      .url { margin-top: 36px; font-size: 30px; color: #e11d48; }
    </style>
  </head>
  <body>
    <div class="icon">${heart}</div>
    <div>
      <h1>Appreciate Button</h1>
      <p>Open-source clap, applause and like button for any website.</p>
      <p class="url">appreciate-button.com</p>
    </div>
  </body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(card);
  await page.screenshot({ path: OUTPUT, type: 'png' });
  console.log(`Wrote ${OUTPUT}`);
} finally {
  await browser.close();
}
