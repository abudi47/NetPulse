import type { NetworkSnapshot } from '../../domain/models/network';
import type { NetPulseBridge } from '../../native/NetPulseNative';

/** What the app currently knows about the default network, and how it knows. */
export type NetworkObservation =
  /** The native module is not part of this build or platform. */
  | { readonly status: 'unavailable' }
  /** Nobody is watching (no screen needs it, or the app is in the background). */
  | { readonly status: 'idle' }
  /** Native has been asked to start and has not answered yet. */
  | { readonly status: 'starting' }
  /** Watching; `snapshot` is the latest state Android reported. */
  | { readonly status: 'observing'; readonly snapshot: NetworkSnapshot }
  /** Starting failed. `message` is safe to log; it holds no network details. */
  | { readonly status: 'error'; readonly message: string };

/** Whether the app is in the foreground. Injected so tests need no real AppState. */
export interface AppLifecycle {
  isActive(): boolean;
  /** Calls `listener` on every change. Returns a function that stops listening. */
  onChange(listener: (active: boolean) => void): () => void;
}

export interface NetworkSnapshotStore {
  getState(): NetworkObservation;
  /** Shaped for React's `useSyncExternalStore`. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/**
 * Keeps one native network observation alive for as long as it is wanted.
 *
 * Native observation runs only while at least one subscriber exists *and* the
 * app is in the foreground. It is stopped (and Android's callback
 * unregistered) when the last subscriber leaves or the app goes to the
 * background, and restarted when both conditions hold again. Any number of
 * screens can subscribe; native is only ever asked to observe once.
 */
export function createNetworkSnapshotStore(
  bridge: NetPulseBridge,
  lifecycle: AppLifecycle,
  log: (message: string) => void = message => console.warn(message),
): NetworkSnapshotStore {
  const listeners = new Set<() => void>();
  let state: NetworkObservation = bridge.isAvailable()
    ? { status: 'idle' }
    : { status: 'unavailable' };

  /** Identifies the current observation run; results from older runs are dropped. */
  let run = 0;
  let stopRun: (() => void) | null = null;
  let stopLifecycle: (() => void) | null = null;

  const setState = (next: NetworkObservation) => {
    state = next;
    listeners.forEach(listener => listener());
  };

  const apply = (snapshot: NetworkSnapshot) => {
    // Android's callbacks are ordered, but the answer to "start" and the first
    // change event travel separately; never let an older one overwrite a newer.
    if (
      state.status === 'observing' &&
      snapshot.capturedAtMs < state.snapshot.capturedAtMs
    ) {
      return;
    }
    setState({ status: 'observing', snapshot });
  };

  const begin = () => {
    const thisRun = ++run;
    setState({ status: 'starting' });

    const removeListener = bridge.addNetworkListener(
      snapshot => {
        if (thisRun === run) {
          apply(snapshot);
        }
      },
      error => log(`[NetPulse] Ignored a network event: ${error.code}`),
    );

    stopRun = () => {
      removeListener();
      bridge
        .stopObserving()
        .catch(error =>
          log(`[NetPulse] Could not stop network observation: ${error.code}`),
        );
    };

    bridge.startObserving().then(
      snapshot => {
        if (thisRun === run) {
          apply(snapshot);
        }
      },
      error => {
        if (thisRun === run) {
          log(`[NetPulse] Could not start network observation: ${error.code}`);
          setState({ status: 'error', message: error.code });
        }
      },
    );
  };

  const end = () => {
    run++;
    stopRun?.();
    stopRun = null;
    setState({ status: 'idle' });
  };

  /** Starts or stops the native observation to match what is currently wanted. */
  const reconcile = () => {
    const wanted = listeners.size > 0 && lifecycle.isActive();
    if (wanted && stopRun === null) {
      begin();
    } else if (!wanted && stopRun !== null) {
      end();
    }
  };

  return {
    getState: () => state,

    subscribe: listener => {
      listeners.add(listener);
      if (bridge.isAvailable()) {
        stopLifecycle ??= lifecycle.onChange(reconcile);
        reconcile();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopLifecycle?.();
          stopLifecycle = null;
        }
        if (bridge.isAvailable()) {
          reconcile();
        }
      };
    },
  };
}
