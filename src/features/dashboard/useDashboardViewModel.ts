import { useMemo } from 'react';
import { useMonitoring } from '../monitoring/useMonitoring';
import { useNetworkObservation } from '../monitoring/useNetworkObservation';
import { buildDashboard, type DashboardViewModel } from './dashboardViewModel';

/**
 * Supplies the dashboard's data: the live network observation and the
 * monitoring session, turned into display-ready values by `buildDashboard`.
 */
export function useDashboardViewModel(): DashboardViewModel {
  const network = useNetworkObservation();
  const { view, start, stop, openNetworkSettings } = useMonitoring();

  return useMemo(
    () =>
      buildDashboard({
        network,
        monitoring: view,
        onStartMonitoring: start,
        onStopMonitoring: stop,
        onOpenNetworkSettings: openNetworkSettings,
      }),
    [network, view, start, stop, openNetworkSettings],
  );
}
