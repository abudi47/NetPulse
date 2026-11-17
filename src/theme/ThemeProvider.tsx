import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import { Appearance, useColorScheme } from 'react-native';
import {
  DEFAULT_THEME_PREFERENCE,
  resolveColorScheme,
  themes,
  type Theme,
  type ThemePreference,
} from './theme';

const ThemeContext = createContext<Theme>(themes.dark);

interface ThemeProviderProps {
  /** Defaults to dark. Pass `'light'` or `'system'` to opt in to the light theme. */
  readonly preference?: ThemePreference;
  readonly children: ReactNode;
}

export function ThemeProvider({
  preference = DEFAULT_THEME_PREFERENCE,
  children,
}: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const theme = themes[resolveColorScheme(preference, systemScheme)];

  // Tell the platform which scheme the app is using, so pieces React Native
  // does not draw itself (system dialogs, overscroll glow, text-selection
  // handles) match the app instead of the phone's setting.
  useEffect(() => {
    Appearance.setColorScheme(preference === 'system' ? 'auto' : preference);
  }, [preference]);

  return <ThemeContext value={theme}>{children}</ThemeContext>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Builds a component's styles from the active theme and rebuilds them only
 * when the theme changes. Define `createStyles` at module scope so its
 * identity is stable:
 *
 *   const createStyles = (theme: Theme) => StyleSheet.create({ ... });
 */
export function useThemedStyles<T>(createStyles: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => createStyles(theme), [createStyles, theme]);
}
