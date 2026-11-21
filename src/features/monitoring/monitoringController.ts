import {
  findConfigProblems,
  type MonitoringConfig,
} from '../../domain/config/monitoringConfig';
import type { NetworkSnapshot } from '../../domain/models/network';
import { assessRound } from '../../domain/state-machine/assessRound';
import {
  initialMachineState,
  transition,
  type ActivityEntry,
  type MachineEffect,
  type MachineEvent,
  type MachineState,
} from '../../domain/state-machine/monitorMachine';
import type { NetPulseBridge } from '../../native/NetPulseNative';
import type {
  AppLifecycle,
  NetworkSnapshotStore,
} from './networkSnapshotStore';

/** Everything the UI needs to know about monitoring, as one immutable value. */
export interface MonitoringView {
  /** False when the native module is missing, so monitoring cannot run at all. */
  readonly available: boolean;
  readonly machine: MachineState;
  /** Newest first. Kept in memory only; it is lost when the app closes. */
  readonly activity: readonly ActivityEntry[];
  /** True while the app is in the background and health checks are on hold. */
  readonly suspended: boolean;
}

export interface MonitoringController {
  getState(): MonitoringView;
  /** Shaped for React's `useSyncExternalStore`. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Turns monitoring on. Does nothing if it is on or unavailable. */
  start(): void;
  /** Turns monitoring off and cancels anything in progress. */
  stop(): void;
  /** Opens the system's network settings, for when only the user can help. */
  openNetworkSettings(): void;
}

export interface MonitoringControllerDeps {
  readonly bridge: NetPulseBridge;
  readonly networkStore: NetworkSnapshotStore;
  readonly lifecycle: AppLifecycle;
  readonly config: MonitoringConfig;
  /** Current time in Unix epoch milliseconds. */
  readonly now: () => number;
  /** Runs `callback` once after `delayMs`. Returns a function that cancels it. */
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
  readonly log?: (message: string) => void;
}

const MAX_ACTIVITY_ENTRIES = 30;

/**
 * Runs the incident state machine against the real world.
 *
 * The machine (domain/state-machine/monitorMachine.ts) decides everything;
 * this controller only does what the machine cannot do for itself: it reads
 * the clock, arms a timer for the next round, calls the native module, and
 * feeds the results back in as events.
 *
 * Health checks run only while the app is in the foreground. The timer here
 * is a JavaScript timer, which Android may suspend at any time once the app
 * is in the background, so backgrounding puts checks on hold explicitly
 * rather than pretending they continue.
 *
 * @throws if `config` is invalid; see `findConfigProblems`.
 */
export function createMonitoringController(
  deps: MonitoringControllerDeps,
): MonitoringController {
  const { bridge, networkStore, lifecycle, config, now, schedule } = deps;
  const log = deps.log ?? (message => console.warn(message));

  const problems = findConfigProblems(config);
  if (problems.length > 0) {
    throw new Error(`Invalid monitoring configuration: ${problems.join(' ')}`);
  }
  const endpointIds = config.endpoints.map(endpoint => endpoint.id);

  const listeners = new Set<() => void>();
  let view: MonitoringView = {
    available: bridge.isAvailable(),
    machine: initialMachineState(),
    activity: [],
    suspended: false,
  };

  let cancelTimer: (() => void) | null = null;
  let stopNetwork: (() => void) | null = null;
  let stopLifecycle: (() => void) | null = null;
  /** The last network snapshot fed to the machine, to skip repeats. */
  let lastSnapshot: NetworkSnapshot | null = null;
  /** After a pause in observation the network must be treated as unknown. */
  let treatNextSnapshotAsNew = false;
  /**
   * True while the network is unknown after starting or returning to the
   * foreground. No round runs until it is known: a round started earlier
   * would be cancelled as soon as the snapshot arrived, wasting its data.
   */
  let awaitingSnapshot = false;
  /** Identifies the current round; results of older rounds are dropped. */
  let roundToken = 0;

  const publish = (next: MonitoringView) => {
    view = next;
    listeners.forEach(listener => listener());
  };

  const currentSnapshot = (): NetworkSnapshot | null => {
    const observation = networkStore.getState();
    return observation.status === 'observing' ? observation.snapshot : null;
  };

  /** True when no snapshot is coming, so waiting for one would stall monitoring. */
  const observationFailed = (): boolean => {
    const { status } = networkStore.getState();
    return status === 'error' || status === 'unavailable';
  };

  const armTimer = () => {
    cancelTimer?.();
    cancelTimer = null;
    const { machine, suspended } = view;
    if (
      suspended ||
      awaitingSnapshot ||
      machine.roundInFlight ||
      machine.nextRoundAtMs === null
    ) {
      return;
    }
    cancelTimer = schedule(() => {
      cancelTimer = null;
      dispatch({ type: 'tick', atMs: now() });
    }, Math.max(0, machine.nextRoundAtMs - now()));
  };

  const runRound = () => {
    const token = ++roundToken;
    bridge.runProbeRound(config.endpoints, config.timeouts).then(
      round => {
        if (token !== roundToken) {
          return;
        }
        dispatch({
          type: 'round_finished',
          atMs: now(),
          assessment: assessRound(round, currentSnapshot(), endpointIds),
        });
      },
      error => {
        if (token !== roundToken) {
          return;
        }
        log(`[NetPulse] A health check could not be run: ${error.code}`);
        dispatch({ type: 'round_not_run', atMs: now() });
      },
    );
  };

  /**
   * Carries out the machine's decision to ask the system for a re-check.
   * The machine has already applied the failure threshold, cooldown and
   * attempt limit; native applies its own independent check on top.
   */
  const requestRecovery = () => {
    const token = roundToken;
    const report = (outcome: 'requested' | 'not_sent' | 'unsupported') => {
      // Dropped if monitoring was stopped or restarted in the meantime.
      if (token === roundToken) {
        dispatch({ type: 'recovery_requested', atMs: now(), outcome });
      }
    };
    bridge.requestNetworkReevaluation().then(
      outcome => {
        if (outcome === 'requested') {
          report('requested');
        } else if (outcome === 'failed') {
          log('[NetPulse] The system rejected the re-check request.');
          report('unsupported');
        } else {
          log(`[NetPulse] No re-check was requested: ${outcome}`);
          report('not_sent');
        }
      },
      error => {
        log(`[NetPulse] The re-check request could not be made: ${error.code}`);
        report('unsupported');
      },
    );
  };

  const perform = (effect: MachineEffect) => {
    switch (effect.type) {
      case 'run_round':
        runRound();
        break;
      case 'cancel_round':
        bridge.cancelProbeRound();
        break;
      case 'request_recovery':
        requestRecovery();
        break;
      case 'activity':
        // Handled in `dispatch`, together with the state it belongs to.
        break;
    }
  };

  function dispatch(event: MachineEvent) {
    const result = transition(view.machine, event, config);
    const entries = result.effects.flatMap(effect =>
      effect.type === 'activity' ? [effect.entry] : [],
    );
    if (result.state !== view.machine || entries.length > 0) {
      publish({
        ...view,
        machine: result.state,
        activity:
          entries.length === 0
            ? view.activity
            : [...entries.reverse(), ...view.activity].slice(
                0,
                MAX_ACTIVITY_ENTRIES,
              ),
      });
    }
    result.effects.forEach(perform);
    armTimer();
  }

  const onNetworkObservation = () => {
    const snapshot = currentSnapshot();
    if (snapshot === null) {
      // Observation paused or restarting; what comes next may be a different network.
      treatNextSnapshotAsNew = true;
      if (awaitingSnapshot && observationFailed()) {
        // No snapshot is coming. Check anyway; native finds the network itself.
        awaitingSnapshot = false;
        armTimer();
      }
      return;
    }
    if (snapshot === lastSnapshot) {
      if (awaitingSnapshot) {
        // Observation never paused, so the network is still known.
        awaitingSnapshot = false;
        armTimer();
      }
      return;
    }
    awaitingSnapshot = false;
    lastSnapshot = snapshot;
    const isNewNetwork =
      treatNextSnapshotAsNew || snapshot.cause === 'available';
    treatNextSnapshotAsNew = false;
    dispatch({
      type: 'network_changed',
      atMs: now(),
      hasNetwork: snapshot.hasNetwork,
      isNewNetwork,
    });
  };

  const onLifecycleChange = (active: boolean) => {
    if (active === !view.suspended) {
      return;
    }
    if (!active) {
      // Going to the background: hold everything. A round in flight is
      // cancelled; its result arrives as inconclusive and is not counted.
      publish({ ...view, suspended: true });
      cancelTimer?.();
      cancelTimer = null;
      if (view.machine.roundInFlight) {
        bridge.cancelProbeRound();
      }
      return;
    }
    // Back in the foreground. Whatever was concluded before is out of date,
    // and the next round waits until the network is known again.
    treatNextSnapshotAsNew = true;
    awaitingSnapshot = !observationFailed();
    publish({ ...view, suspended: false });
    onNetworkObservation();
    armTimer();
  };

  return {
    getState: () => view,

    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    start: () => {
      if (!bridge.isAvailable() || view.machine.phase !== 'idle') {
        return;
      }
      lastSnapshot = currentSnapshot();
      treatNextSnapshotAsNew = false;
      awaitingSnapshot = lastSnapshot === null && !observationFailed();
      if (!lifecycle.isActive()) {
        publish({ ...view, suspended: true });
      }
      dispatch({
        type: 'start',
        atMs: now(),
        hasNetwork: lastSnapshot?.hasNetwork ?? null,
      });
      // Subscribing keeps native network observation alive while monitoring.
      stopNetwork = networkStore.subscribe(onNetworkObservation);
      stopLifecycle = lifecycle.onChange(onLifecycleChange);
      onNetworkObservation();
    },

    openNetworkSettings: () => {
      bridge.openNetworkSettings().then(opened => {
        if (!opened) {
          log('[NetPulse] This device has no network settings screen to open.');
        }
      });
    },

    stop: () => {
      if (view.machine.phase === 'idle') {
        return;
      }
      roundToken++;
      awaitingSnapshot = false;
      dispatch({ type: 'stop', atMs: now() });
      cancelTimer?.();
      cancelTimer = null;
      stopNetwork?.();
      stopNetwork = null;
      stopLifecycle?.();
      stopLifecycle = null;
      lastSnapshot = null;
      if (view.suspended) {
        publish({ ...view, suspended: false });
      }
    },
  };
}
