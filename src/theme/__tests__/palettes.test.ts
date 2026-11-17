import { darkPalette, lightPalette, type ColorPalette } from '../palettes';

/** WCAG 2.x relative luminance of a `#RRGGBB` colour. */
function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(start => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal-size text. */
const AA_TEXT = 4.5;

describe.each<[string, ColorPalette]>([
  ['dark', darkPalette],
  ['light', lightPalette],
])('%s palette', (_name, palette) => {
  const backgrounds = [
    ['background', palette.background],
    ['surface', palette.surface],
    ['surfaceMuted', palette.surfaceMuted],
  ] as const;

  it('uses #RRGGBB for every colour so tints can be derived', () => {
    const colours = [
      palette.background,
      palette.surface,
      palette.surfaceMuted,
      palette.border,
      palette.textPrimary,
      palette.textSecondary,
      palette.textMuted,
      palette.accent,
      palette.onAccent,
      ...Object.values(palette.tone),
    ];
    for (const colour of colours) {
      expect(colour).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it.each([
    ['textPrimary', palette.textPrimary],
    ['textSecondary', palette.textSecondary],
    ['textMuted', palette.textMuted],
  ])('%s is readable on every background', (_token, colour) => {
    for (const [, background] of backgrounds) {
      expect(contrastRatio(colour, background)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('keeps button text readable on the accent colour', () => {
    expect(
      contrastRatio(palette.onAccent, palette.accent),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(Object.entries(palette.tone))(
    'tone "%s" is readable on card surfaces',
    (_tone, colour) => {
      expect(contrastRatio(colour, palette.surface)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
      expect(
        contrastRatio(colour, palette.surfaceMuted),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );
});
