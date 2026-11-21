import NativeNetPulse from '../../specs/NativeNetPulse';
import type { NetworkSnapshot } from '../domain/models/network';
import type {
  ProbeEndpoint,
  ProbeRound,
  ProbeTimeouts,
} from '../domain/models/probe';
import type { RecoveryRequestOutcome } from '../domain/models/recovery';
import { NetPulseBridgeError, toBridgeError } from './errors';
import {
  parseNetworkSnapshot,
  parseProbeRound,
  parseRecoveryOutcome,
} from './native-events';

/**
 * The typed, validated doorway to the Android NetPulse module.
 *
 * The rest of the app depends on this interface rather than on the generated
 * native module, so that everything above it can be tested with a fake and
 * keeps working (showing "unavailable") where the native module is missing.
 */
export interface NetPulseBridge {
  /** False when the native module is not part of this build or platform. */
  isAvailable(): boolean;

  /** Reads the default network once. Rejects with {@link NetPulseBridgeError}. */
  getSnapshot(): Promise<NetworkSnapshot>;

  /**
   * Starts watching the default network and resolves with its current state.
   * Calling it while already observing registers nothing new.
   * Rejects with {@link NetPulseBridgeError}.
   */
  startObserving(): Promise<NetworkSnapshot>;

  /** Stops watching. Safe to call when not observing. */
  stopObserving(): Promise<void>;

  /**
   * Sends one small HTTPS request to each endpoint on the current default
   * network and resolves once every one has an outcome. Sends nothing when
   * there is no network. Only one round may run at a time.
   * Rejects with {@link NetPulseBridgeError}.
   */
  runProbeRound(
    endpoints: readonly ProbeEndpoint[],
    timeouts: ProbeTimeouts,
  ): Promise<ProbeRound>;

  /**
   * Cancels the round in flight, if any. Its promise still resolves, with the
   * unfinished probes marked cancelled. Never throws.
   */
  cancelProbeRound(): void;

  /**
   * Tells the system that the network the latest probe round ran on appears
   * to have no connectivity. This is a hint the system may act on, never a
   * guaranteed fix, and native refuses it unless its own latest round failed
   * every check on the network that is still the default.
   * Rejects with {@link NetPulseBridgeError} only if the call itself breaks.
   */
  requestNetworkReevaluation(): Promise<RecoveryRequestOutcome>;

  /**
   * Opens the system's network settings so the user can act themselves.
   * Resolves false if no such screen could be opened. Never rejects.
   */
  openNetworkSettings(): Promise<boolean>;

  /**
   * Calls `listener` for each network change while observing. A change whose
   * payload fails validation is reported to `onInvalid` instead of being
   * passed on. Returns a function that removes the listener.
   */
  addNetworkListener(
    listener: (snapshot: NetworkSnapshot) => void,
    onInvalid?: (error: NetPulseBridgeError) => void,
  ): () => void;
}

/** The slice of the generated module this wrapper uses; lets tests pass a fake. */
export type NativeNetPulseModule = NonNullable<typeof NativeNetPulse>;

export function createNetPulseBridge(
  native: NativeNetPulseModule | null,
): NetPulseBridge {
  const requireNative = (): NativeNetPulseModule => {
    if (native === null) {
      throw new NetPulseBridgeError(
        'unavailable',
        'The NetPulse native module is not available in this build.',
      );
    }
    return native;
  };

  const readSnapshot = async (
    call: (module: NativeNetPulseModule) => Promise<unknown>,
  ): Promise<NetworkSnapshot> => {
    try {
      return parseNetworkSnapshot(await call(requireNative()));
    } catch (error) {
      throw toBridgeError(error);
    }
  };

  return {
    isAvailable: () => native !== null,

    getSnapshot: () => readSnapshot(module => module.getSnapshot()),

    startObserving: () => readSnapshot(module => module.startObserving()),

    stopObserving: async () => {
      if (native === null) {
        return;
      }
      try {
        await native.stopObserving();
      } catch (error) {
        throw toBridgeError(error);
      }
    },

    runProbeRound: async (endpoints, timeouts) => {
      try {
        // Copy into plain objects: only these fields cross the bridge.
        const round = await requireNative().runProbeRound(
          endpoints.map(({ id, url, expectedStatus }) => ({
            id,
            url,
            expectedStatus,
          })),
          {
            connectTimeoutMs: timeouts.connectTimeoutMs,
            readTimeoutMs: timeouts.readTimeoutMs,
            callTimeoutMs: timeouts.callTimeoutMs,
          },
        );
        return parseProbeRound(round);
      } catch (error) {
        throw toBridgeError(error);
      }
    },

    cancelProbeRound: () => {
      try {
        native?.cancelProbeRound();
      } catch (error) {
        // Cancelling is best-effort; the round ends at its timeout regardless.
        console.warn(
          `[NetPulse] Could not cancel the probe round: ${
            toBridgeError(error).code
          }`,
        );
      }
    },

    requestNetworkReevaluation: async () => {
      try {
        return parseRecoveryOutcome(
          await requireNative().requestNetworkReevaluation(),
        );
      } catch (error) {
        throw toBridgeError(error);
      }
    },

    openNetworkSettings: async () => {
      if (native === null) {
        return false;
      }
      try {
        return (await native.openNetworkSettings()) === true;
      } catch (error) {
        console.warn(
          `[NetPulse] Could not open network settings: ${
            toBridgeError(error).code
          }`,
        );
        return false;
      }
    },

    addNetworkListener: (listener, onInvalid) => {
      if (native === null) {
        return () => {};
      }
      const subscription = native.onNetworkChanged(payload => {
        let snapshot: NetworkSnapshot;
        try {
          snapshot = parseNetworkSnapshot(payload);
        } catch (error) {
          onInvalid?.(toBridgeError(error));
          return;
        }
        listener(snapshot);
      });
      return () => subscription.remove();
    },
  };
}

/** The bridge to the real native module. */
export const netPulseBridge: NetPulseBridge = createNetPulseBridge(
  NativeNetPulse ?? null,
);
