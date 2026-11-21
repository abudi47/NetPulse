import { AppState } from 'react-native';
import { DEFAULT_MONITORING_CONFIG } from '../../domain/config/monitoringConfig';
import { netPulseBridge } from '../../native/NetPulseNative';
import { createMonitoringController } from './monitoringController';
import {
  createNetworkSnapshotStore,
  type AppLifecycle,
} from './networkSnapshotStore';

/*
 * The app's single instances of the monitoring services, wired to the real
 * native module, clock and timers. Everything they are built from takes its
 * dependencies as arguments, so tests construct their own with fakes.
 */

const appLifecycle: AppLifecycle = {
  // Anything other than a definite 'background' counts as foreground, so an
  // unknown state at startup does not block the first observation.
  isActive: () => AppState.currentState !== 'background',
  onChange: listener => {
    const subscription = AppState.addEventListener('change', nextState =>
      listener(nextState !== 'background'),
    );
    return () => subscription.remove();
  },
};

export const networkSnapshotStore = createNetworkSnapshotStore(
  netPulseBridge,
  appLifecycle,
);

export const monitoringController = createMonitoringController({
  bridge: netPulseBridge,
  networkStore: networkSnapshotStore,
  lifecycle: appLifecycle,
  config: DEFAULT_MONITORING_CONFIG,
  now: Date.now,
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
});
