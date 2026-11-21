import {
  DEFAULT_MONITORING_CONFIG,
  type MonitoringConfig,
} from '../../../domain/config/monitoringConfig';
import type { NetworkSnapshot } from '../../../domain/models/network';
import type { ProbeOutcome, ProbeRound } from '../../../domain/models/probe';
import type { RecoveryRequestOutcome } from '../../../domain/models/recovery';
import { NetPulseBridgeError } from '../../../native/errors';
import type { NetPulseBridge } from '../../../native/NetPulseNative';
import { createMonitoringController } from '../monitoringController';
import type {
  AppLifecycle,
  NetworkObservation,
  NetworkSnapshotStore,
} from '../networkSnapshotStore';

const config = DEFAULT_MONITORING_CONFIG;
/** Detection only, for tests that are not about recovery. */
const withoutRecovery: MonitoringConfig = {
  ...config,
  recovery: { ...config.recovery, enabled: false },
};

function snapshot(overrides: Partial<NetworkSnapshot> = {}): NetworkSnapshot {
  return {
    hasNetwork: true,
    transport: 'cellular',
    isVpn: false,
    validated: true,
    internetCapable: true,
    captivePortal: false,
    metered: true,
    capturedAtMs: 0,
    cause: 'snapshot',
    ...overrides,
  };
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** A clock and timer queue the test moves forward by hand. */
function createClock(start = 1_000_000) {
  let now = start;
  let timers: { at: number; callback: () => void }[] = [];
  return {
    now: () => now,
    pendingTimers: () => timers.length,
    schedule: (callback: () => void, delayMs: number) => {
      const timer = { at: now + delayMs, callback };
      timers.push(timer);
      return () => {
        timers = timers.filter(candidate => candidate !== timer);
      };
    },
    /** Moves time forward, firing every timer that comes due, in order. */
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        const next = timers
          .filter(timer => timer.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (next === undefined) {
          break;
        }
        timers = timers.filter(timer => timer !== next);
        now = Math.max(now, next.at);
        next.callback();
      }
      now = target;
    },
  };
}

function setup(
  options: {
    available?: boolean;
    active?: boolean;
    network?: NetworkObservation;
    config?: MonitoringConfig;
  } = {},
) {
  const clock = createClock();
  const rounds: ReturnType<typeof deferred<ProbeRound>>[] = [];
  const runProbeRound = jest.fn(() => {
    const round = deferred<ProbeRound>();
    rounds.push(round);
    return round.promise;
  });
  const cancelProbeRound = jest.fn();
  const recoveries: ReturnType<typeof deferred<RecoveryRequestOutcome>>[] = [];
  const requestNetworkReevaluation = jest.fn(() => {
    const recovery = deferred<RecoveryRequestOutcome>();
    recoveries.push(recovery);
    return recovery.promise;
  });
  const openNetworkSettings = jest.fn(async () => true);
  const bridge: NetPulseBridge = {
    isAvailable: () => options.available ?? true,
    getSnapshot: async () => snapshot(),
    startObserving: async () => snapshot(),
    stopObserving: async () => {},
    runProbeRound,
    cancelProbeRound,
    requestNetworkReevaluation,
    openNetworkSettings,
    addNetworkListener: () => () => {},
  };

  let observation: NetworkObservation = options.network ?? {
    status: 'observing',
    snapshot: snapshot(),
  };
  const networkListeners = new Set<() => void>();
  const networkStore: NetworkSnapshotStore = {
    getState: () => observation,
    subscribe: listener => {
      networkListeners.add(listener);
      return () => networkListeners.delete(listener);
    },
  };

  let active = options.active ?? true;
  const lifecycleListeners = new Set<(active: boolean) => void>();
  const lifecycle: AppLifecycle = {
    isActive: () => active,
    onChange: listener => {
      lifecycleListeners.add(listener);
      return () => lifecycleListeners.delete(listener);
    },
  };

  const log = jest.fn();
  const controller = createMonitoringController({
    bridge,
    networkStore,
    lifecycle,
    config: options.config ?? config,
    now: clock.now,
    schedule: clock.schedule,
    log,
  });

  /** Settles the round in flight with the same outcome for every endpoint. */
  const finishRound = async (
    outcome: ProbeOutcome,
    overrides: Partial<ProbeRound> = {},
  ) => {
    clock.advance(250);
    rounds[rounds.length - 1].resolve({
      hadNetwork: true,
      networkChanged: false,
      startedAtMs: clock.now() - 250,
      finishedAtMs: clock.now(),
      bytesUsed: 2_000,
      results: (options.config ?? config).endpoints.map(endpoint => ({
        endpointId: endpoint.id,
        outcome,
        httpStatus: outcome === 'success' ? 204 : null,
        durationMs: 200,
      })),
      ...overrides,
    });
    await flush();
  };

  return {
    controller,
    clock,
    rounds,
    runProbeRound,
    cancelProbeRound,
    recoveries,
    requestNetworkReevaluation,
    openNetworkSettings,
    log,
    finishRound,
    phase: () => controller.getState().machine.phase,
    networkSubscribers: () => networkListeners.size,
    lifecycleSubscribers: () => lifecycleListeners.size,
    setNetwork: (next: NetworkObservation) => {
      observation = next;
      networkListeners.forEach(listener => listener());
    },
    setActive: (next: boolean) => {
      active = next;
      lifecycleListeners.forEach(listener => listener(next));
    },
  };
}

/** Starts monitoring and lets the immediate first round begin. */
function started(options: Parameters<typeof setup>[0] = {}) {
  const context = setup(options);
  context.controller.start();
  context.clock.advance(0);
  return context;
}

describe('createMonitoringController', () => {
  it('refuses an invalid configuration outright', () => {
    expect(() => setup({ config: { ...config, failureThreshold: 1 } })).toThrow(
      /Invalid monitoring configuration/,
    );
  });

  it('cannot be started without the native module', () => {
    const { controller, runProbeRound, clock } = setup({ available: false });

    controller.start();
    clock.advance(120_000);

    expect(controller.getState().available).toBe(false);
    expect(controller.getState().machine.phase).toBe('idle');
    expect(runProbeRound).not.toHaveBeenCalled();
  });

  it('runs the first health check as soon as monitoring starts', () => {
    const { controller, runProbeRound, clock, phase } = setup();

    controller.start();
    expect(phase()).toBe('monitoring');
    clock.advance(0);

    expect(phase()).toBe('checking');
    expect(runProbeRound).toHaveBeenCalledTimes(1);
    expect(runProbeRound).toHaveBeenCalledWith(
      config.endpoints,
      config.timeouts,
    );
  });

  it('reports a healthy result and waits a full interval before the next check', async () => {
    const { runProbeRound, clock, finishRound, phase, controller } = started();

    await finishRound('success');
    expect(phase()).toBe('healthy');
    expect(controller.getState().machine.bytesUsed).toBe(2_000);

    clock.advance(config.healthyIntervalMs - 1);
    expect(runProbeRound).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(runProbeRound).toHaveBeenCalledTimes(2);
  });

  it('never has two rounds in flight', () => {
    const { runProbeRound, clock } = started();

    clock.advance(10 * config.healthyIntervalMs);

    expect(runProbeRound).toHaveBeenCalledTimes(1);
  });

  it('declares an incident only after three failed rounds, newest activity first', async () => {
    const { clock, finishRound, phase, controller } = started({
      config: withoutRecovery,
    });

    await finishRound('timeout');
    expect(phase()).toBe('suspected_failure');
    clock.advance(config.confirmIntervalMs);
    await finishRound('timeout');
    expect(phase()).toBe('suspected_failure');
    clock.advance(config.confirmIntervalMs);
    await finishRound('timeout');

    expect(phase()).toBe('incident');
    expect(controller.getState().activity.map(entry => entry.kind)).toEqual([
      'incident_started',
      'monitoring_started',
    ]);
    expect(controller.getState().activity[0]).toMatchObject({
      failureKind: 'timeout',
      systemValidated: true,
    });
  });

  it('judges each round against what Android last said about the network', async () => {
    const context = started({ config: withoutRecovery });
    context.setNetwork({
      status: 'observing',
      snapshot: snapshot({ validated: false, cause: 'capabilities_changed' }),
    });

    for (let i = 0; i < 3; i++) {
      context.clock.advance(config.confirmIntervalMs);
      await context.finishRound('dns_error');
    }

    expect(context.controller.getState().machine.incident).toMatchObject({
      failureKind: 'dns_failure',
      systemValidated: false,
    });
  });

  it('does not treat one failing endpoint as an outage', async () => {
    const { finishRound, phase, controller } = started();

    await finishRound('success', {
      results: [
        {
          endpointId: 'google',
          outcome: 'timeout',
          httpStatus: null,
          durationMs: 5000,
        },
        {
          endpointId: 'cloudflare',
          outcome: 'success',
          httpStatus: 204,
          durationMs: 180,
        },
      ],
    });

    expect(phase()).toBe('degraded');
    expect(controller.getState().machine.consecutiveFailedRounds).toBe(0);
  });

  it('does not count a round that is missing an endpoint', async () => {
    const { finishRound, phase, controller } = started();

    await finishRound('timeout', {
      results: [
        {
          endpointId: 'google',
          outcome: 'timeout',
          httpStatus: null,
          durationMs: 5000,
        },
      ],
    });

    expect(phase()).toBe('monitoring');
    expect(controller.getState().machine.consecutiveFailedRounds).toBe(0);
  });

  it('retries after a native failure and logs only the error code', async () => {
    const { rounds, clock, runProbeRound, log, phase } = started();

    rounds[0].reject(new NetPulseBridgeError('native_error', 'details'));
    await flush();

    expect(phase()).toBe('monitoring');
    expect(log).toHaveBeenCalledWith(
      '[NetPulse] A health check could not be run: native_error',
    );
    clock.advance(config.confirmIntervalMs);
    expect(runProbeRound).toHaveBeenCalledTimes(2);
  });

  it('stops probing when the network is lost and resumes when one appears', async () => {
    const context = started();
    await context.finishRound('success');

    context.setNetwork({
      status: 'observing',
      snapshot: snapshot({ hasNetwork: false, cause: 'lost' }),
    });
    expect(context.phase()).toBe('no_network');
    context.clock.advance(10 * config.healthyIntervalMs);
    expect(context.runProbeRound).toHaveBeenCalledTimes(1);

    context.setNetwork({
      status: 'observing',
      snapshot: snapshot({ transport: 'wifi', cause: 'available' }),
    });
    context.clock.advance(config.minRoundSpacingMs);
    expect(context.runProbeRound).toHaveBeenCalledTimes(2);
    expect(
      context.controller.getState().activity.map(entry => entry.kind),
    ).toEqual(['network_available', 'network_lost', 'monitoring_started']);
  });

  it('cancels the round in flight when the network is lost', () => {
    const context = started();

    context.setNetwork({
      status: 'observing',
      snapshot: snapshot({ hasNetwork: false, cause: 'lost' }),
    });

    expect(context.cancelProbeRound).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeat of the snapshot it already acted on', async () => {
    const context = started();
    await context.finishRound('success');
    const current = context.controller.getState();

    context.setNetwork({ status: 'observing', snapshot: snapshot() });
    const same = { status: 'observing', snapshot: snapshot() } as const;
    context.setNetwork(same);
    const afterFirst = context.controller.getState();
    context.setNetwork(same);

    expect(context.controller.getState()).toBe(afterFirst);
    expect(current.machine.phase).toBe('healthy');
  });

  describe('stopping', () => {
    it('cancels the round in flight, drops its result and schedules nothing more', async () => {
      const context = started();

      context.controller.stop();
      expect(context.cancelProbeRound).toHaveBeenCalledTimes(1);
      expect(context.phase()).toBe('idle');

      await context.finishRound('timeout');
      context.clock.advance(10 * config.healthyIntervalMs);

      expect(context.phase()).toBe('idle');
      expect(context.runProbeRound).toHaveBeenCalledTimes(1);
      expect(context.clock.pendingTimers()).toBe(0);
    });

    it('releases the network observation and lifecycle listeners', () => {
      const context = setup();
      expect(context.networkSubscribers()).toBe(0);

      context.controller.start();
      expect(context.networkSubscribers()).toBe(1);
      expect(context.lifecycleSubscribers()).toBe(1);

      context.controller.stop();
      expect(context.networkSubscribers()).toBe(0);
      expect(context.lifecycleSubscribers()).toBe(0);
    });

    it('records what the session used', async () => {
      const context = started();
      await context.finishRound('success');

      context.controller.stop();

      expect(context.controller.getState().activity[0]).toMatchObject({
        kind: 'monitoring_stopped',
        bytesUsed: 2_000,
        roundsCompleted: 1,
      });
    });

    it('does not let a round from a stopped session affect the next one', async () => {
      const context = started();
      context.controller.stop();
      context.controller.start();
      context.clock.advance(0);
      expect(context.runProbeRound).toHaveBeenCalledTimes(2);

      // The first session's round reports failure only now.
      context.rounds[0].resolve({
        hadNetwork: true,
        networkChanged: false,
        startedAtMs: 0,
        finishedAtMs: 1,
        bytesUsed: 9_999,
        results: config.endpoints.map(endpoint => ({
          endpointId: endpoint.id,
          outcome: 'timeout' as const,
          httpStatus: null,
          durationMs: 5000,
        })),
      });
      await flush();

      expect(context.phase()).toBe('checking');
      expect(context.controller.getState().machine.bytesUsed).toBe(0);
    });

    it('can be stopped and started repeatedly', () => {
      const context = setup();

      context.controller.stop();
      context.controller.start();
      context.controller.start();
      context.controller.stop();
      context.controller.stop();

      expect(context.phase()).toBe('idle');
      expect(context.networkSubscribers()).toBe(0);
    });
  });

  describe('in the background', () => {
    it('holds all checks, cancelling a round in flight', async () => {
      const context = started();

      context.setActive(false);

      expect(context.controller.getState().suspended).toBe(true);
      expect(context.cancelProbeRound).toHaveBeenCalledTimes(1);

      await context.finishRound('cancelled');
      context.clock.advance(10 * config.healthyIntervalMs);
      expect(context.runProbeRound).toHaveBeenCalledTimes(1);
      expect(context.clock.pendingTimers()).toBe(0);
    });

    it('does not count the cancelled round as a failure', async () => {
      const context = started();
      context.setActive(false);

      await context.finishRound('cancelled');

      expect(
        context.controller.getState().machine.consecutiveFailedRounds,
      ).toBe(0);
      expect(context.controller.getState().machine.incident).toBeNull();
    });

    it('checks again on return, treating the network as unknown', async () => {
      const context = started();
      await context.finishRound('timeout');
      expect(context.phase()).toBe('suspected_failure');

      context.setActive(false);
      context.setNetwork({ status: 'idle' });
      context.clock.advance(5 * 60_000);
      context.setActive(true);
      context.setNetwork({ status: 'starting' });
      context.setNetwork({
        status: 'observing',
        snapshot: snapshot({ capturedAtMs: context.clock.now() }),
      });

      // The failure seen before the pause no longer counts.
      expect(context.controller.getState().suspended).toBe(false);
      expect(context.phase()).toBe('monitoring');
      expect(
        context.controller.getState().machine.consecutiveFailedRounds,
      ).toBe(0);
      context.clock.advance(0);
      expect(context.runProbeRound).toHaveBeenCalledTimes(2);
    });

    it('waits for the network to be known before checking, so no round is wasted', async () => {
      const context = started();
      await context.finishRound('success');
      context.setActive(false);
      context.setNetwork({ status: 'idle' });
      context.clock.advance(5 * 60_000);

      context.setActive(true);
      context.setNetwork({ status: 'starting' });
      context.clock.advance(30_000);
      expect(context.runProbeRound).toHaveBeenCalledTimes(1);

      context.setNetwork({
        status: 'observing',
        snapshot: snapshot({ capturedAtMs: context.clock.now() }),
      });
      context.clock.advance(0);
      expect(context.runProbeRound).toHaveBeenCalledTimes(2);
      expect(context.cancelProbeRound).not.toHaveBeenCalled();
    });

    it('resumes its schedule when observation was never interrupted', async () => {
      const context = started();
      await context.finishRound('success');

      context.setActive(false);
      context.setActive(true);
      context.clock.advance(config.healthyIntervalMs);

      expect(context.runProbeRound).toHaveBeenCalledTimes(2);
    });

    it('starts suspended when monitoring is switched on while backgrounded', () => {
      const context = setup({ active: false });

      context.controller.start();
      context.clock.advance(60_000);

      expect(context.controller.getState().suspended).toBe(true);
      expect(context.runProbeRound).not.toHaveBeenCalled();
    });
  });

  it('waits for the first snapshot when started before the network is known', () => {
    const context = setup({ network: { status: 'starting' } });

    context.controller.start();
    context.clock.advance(60_000);
    expect(context.runProbeRound).not.toHaveBeenCalled();

    context.setNetwork({ status: 'observing', snapshot: snapshot() });
    context.clock.advance(0);

    expect(context.runProbeRound).toHaveBeenCalledTimes(1);
    expect(context.cancelProbeRound).not.toHaveBeenCalled();
  });

  it('still checks when the network state cannot be read', () => {
    const context = setup({
      network: { status: 'error', message: 'native_error' },
    });

    context.controller.start();
    context.clock.advance(0);

    expect(context.runProbeRound).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers of changes until they unsubscribe', async () => {
    const context = setup();
    const listener = jest.fn();
    const unsubscribe = context.controller.subscribe(listener);

    context.controller.start();
    const callsAfterStart = listener.mock.calls.length;
    expect(callsAfterStart).toBeGreaterThan(0);

    unsubscribe();
    context.clock.advance(0);
    await context.finishRound('success');
    expect(listener).toHaveBeenCalledTimes(callsAfterStart);
  });

  it('keeps only the most recent activity', async () => {
    const context = setup();

    for (let i = 0; i < 40; i++) {
      context.controller.start();
      context.controller.stop();
    }

    expect(context.controller.getState().activity).toHaveLength(30);
    expect(context.controller.getState().activity[0].kind).toBe(
      'monitoring_stopped',
    );
  });

  describe('recovery', () => {
    /** Three failed rounds: the incident is confirmed and a request goes out. */
    async function confirmedIncident() {
      const context = started();
      for (let i = 0; i < 3; i++) {
        await context.finishRound('timeout');
        context.clock.advance(config.confirmIntervalMs);
      }
      return context;
    }

    it('asks the system for a re-check only once an incident is confirmed', async () => {
      const context = started();

      await context.finishRound('timeout');
      context.clock.advance(config.confirmIntervalMs);
      await context.finishRound('timeout');
      expect(context.requestNetworkReevaluation).not.toHaveBeenCalled();

      context.clock.advance(config.confirmIntervalMs);
      await context.finishRound('timeout');

      expect(context.phase()).toBe('recovering');
      expect(context.requestNetworkReevaluation).toHaveBeenCalledTimes(1);
    });

    it('never asks while the internet is reachable', async () => {
      const context = started();

      for (let i = 0; i < 5; i++) {
        await context.finishRound('success');
        context.clock.advance(config.healthyIntervalMs);
      }

      expect(context.requestNetworkReevaluation).not.toHaveBeenCalled();
    });

    it('verifies after a request and records it in the activity', async () => {
      const context = await confirmedIncident();

      context.recoveries[0].resolve('requested');
      await flush();

      expect(context.phase()).toBe('verifying');
      expect(context.controller.getState().activity[0]).toMatchObject({
        kind: 'recovery_requested',
        attempt: 1,
      });
      expect(context.controller.getState().machine.lastRecovery).toMatchObject({
        attempt: 1,
        result: 'verifying',
      });

      // No check until the settle time has passed.
      const roundsBefore = context.runProbeRound.mock.calls.length;
      context.clock.advance(config.recovery.settleMs - 1);
      expect(context.runProbeRound).toHaveBeenCalledTimes(roundsBefore);
      context.clock.advance(1);
      expect(context.runProbeRound).toHaveBeenCalledTimes(roundsBefore + 1);
    });

    it('does not count an attempt when native declined to send the hint', async () => {
      const context = await confirmedIncident();

      context.recoveries[0].resolve('network_changed');
      await flush();

      expect(context.phase()).toBe('incident');
      expect(context.controller.getState().machine.incident).toMatchObject({
        recoveryAttempts: 0,
      });
      expect(context.log).toHaveBeenCalledWith(
        '[NetPulse] No re-check was requested: network_changed',
      );
    });

    it.each([
      ['the system rejects the call', 'failed' as const],
      ['the native call itself breaks', null],
    ])('hands over to the user when %s', async (_name, outcome) => {
      const context = await confirmedIncident();

      if (outcome === null) {
        context.recoveries[0].reject(
          new NetPulseBridgeError('native_error', 'details'),
        );
      } else {
        context.recoveries[0].resolve(outcome);
      }
      await flush();

      expect(context.phase()).toBe('needs_user_action');
      expect(context.controller.getState().machine.incident).toMatchObject({
        recoveryAttempts: 0,
        recoveryUnsupported: true,
      });
    });

    it('drops the result of a request made before monitoring was stopped', async () => {
      const context = await confirmedIncident();

      context.controller.stop();
      context.controller.start();
      context.recoveries[0].resolve('requested');
      await flush();

      expect(context.controller.getState().machine.lastRecovery).toBeNull();
      expect(
        context.controller.getState().activity.map(entry => entry.kind),
      ).not.toContain('recovery_requested');
    });

    it('stops asking at the attempt limit', async () => {
      const context = await confirmedIncident();

      for (
        let guard = 0;
        guard < 60 && context.phase() !== 'needs_user_action';
        guard++
      ) {
        if (context.phase() === 'recovering') {
          context.recoveries[context.recoveries.length - 1].resolve(
            'requested',
          );
          await flush();
        } else {
          context.clock.advance(config.recovery.cooldownMs);
          await context.finishRound('timeout');
        }
      }

      expect(context.phase()).toBe('needs_user_action');
      expect(context.requestNetworkReevaluation).toHaveBeenCalledTimes(
        config.recovery.maxAttemptsPerIncident,
      );
    });
  });

  it('opens network settings on request and logs if the device has none', async () => {
    const context = setup();

    context.controller.openNetworkSettings();
    await flush();
    expect(context.openNetworkSettings).toHaveBeenCalledTimes(1);
    expect(context.log).not.toHaveBeenCalled();

    context.openNetworkSettings.mockResolvedValueOnce(false);
    context.controller.openNetworkSettings();
    await flush();
    expect(context.log).toHaveBeenCalledWith(
      '[NetPulse] This device has no network settings screen to open.',
    );
  });
});
