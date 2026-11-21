import { useSyncExternalStore } from 'react';
import type { NetworkObservation } from './networkSnapshotStore';
import { networkSnapshotStore } from './services';

/**
 * The live state of the phone's default network.
 *
 * Mounting a component that uses this hook starts the native observation;
 * unmounting the last one, or sending the app to the background, stops it.
 */
export function useNetworkObservation(): NetworkObservation {
  return useSyncExternalStore(
    networkSnapshotStore.subscribe,
    networkSnapshotStore.getState,
  );
}
