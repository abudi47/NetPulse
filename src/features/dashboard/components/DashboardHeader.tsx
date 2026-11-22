import { StyleSheet, Text, View } from 'react-native';
import { useThemedStyles, type Theme } from '../../../theme';

export function DashboardHeader() {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>
        NetPulse
      </Text>
      <Text style={styles.subtitle}>Network reliability assistant</Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    header: {
      paddingHorizontal: theme.spacing.xs,
      paddingTop: theme.spacing.sm,
      gap: 2,
    },
    title: {
      ...theme.typography.display,
      color: theme.colors.textPrimary,
    },
    subtitle: {
      ...theme.typography.caption,
      color: theme.colors.textSecondary,
    },
  });
