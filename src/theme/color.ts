const HEX_RGB = /^#[0-9a-fA-F]{6}$/;

/**
 * Adds an alpha channel to a `#RRGGBB` colour, returning `#RRGGBBAA`.
 * Used for soft tints (a status halo, a button ripple) derived from a token.
 *
 * @throws if `hexColor` is not `#RRGGBB` or `alpha` is outside 0..1. Both are
 * programming errors, so failing loudly beats drawing the wrong colour.
 */
export function withAlpha(hexColor: string, alpha: number): string {
  if (!HEX_RGB.test(hexColor)) {
    throw new Error(`withAlpha expects a #RRGGBB colour, got "${hexColor}"`);
  }
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`withAlpha expects alpha between 0 and 1, got ${alpha}`);
  }
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `${hexColor}${channel}`;
}
