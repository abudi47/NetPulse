import { StyleSheet, Text, View } from 'react-native';
import { useTheme, useThemedStyles, type Theme, type Tone } from '../../theme';

interface StatusBadgeProps {
  readonly label: string;
  readonly tone: Tone;
}

/** A small pill that qualifies the content next to it. */
export function StatusBadge({ label, tone }: StatusBadgeProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.badge}>
      <Text style={[styles.label, { color: theme.colors.tone[tone] }]}>
        {label}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: theme.spacing.sm + 2,
      paddingVertical: theme.spacing.xs,
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
    label: {
      ...theme.typography.label,
    },
  });
