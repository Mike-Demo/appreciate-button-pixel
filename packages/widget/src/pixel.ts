/**
 * The pixel-art icon for the pixel version of the widget.
 *
 * When the button carries `data-pixel` (or the embed script tag does), the
 * widget draws this rainbow pixel heart instead of the configured SVG icon.
 * The fill is snapped to whole pixel rows, so the heart fills stripe by
 * stripe as the visitor spends their allowance, in the order of the rainbow
 * flag from the bottom up.
 */

/** 7x6 pixel heart. `X` = pixel. */
export const PIXEL_HEART: readonly string[] = [
  '.XX.XX.',
  'XXXXXXX',
  'XXXXXXX',
  '.XXXXX.',
  '..XXX..',
  '...X...',
];

/** Pixel rows in the heart, top to bottom. */
export const PIXEL_ROWS = PIXEL_HEART.length;

/** Rainbow flag stripes, top row to bottom row. */
export const PIXEL_RAINBOW: readonly string[] = [
  '#E40303',
  '#FF8C00',
  '#FFED00',
  '#008026',
  '#24408E',
  '#732982',
];

/**
 * The heart as an SVG string. Every pixel is a `<rect class="px">` tagged
 * with its row in `data-row`; the widget's pixel styles paint the base layer
 * gray and the fill layer rainbow, row by row. `shape-rendering` keeps the
 * pixels crisp at any size.
 */
export function pixelHeartSvg(pixelSize = 8): string {
  const width = PIXEL_HEART[0].length * pixelSize;
  const height = PIXEL_HEART.length * pixelSize;
  let rects = '';
  PIXEL_HEART.forEach((line, y) => {
    for (let x = 0; x < line.length; x += 1) {
      if (line[x] !== 'X') continue;
      rects += `<rect class="px" data-row="${y}" x="${x * pixelSize}" y="${y * pixelSize}" width="${pixelSize}" height="${pixelSize}"/>`;
    }
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`
  );
}

/**
 * The fill layer's top clip inset, in percent, snapped to whole pixel rows:
 * a fill of 30% on a 6-row heart reveals the bottom 2 rows (33%), never a
 * fraction of a pixel.
 */
export function pixelClipInsetTop(fillPercent: number): number {
  const clamped = Math.min(100, Math.max(0, fillPercent));
  const rows = Math.round((clamped / 100) * PIXEL_ROWS);
  return Math.round((1 - rows / PIXEL_ROWS) * 100);
}
