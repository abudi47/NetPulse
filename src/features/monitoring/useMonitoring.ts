import { useSyncExternalStore } from 'react';
import type { MonitoringView } from './monitoringController';
import { monitoringController } from './services';

export interface Monitoring {
  readonly view: MonitoringView;
  readonly start: () => void;
  readonly stop: () => void;
  readonly openNetworkSettings: () => void;
}

/** The monitoring session: its current state and what a user can do about it. */
export function useMonitoring(): Monitoring {
  const view = useSyncExternalStore(
    monitoringController.subscribe,
    monitoringController.getState,
  );
  return {
    view,
    start: monitoringController.start,
    stop: monitoringController.stop,
    openNetworkSettings: monitoringController.openNetworkSettings,
  };
}
