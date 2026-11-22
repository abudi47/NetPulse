import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../shared/components/Card';
import { StatusBadge } from '../../../shared/components/StatusBadge';
import { useThemedStyles, type Theme } from '../../../theme';
import type { ConnectionSection } from '../dashboardViewModel';
import { describeReading } from '../presentation';

interface ConnectionCardProps {
  readonly section: ConnectionSection;
}

/** Current network details. Unmeasured values are labelled as such. */
export function ConnectionCard({ section }: ConnectionCardProps) {
  const styles = useThemedStyles(createStyles);
  const { readings, badge, note } = section;

  return (
    <Card>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.heading}>
          Connection
        </Text>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </View>

      {readings.map((item, index) => {
        const { text, isMeasured } = describeReading(item.reading);
        return (
          <View
            accessible
            accessibilityLabel={`${item.label}: ${text}`}
            key={item.id}
            style={[styles.row, index > 0 && styles.rowDivider]}
          >
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={isMeasured ? styles.rowValue : styles.rowPlaceholder}>
              {text}
            </Text>
          </View>
        );
      })}

      {note === null ? null : <Text style={styles.footnote}>{note}</Text>}
    </Card>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.sm,
    },
    heading: {
      ...theme.typography.heading,
      color: theme.colors.textPrimary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // Lets the value drop below its label at large font sizes.
      flexWrap: 'wrap',
      columnGap: theme.spacing.lg,
      rowGap: 2,
      paddingVertical: theme.spacing.md,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    rowLabel: {
      ...theme.typography.body,
      color: theme.colors.textSecondary,
    },
    rowValue: {
      ...theme.typography.body,
      fontWeight: '600',
      color: theme.colors.textPrimary,
    },
    rowPlaceholder: {
      ...theme.typography.body,
      color: theme.colors.textMuted,
    },
    footnote: {
      ...theme.typography.caption,
      color: theme.colors.textMuted,
      marginTop: theme.spacing.sm,
    },
  });
