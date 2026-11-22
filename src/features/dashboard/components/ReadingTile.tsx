import { StyleSheet, Text } from 'react-native';
import { Card } from '../../../shared/components/Card';
import { useThemedStyles, type Theme } from '../../../theme';
import type { DashboardReading } from '../dashboardViewModel';
import { describeReading } from '../presentation';

interface ReadingTileProps {
  readonly item: DashboardReading;
  /** One line saying what this tile will report. */
  readonly caption: string;
}

/** A compact card for a single headline value. */
export function ReadingTile({ item, caption }: ReadingTileProps) {
  const styles = useThemedStyles(createStyles);
  const { text, isMeasured } = describeReading(item.reading);

  return (
    <Card
      accessible
      accessibilityLabel={`${item.label}: ${text}. ${caption}`}
      style={styles.tile}
    >
      <Text style={styles.label}>{item.label}</Text>
      <Text style={isMeasured ? styles.value : styles.placeholder}>{text}</Text>
      <Text style={styles.caption}>{caption}</Text>
    </Card>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    tile: {
      // Two tiles sit side by side when there is room and stack when there
      // is not (narrow screens, large font sizes).
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 148,
      gap: theme.spacing.xs,
    },
    label: {
      ...theme.typography.label,
      color: theme.colors.textMuted,
    },
    value: {
      ...theme.typography.heading,
      color: theme.colors.textPrimary,
    },
    placeholder: {
      ...theme.typography.heading,
      fontWeight: '400',
      color: theme.colors.textMuted,
    },
    caption: {
      ...theme.typography.caption,
      color: theme.colors.textSecondary,
    },
  });
