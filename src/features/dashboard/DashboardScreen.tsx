import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useThemedStyles, type Theme } from '../../theme';
import { ConnectionCard } from './components/ConnectionCard';
import { DashboardHeader } from './components/DashboardHeader';
import { MonitoringStatusCard } from './components/MonitoringStatusCard';
import { ReadingTile } from './components/ReadingTile';
import { RecentActivityCard } from './components/RecentActivityCard';
import { useDashboardViewModel } from './useDashboardViewModel';

export function DashboardScreen() {
  const dashboard = useDashboardViewModel();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    // The app draws edge to edge. Top and side insets pad the screen so
    // content never sits under the status bar or a display cutout; the bottom
    // inset pads the scroll content so the last card clears the gesture bar.
    <View
      style={[
        styles.screen,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.xl },
        ]}
      >
        <DashboardHeader />
        <MonitoringStatusCard status={dashboard.monitoring} />
        <ConnectionCard section={dashboard.connection} />
        <View style={styles.tiles}>
          <ReadingTile
            caption="Last time Android was asked to re-check. A request, not a guaranteed fix."
            item={dashboard.recovery}
          />
          <ReadingTile
            caption="Approximate data used by health checks this session."
            item={dashboard.diagnosticData}
          />
        </View>
        <RecentActivityCard items={dashboard.activity} />
      </ScrollView>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      // Keeps cards a comfortable width on tablets and in landscape.
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      gap: theme.spacing.lg,
    },
    tiles: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.lg,
    },
  });
