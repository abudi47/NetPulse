import { StyleSheet, View, type ViewProps } from 'react-native';
import { useThemedStyles, type Theme } from '../../theme';

/**
 * A bordered surface that groups related dashboard content. Accepts any View
 * prop, e.g. `accessible` + `accessibilityLabel` to have a screen reader
 * announce the whole card as one item.
 */
export function Card({ style, ...viewProps }: ViewProps) {
  const styles = useThemedStyles(createStyles);
  return <View {...viewProps} style={[styles.card, style]} />;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
    },
  });
