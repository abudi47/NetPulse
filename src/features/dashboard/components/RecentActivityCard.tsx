import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../../shared/components/Card';
import { useTheme, useThemedStyles, type Theme } from '../../../theme';
import type { ActivityItem } from '../dashboardViewModel';

interface RecentActivityCardProps {
  /** Newest first. */
  readonly items: readonly ActivityItem[];
}

/**
 * What monitoring has done and found, newest first. The list covers the
 * time the app has been open; nothing is stored between launches yet.
 */
export function RecentActivityCard({ items }: RecentActivityCardProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Card>
      <Text accessibilityRole="header" style={styles.heading}>
        Recent activity
      </Text>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyBody}>
            Incidents and recovery requests will be listed here after monitoring
            has run.
          </Text>
        </View>
      ) : (
        items.map((item, index) => (
          <View
            accessible
            accessibilityLabel={`${item.time}. ${item.title}.${
              item.detail === null ? '' : ` ${item.detail}`
            }`}
            key={item.key}
            style={[styles.item, index > 0 && styles.itemDivider]}
          >
            <View
              style={[
                styles.marker,
                { backgroundColor: theme.colors.tone[item.tone] },
              ]}
            />
            <View style={styles.itemText}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.itemTime}>{item.time}</Text>
              </View>
              {item.detail === null ? null : (
                <Text style={styles.itemDetail}>{item.detail}</Text>
              )}
            </View>
          </View>
        ))
      )}
    </Card>
  );
}

const MARKER_SIZE = 8;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    heading: {
      ...theme.typography.heading,
      color: theme.colors.textPrimary,
      marginBottom: theme.spacing.md,
    },
    emptyState: {
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.xl,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    emptyTitle: {
      ...theme.typography.heading,
      color: theme.colors.textPrimary,
      textAlign: 'center',
    },
    emptyBody: {
      ...theme.typography.caption,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    item: {
      flexDirection: 'row',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    itemDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    marker: {
      width: MARKER_SIZE,
      height: MARKER_SIZE,
      borderRadius: MARKER_SIZE / 2,
      // Lines the dot up with the first line of the title.
      marginTop: (theme.typography.body.lineHeight - MARKER_SIZE) / 2,
    },
    itemText: {
      flex: 1,
      gap: 2,
    },
    itemHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      columnGap: theme.spacing.md,
    },
    itemTitle: {
      ...theme.typography.body,
      fontWeight: '600',
      color: theme.colors.textPrimary,
      flexShrink: 1,
    },
    itemTime: {
      ...theme.typography.caption,
      lineHeight: theme.typography.body.lineHeight,
      color: theme.colors.textMuted,
      fontVariant: ['tabular-nums'],
    },
    itemDetail: {
      ...theme.typography.caption,
      color: theme.colors.textSecondary,
    },
  });
