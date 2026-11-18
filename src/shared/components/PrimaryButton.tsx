import { Pressable, StyleSheet, Text } from 'react-native';
import {
  minTouchTarget,
  useTheme,
  useThemedStyles,
  withAlpha,
  type Theme,
} from '../../theme';

interface PrimaryButtonProps {
  readonly label: string;
  /** Omit together with `disabled` when there is nothing the button can do. */
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  /** Read by screen readers after the label, e.g. why the button is disabled. */
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/** The single high-emphasis action on a screen. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  accessibilityHint,
  testID,
}: PrimaryButtonProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      android_ripple={{ color: withAlpha(theme.colors.onAccent, 0.16) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      testID={testID}
    >
      <Text style={[styles.label, disabled && styles.labelDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    button: {
      minHeight: minTouchTarget + 4,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accent,
      // Keeps the Android ripple inside the rounded corners.
      overflow: 'hidden',
    },
    buttonPressed: {
      opacity: 0.85,
    },
    buttonDisabled: {
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
    },
    label: {
      ...theme.typography.heading,
      color: theme.colors.onAccent,
      textAlign: 'center',
    },
    labelDisabled: {
      color: theme.colors.textMuted,
    },
  });
