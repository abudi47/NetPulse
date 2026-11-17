import { darkPalette, lightPalette, type ColorPalette } from './palettes';
import { radius, spacing, typography } from './tokens';

export type ColorScheme = 'dark' | 'light';

/** What the user (later: the Settings screen) asks for. */
export type ThemePreference = ColorScheme | 'system';

export interface Theme {
  readonly scheme: ColorScheme;
  readonly colors: ColorPalette;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly typography: typeof typography;
}

export const themes: Readonly<Record<ColorScheme, Theme>> = {
  dark: { scheme: 'dark', colors: darkPalette, spacing, radius, typography },
  light: { scheme: 'light', colors: lightPalette, spacing, radius, typography },
};

/**
 * NetPulse is dark-first: the dark theme is used unless light is explicitly
 * chosen. `'system'` follows the phone's setting.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

/**
 * Turns a preference into the scheme to draw. An unknown system scheme
 * resolves to dark, in keeping with the dark-first default.
 */
export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): ColorScheme {
  if (preference !== 'system') {
    return preference;
  }
  return systemScheme === 'light' ? 'light' : 'dark';
}
