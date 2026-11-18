import { Pressable, StyleSheet, Text } from 'react-native';
import {
  minTouchTarget,
  useTheme,
  useThemedStyles,
  withAlpha,
  type Theme,
} from '../../theme';

interface SecondaryButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID?: string;
}

/** A lower-emphasis action that sits beside or below the primary one. */
export function SecondaryButton({
  label,
  onPress,
  testID,
}: SecondaryButtonProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      android_ripple={{ color: withAlpha(theme.colors.accent, 0.16) }}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      testID={testID}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    button: {
      minHeight: minTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.accent,
      // Keeps the Android ripple inside the rounded corners.
      overflow: 'hidden',
    },
    buttonPressed: {
      opacity: 0.85,
    },
    label: {
      ...theme.typography.heading,
      color: theme.colors.accent,
      textAlign: 'center',
    },
  });
