import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../shared/components/Card';
import { PrimaryButton } from '../../../shared/components/PrimaryButton';
import { SecondaryButton } from '../../../shared/components/SecondaryButton';
import {
  useTheme,
  useThemedStyles,
  withAlpha,
  type Theme,
} from '../../../theme';
import type { MonitoringStatus } from '../dashboardViewModel';
import {
  describeMonitoringState,
  monitoringControlLabel,
} from '../presentation';

interface MonitoringStatusCardProps {
  readonly status: MonitoringStatus;
}

/**
 * The dashboard's main element: what monitoring is doing right now and the
 * one control that starts or stops it.
 */
export function MonitoringStatusCard({ status }: MonitoringStatusCardProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { title, description, tone } = describeMonitoringState(status.state);
  const toneColor = theme.colors.tone[tone];
  const { control } = status;

  return (
    <Card style={styles.card}>
      <View style={styles.statusRow}>
        {/* Decorative: the title next to it carries the same meaning. */}
        <View
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[styles.halo, { backgroundColor: withAlpha(toneColor, 0.14) }]}
        >
          <View style={[styles.dot, { backgroundColor: toneColor }]} />
        </View>
        <View style={styles.statusText}>
          <Text style={styles.eyebrow}>Monitoring status</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        </View>
      </View>

      <Text style={styles.description}>{status.detail ?? description}</Text>

      <PrimaryButton
        accessibilityHint={
          control.kind === 'unavailable' ? control.reason : undefined
        }
        disabled={control.kind === 'unavailable'}
        label={monitoringControlLabel(status.state)}
        onPress={control.kind === 'available' ? control.onPress : undefined}
        testID="monitoring-control"
      />

      {status.userAction === null ? null : (
        <SecondaryButton
          label={status.userAction.label}
          onPress={status.userAction.onPress}
          testID="monitoring-user-action"
        />
      )}

      {control.kind === 'unavailable' ? (
        <Text style={styles.controlNote}>{control.reason}</Text>
      ) : null}
      {status.notes.map(note => (
        <Text key={note} style={styles.controlNote}>
          {note}
        </Text>
      ))}
    </Card>
  );
}

const HALO_SIZE = 52;
const DOT_SIZE = 16;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      padding: theme.spacing.xl,
      gap: theme.spacing.lg,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.lg,
    },
    halo: {
      width: HALO_SIZE,
      height: HALO_SIZE,
      borderRadius: HALO_SIZE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dot: {
      width: DOT_SIZE,
      height: DOT_SIZE,
      borderRadius: DOT_SIZE / 2,
    },
    statusText: {
      flex: 1,
      gap: 2,
    },
    eyebrow: {
      ...theme.typography.label,
      color: theme.colors.textMuted,
    },
    title: {
      ...theme.typography.title,
      color: theme.colors.textPrimary,
    },
    description: {
      ...theme.typography.body,
      color: theme.colors.textSecondary,
    },
    controlNote: {
      ...theme.typography.caption,
      color: theme.colors.textMuted,
    },
  });
