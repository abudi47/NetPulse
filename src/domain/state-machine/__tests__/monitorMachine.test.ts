import {
  DEFAULT_MONITORING_CONFIG,
  type MonitoringConfig,
} from '../../config/monitoringConfig';
import type {
  FailureKind,
  RoundAssessment,
  RoundVerdict,
} from '../assessRound';
import {
  incidentBackoffMs,
  initialMachineState,
  transition,
  type ActivityEntry,
  type MachineEffect,
  type MachineEvent,
  type MachineState,
} from '../monitorMachine';

const withRecovery: MonitoringConfig = DEFAULT_MONITORING_CONFIG;
/** Detection only: incidents are tracked but nothing is ever requested. */
const config: MonitoringConfig = {
  ...withRecovery,
  recovery: { ...withRecovery.recovery, enabled: false },
};

function assess(
  verdict: RoundVerdict,
  atMs: number,
  overrides: Partial<RoundAssessment> = {},
): RoundAssessment {
  const failureKind: FailureKind | null =
    verdict === 'unreachable' ? 'timeout' : null;
  return {
    verdict,
    failureKind,
    systemValidated: true,
    succeeded: verdict === 'reachable' ? 2 : verdict === 'partial' ? 1 : 0,
    attempted: verdict === 'no_network' ? 0 : 2,
    failures: [],
    latencyMs: verdict === 'reachable' || verdict === 'partial' ? 120 : null,
    finishedAtMs: atMs,
    bytesUsed: 1_000,
    ...overrides,
  };
}

/** Drives the machine through time the way the app does, recording everything. */
class Session {
  state: MachineState = initialMachineState();
  now = 1_000_000;
  readonly effects: MachineEffect[] = [];

  constructor(private readonly cfg: MonitoringConfig = config) {}

  send(event: MachineEvent): readonly MachineEffect[] {
    const result = transition(this.state, event, this.cfg);
    this.state = result.state;
    this.effects.push(...result.effects);
    return result.effects;
  }

  start(hasNetwork: boolean | null = true) {
    return this.send({ type: 'start', atMs: this.now, hasNetwork });
  }

  /** Moves the clock to when the next round is due and starts it. */
  beginRound() {
    if (this.state.nextRoundAtMs === null) {
      throw new Error(`No round is scheduled in phase "${this.state.phase}"`);
    }
    this.now = Math.max(this.now, this.state.nextRoundAtMs);
    const effects = this.send({ type: 'tick', atMs: this.now });
    expect(effects).toEqual([{ type: 'run_round' }]);
  }

  /** Runs the next scheduled round to completion with the given verdict. */
  round(verdict: RoundVerdict, overrides: Partial<RoundAssessment> = {}) {
    this.beginRound();
    this.now += 300;
    return this.send({
      type: 'round_finished',
      atMs: this.now,
      assessment: assess(verdict, this.now, overrides),
    });
  }

  rounds(count: number, verdict: RoundVerdict) {
    for (let i = 0; i < count; i++) {
      this.round(verdict);
    }
  }

  /** Answers a pending recovery request. */
  recovery(outcome: 'requested' | 'not_sent' | 'unsupported' = 'requested') {
    this.now += 50;
    return this.send({ type: 'recovery_requested', atMs: this.now, outcome });
  }

  network(hasNetwork: boolean, isNewNetwork = false) {
    return this.send({
      type: 'network_changed',
      atMs: this.now,
      hasNetwork,
      isNewNetwork,
    });
  }

  get activity(): ActivityEntry[] {
    return this.effects.flatMap(effect =>
      effect.type === 'activity' ? [effect.entry] : [],
    );
  }

  get activityKinds(): string[] {
    return this.activity.map(entry => entry.kind);
  }

  count(type: MachineEffect['type']): number {
    return this.effects.filter(effect => effect.type === type).length;
  }
}

describe('starting and stopping', () => {
  it('does nothing until monitoring is started', () => {
    const session = new Session();

    session.send({ type: 'tick', atMs: session.now });
    session.network(false);

    expect(session.state).toEqual(initialMachineState());
    expect(session.effects).toEqual([]);
  });

  it('schedules a first check immediately when started', () => {
    const session = new Session();

    session.start();

    expect(session.state.phase).toBe('monitoring');
    expect(session.state.nextRoundAtMs).toBe(session.now);
    expect(session.activityKinds).toEqual(['monitoring_started']);
  });

  it('shows "checking" only while the first round is in flight', () => {
    const session = new Session();
    session.start();

    session.beginRound();
    expect(session.state.phase).toBe('checking');
    expect(session.state.roundInFlight).toBe(true);

    session.send({
      type: 'round_finished',
      atMs: session.now,
      assessment: assess('reachable', session.now),
    });
    session.beginRound();
    expect(session.state.phase).toBe('healthy');
  });

  it('ignores a second start', () => {
    const session = new Session();
    session.start();
    session.round('reachable');
    const before = session.state;

    expect(session.start()).toEqual([]);
    expect(session.state).toBe(before);
  });

  it('returns to a clean idle state when stopped, reporting what the session used', () => {
    const session = new Session();
    session.start();
    session.rounds(2, 'reachable');

    session.send({ type: 'stop', atMs: session.now });

    expect(session.state).toEqual(initialMachineState());
    expect(session.activity.at(-1)).toEqual({
      kind: 'monitoring_stopped',
      atMs: session.now,
      bytesUsed: 2_000,
      roundsCompleted: 2,
    });
  });

  it('cancels a round in flight when stopped, and ignores its late result', () => {
    const session = new Session();
    session.start();
    session.beginRound();

    const effects = session.send({ type: 'stop', atMs: session.now });
    expect(effects).toContainEqual({ type: 'cancel_round' });

    session.send({
      type: 'round_finished',
      atMs: session.now + 100,
      assessment: assess('unreachable', session.now + 100),
    });
    expect(session.state).toEqual(initialMachineState());
  });
});

describe('scheduling', () => {
  it('never runs two rounds at once', () => {
    const session = new Session();
    session.start();
    session.beginRound();

    expect(session.send({ type: 'tick', atMs: session.now + 60_000 })).toEqual(
      [],
    );
    expect(session.count('run_round')).toBe(1);
  });

  it('does not start a round before it is due', () => {
    const session = new Session();
    session.start();
    session.round('reachable');

    const early = session.state.nextRoundAtMs! - 1;
    expect(session.send({ type: 'tick', atMs: early })).toEqual([]);
  });

  it('checks a healthy connection once per healthy interval', () => {
    const session = new Session();
    session.start();

    session.round('reachable');

    expect(session.state.phase).toBe('healthy');
    expect(session.state.nextRoundAtMs).toBe(
      session.now + config.healthyIntervalMs,
    );
    expect(session.state.lastReachableAtMs).toBe(session.now);
  });

  it('retries soon when a round could not be run at all', () => {
    const session = new Session();
    session.start();
    session.beginRound();

    session.send({ type: 'round_not_run', atMs: session.now });

    expect(session.state.roundInFlight).toBe(false);
    expect(session.state.phase).toBe('monitoring');
    expect(session.state.nextRoundAtMs).toBe(
      session.now + config.confirmIntervalMs,
    );
  });
});

describe('a single endpoint outage', () => {
  it('is shown as degraded and never becomes an incident', () => {
    const session = new Session(withRecovery);
    session.start();

    session.rounds(10, 'partial');

    expect(session.state.phase).toBe('degraded');
    expect(session.state.incident).toBeNull();
    expect(session.state.consecutiveFailedRounds).toBe(0);
    expect(session.count('request_recovery')).toBe(0);
    expect(session.activityKinds).toEqual(['monitoring_started']);
  });

  it('clears a suspected failure, because the internet was reached', () => {
    const session = new Session();
    session.start();
    session.rounds(2, 'unreachable');
    expect(session.state.phase).toBe('suspected_failure');

    session.round('partial');

    expect(session.state.phase).toBe('degraded');
    expect(session.state.consecutiveFailedRounds).toBe(0);
  });
});

describe('a transient failure', () => {
  it('is only suspected, and is re-checked quickly', () => {
    const session = new Session();
    session.start();
    session.round('reachable');

    session.round('unreachable');

    expect(session.state.phase).toBe('suspected_failure');
    expect(session.state.consecutiveFailedRounds).toBe(1);
    expect(session.state.incident).toBeNull();
    expect(session.state.nextRoundAtMs).toBe(
      session.now + config.confirmIntervalMs,
    );
  });

  it('is forgotten as soon as a round succeeds', () => {
    const session = new Session(withRecovery);
    session.start();
    session.rounds(2, 'unreachable');

    session.round('reachable');
    session.rounds(2, 'unreachable');

    expect(session.state.phase).toBe('suspected_failure');
    expect(session.state.consecutiveFailedRounds).toBe(2);
    expect(session.state.incident).toBeNull();
    expect(session.activityKinds).not.toContain('incident_started');
    expect(session.count('request_recovery')).toBe(0);
  });

  it('does not count an inconclusive round as a failure or a success', () => {
    const session = new Session();
    session.start();
    session.rounds(2, 'unreachable');

    session.round('inconclusive');

    expect(session.state.phase).toBe('suspected_failure');
    expect(session.state.consecutiveFailedRounds).toBe(2);
    expect(session.state.nextRoundAtMs).toBe(
      session.now + config.confirmIntervalMs,
    );
  });
});

describe('all endpoints failing', () => {
  it('becomes an incident on the third consecutive failed round, not before', () => {
    const session = new Session();
    session.start();

    session.rounds(2, 'unreachable');
    expect(session.state.incident).toBeNull();
    const firstFailureAt = session.state.firstFailureAtMs;

    session.round('unreachable', { failureKind: 'dns_failure' });

    expect(session.state.phase).toBe('incident');
    expect(session.state.incident).toMatchObject({
      startedAtMs: firstFailureAt,
      confirmedAtMs: session.now,
      failureKind: 'dns_failure',
      recoveryAttempts: 0,
    });
    expect(session.activity.at(-1)).toEqual({
      kind: 'incident_started',
      atMs: session.now,
      failureKind: 'dns_failure',
      systemValidated: true,
    });
  });

  it('honours a different failure threshold', () => {
    const session = new Session({ ...config, failureThreshold: 5 });
    session.start();

    session.rounds(4, 'unreachable');
    expect(session.state.phase).toBe('suspected_failure');

    session.round('unreachable');
    expect(session.state.phase).toBe('incident');
  });

  it('with recovery disabled, tracks the incident without requesting anything', () => {
    const session = new Session(config);
    session.start();

    session.rounds(8, 'unreachable');

    expect(session.state.phase).toBe('incident');
    expect(session.count('request_recovery')).toBe(0);
  });

  it('spaces rounds further apart the longer an incident lasts, up to a cap', () => {
    const session = new Session(config);
    session.start();
    session.rounds(3, 'unreachable');

    const gaps: number[] = [];
    for (let i = 0; i < 7; i++) {
      gaps.push(session.state.nextRoundAtMs! - session.now);
      session.round('unreachable');
    }

    expect(gaps).toEqual([
      15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000,
    ]);
  });

  it('keeps the latest evidence about the cause', () => {
    const session = new Session(config);
    session.start();
    session.rounds(3, 'unreachable');

    session.round('unreachable', {
      failureKind: 'tls_failure',
      systemValidated: false,
    });

    expect(session.state.incident).toMatchObject({
      failureKind: 'tls_failure',
      systemValidated: false,
    });
  });
});

describe('recovery requests', () => {
  function confirmedIncident() {
    const session = new Session(withRecovery);
    session.start();
    session.rounds(3, 'unreachable');
    return session;
  }

  it('asks for recovery exactly once when an incident is confirmed', () => {
    const session = confirmedIncident();

    expect(session.state.phase).toBe('recovering');
    expect(session.count('request_recovery')).toBe(1);
    expect(session.state.nextRoundAtMs).toBeNull();
  });

  it('never asks for recovery before an incident is confirmed', () => {
    const session = new Session(withRecovery);
    session.start();

    session.rounds(2, 'unreachable');

    expect(session.count('request_recovery')).toBe(0);
  });

  it('runs no rounds while a recovery request is pending', () => {
    const session = confirmedIncident();

    expect(session.send({ type: 'tick', atMs: session.now + 600_000 })).toEqual(
      [],
    );
  });

  it('gives the system time to settle, then verifies', () => {
    const session = confirmedIncident();

    session.recovery();

    expect(session.state.phase).toBe('verifying');
    expect(session.state.incident).toMatchObject({
      recoveryAttempts: 1,
      lastRecoveryAtMs: session.now,
    });
    expect(session.state.nextRoundAtMs).toBe(
      session.now + withRecovery.recovery.settleMs,
    );
    expect(session.activity.at(-1)).toEqual({
      kind: 'recovery_requested',
      atMs: session.now,
      attempt: 1,
    });
  });

  it('records the request and that its result is not known yet', () => {
    const session = confirmedIncident();

    session.recovery();

    expect(session.state.lastRecovery).toEqual({
      requestedAtMs: session.now,
      attempt: 1,
      result: 'verifying',
      resolvedAtMs: null,
    });
  });

  it('notes when the check after a request still fails', () => {
    const session = confirmedIncident();
    session.recovery();
    const requestedAt = session.now;

    session.round('unreachable');

    expect(session.state.lastRecovery).toEqual({
      requestedAtMs: requestedAt,
      attempt: 1,
      result: 'not_restored',
      resolvedAtMs: session.now,
    });
    expect(session.activity.at(-1)).toEqual({
      kind: 'recovery_not_effective',
      atMs: session.now,
      attempt: 1,
    });

    // Reported once per request, not on every failed round that follows.
    session.round('unreachable');
    expect(
      session.activityKinds.filter(kind => kind === 'recovery_not_effective'),
    ).toHaveLength(1);
  });

  it('calls a request restored only after verification, and keeps the record', () => {
    const session = confirmedIncident();
    session.recovery();

    session.rounds(2, 'reachable');
    expect(session.state.lastRecovery?.result).toBe('verifying');
    session.round('reachable');

    expect(session.state.lastRecovery).toMatchObject({
      attempt: 1,
      result: 'restored',
      resolvedAtMs: session.now,
    });
    session.rounds(3, 'reachable');
    expect(session.state.lastRecovery?.result).toBe('restored');
  });

  it('counts no attempt and starts no cooldown when nothing was sent', () => {
    const session = confirmedIncident();

    session.recovery('not_sent');

    expect(session.state.phase).toBe('incident');
    expect(session.state.incident).toMatchObject({
      recoveryAttempts: 0,
      lastRecoveryAtMs: null,
    });
    expect(session.state.lastRecovery).toBeNull();
    expect(session.activityKinds).not.toContain('recovery_requested');
    expect(session.state.nextRoundAtMs).toBe(session.now + 15_000);

    // It checks again first, and only then asks again.
    session.round('unreachable');
    expect(session.state.phase).toBe('recovering');
    expect(session.count('request_recovery')).toBe(2);
  });

  it('does not let repeated unsent requests turn into rapid-fire checks', () => {
    const session = confirmedIncident();
    const gaps: number[] = [];

    for (let i = 0; i < 4; i++) {
      session.recovery('not_sent');
      gaps.push(session.state.nextRoundAtMs! - session.now);
      session.round('unreachable');
    }

    expect(gaps).toEqual([15_000, 30_000, 60_000, 120_000]);
  });

  it('ignores a recovery result that nothing asked for', () => {
    const session = new Session(withRecovery);
    session.start();
    session.round('reachable');
    const before = session.state;

    expect(session.recovery()).toEqual([]);
    expect(session.state).toBe(before);
  });
});

describe('cooldown', () => {
  it('waits out the cooldown before asking again, while still checking', () => {
    const session = new Session(withRecovery);
    session.start();
    session.rounds(3, 'unreachable');
    session.recovery();
    const requestedAt = session.now;

    session.round('unreachable');
    expect(session.state.phase).toBe('cooldown');
    expect(session.count('request_recovery')).toBe(1);

    // Every round until the cooldown ends must leave it in cooldown.
    while (session.state.nextRoundAtMs! < requestedAt + 60_000) {
      session.round('unreachable');
      expect(session.state.phase).toBe('cooldown');
      expect(session.count('request_recovery')).toBe(1);
    }
    expect(session.state.nextRoundAtMs).toBe(requestedAt + 60_000);

    session.round('unreachable');
    expect(session.state.phase).toBe('recovering');
    expect(session.count('request_recovery')).toBe(2);
    expect(session.now).toBeGreaterThanOrEqual(requestedAt + 60_000);
  });

  it('leaves cooldown for verification if connectivity returns on its own', () => {
    const session = new Session(withRecovery);
    session.start();
    session.rounds(3, 'unreachable');
    session.recovery();
    session.round('unreachable');

    session.round('reachable');

    expect(session.state.phase).toBe('verifying');
    expect(session.count('request_recovery')).toBe(1);
  });
});

describe('attempt limit', () => {
  it('stops asking after the maximum attempts and hands over to the user', () => {
    const session = new Session(withRecovery);
    session.start();
    session.rounds(3, 'unreachable');

    // Fail every verification until the machine stops asking.
    for (
      let guard = 0;
      guard < 200 && session.state.phase !== 'needs_user_action';
      guard++
    ) {
      if (session.state.phase === 'recovering') {
        session.recovery();
      } else {
        session.round('unreachable');
      }
    }

    expect(session.state.phase).toBe('needs_user_action');
    expect(session.count('request_recovery')).toBe(3);
    expect(session.state.incident?.recoveryAttempts).toBe(3);
    expect(session.activity.at(-1)).toEqual({
      kind: 'needs_user_action',
      atMs: session.now,
      reason: 'attempts_exhausted',
    });

    // It keeps checking (with backoff) but never asks again.
    session.rounds(6, 'unreachable');
    expect(session.count('request_recovery')).toBe(3);
    expect(session.state.phase).toBe('needs_user_action');
    expect(
      session.activityKinds.filter(kind => kind === 'needs_user_action'),
    ).toHaveLength(1);
  });

  it('hands over at once when the system cannot perform recovery', () => {
    const session = new Session(withRecovery);
    session.start();
    session.rounds(3, 'unreachable');

    session.recovery('unsupported');

    expect(session.state.phase).toBe('needs_user_action');
    expect(session.state.incident?.recoveryAttempts).toBe(0);
    expect(session.activity.at(-1)).toMatchObject({
      kind: 'needs_user_action',
      reason: 'recovery_unsupported',
    });

    session.rounds(4, 'unreachable');
    expect(session.count('request_recovery')).toBe(1);
  });

  it('never requests recovery for a captive portal: only the user can sign in', () => {
    const session = new Session(withRecovery);
    session.start();

    for (let i = 0; i < 6; i++) {
      session.round('unreachable', { failureKind: 'captive_portal' });
    }

    expect(session.state.phase).toBe('needs_user_action');
    expect(session.count('request_recovery')).toBe(0);
    expect(session.activity.at(-1)).toMatchObject({
      kind: 'needs_user_action',
      reason: 'captive_portal',
    });
  });

  it('starts a fresh attempt budget for the next incident', () => {
    const session = new Session(withRecovery);
    session.start();
    session.rounds(3, 'unreachable');
    session.recovery();
    session.rounds(3, 'reachable');
    expect(session.state.incident).toBeNull();

    session.rounds(3, 'unreachable');

    expect(session.state.incident?.recoveryAttempts).toBe(0);
    expect(session.state.phase).toBe('recovering');
  });
});

describe('restored connectivity', () => {
  it('is only declared after the required number of consecutive good rounds', () => {
    const session = new Session(withRecovery);
    session.start();
    session.rounds(3, 'unreachable');
    const startedAt = session.state.incident!.startedAtMs;
    session.recovery();

    session.round('reachable');
    expect(session.state.phase).toBe('verifying');
    expect(session.state.nextRoundAtMs).toBe(
      session.now + withRecovery.verifyIntervalMs,
    );
    session.round('reachable');
    expect(session.state.phase).toBe('verifying');
    expect(session.state.incident).not.toBeNull();
    expect(session.activityKinds).not.toContain('incident_restored');

    session.round('reachable');

    expect(session.state.phase).toBe('healthy');
    expect(session.state.incident).toBeNull();
    expect(session.activity.at(-1)).toEqual({
      kind: 'incident_restored',
      atMs: session.now,
      durationMs: session.now - startedAt,
      recoveryAttempts: 1,
    });
    expect(session.state.nextRoundAtMs).toBe(
      session.now + withRecovery.healthyIntervalMs,
    );
  });

  it('restarts verification from zero if a round fails part-way', () => {
    const session = new Session(config);
    session.start();
    session.rounds(3, 'unreachable');

    session.rounds(2, 'reachable');
    session.round('unreachable');
    expect(session.state.phase).toBe('incident');
    expect(session.state.consecutiveReachableRounds).toBe(0);

    session.rounds(2, 'reachable');
    expect(session.state.phase).toBe('verifying');
    session.round('reachable');
    expect(session.state.phase).toBe('healthy');
  });

  it('is verified the same way when no recovery was ever requested', () => {
    const session = new Session(config);
    session.start();
    session.rounds(3, 'unreachable');

    session.rounds(3, 'reachable');

    expect(session.state.phase).toBe('healthy');
    expect(session.activity.at(-1)).toMatchObject({
      kind: 'incident_restored',
      recoveryAttempts: 0,
    });
  });

  it('counts a round that reaches the internet through one endpoint', () => {
    const session = new Session(config);
    session.start();
    session.rounds(3, 'unreachable');

    session.rounds(3, 'partial');

    expect(session.state.phase).toBe('degraded');
    expect(session.state.incident).toBeNull();
  });

  it('can be restored after the attempt limit was reached', () => {
    const session = new Session({
      ...withRecovery,
      recovery: { ...withRecovery.recovery, maxAttemptsPerIncident: 1 },
    });
    session.start();
    session.rounds(3, 'unreachable');
    session.recovery();
    session.round('unreachable');
    expect(session.state.phase).toBe('needs_user_action');

    session.rounds(3, 'reachable');

    expect(session.state.phase).toBe('healthy');
    expect(session.activityKinds.at(-1)).toBe('incident_restored');
  });
});

describe('network changes', () => {
  it('starts in "no network" and sends nothing until a network appears', () => {
    const session = new Session();

    session.start(false);

    expect(session.state.phase).toBe('no_network');
    expect(session.state.nextRoundAtMs).toBeNull();
    expect(session.send({ type: 'tick', atMs: session.now + 600_000 })).toEqual(
      [],
    );
  });

  it('stops probing when the network is lost, cancelling a round in flight', () => {
    const session = new Session();
    session.start();
    session.round('reachable');
    session.beginRound();

    const effects = session.network(false);

    expect(effects).toContainEqual({ type: 'cancel_round' });
    expect(session.state.phase).toBe('no_network');
    expect(session.state.nextRoundAtMs).toBeNull();
    expect(session.state.lastAssessment).toBeNull();
    expect(session.activityKinds.at(-1)).toBe('network_lost');
  });

  it('ignores the cancelled round that finishes after the network was lost', () => {
    const session = new Session();
    session.start();
    session.beginRound();
    session.network(false);

    session.send({
      type: 'round_finished',
      atMs: session.now + 50,
      assessment: assess('inconclusive', session.now + 50),
    });

    expect(session.state.phase).toBe('no_network');
    expect(session.state.roundInFlight).toBe(false);
    expect(session.state.nextRoundAtMs).toBeNull();
  });

  it('checks promptly when a network comes back', () => {
    const session = new Session();
    session.start(false);
    session.now += 30_000;

    session.network(true, true);

    expect(session.state.phase).toBe('monitoring');
    expect(session.state.nextRoundAtMs).toBe(session.now);
    expect(session.activityKinds.at(-1)).toBe('network_available');
  });

  it('treats "no network" found by a round the same as a reported loss', () => {
    const session = new Session();
    session.start();

    session.round('no_network', { bytesUsed: null });

    expect(session.state.phase).toBe('no_network');
    expect(session.state.nextRoundAtMs).toBeNull();
    expect(session.state.roundsCompleted).toBe(0);
    expect(session.state.roundsWithUnknownBytes).toBe(0);
  });

  it('does not let failures on one network count against the next', () => {
    const session = new Session();
    session.start();
    session.rounds(2, 'unreachable');

    session.network(true, true);
    session.round('unreachable');

    expect(session.state.phase).toBe('suspected_failure');
    expect(session.state.consecutiveFailedRounds).toBe(1);
    expect(session.state.incident).toBeNull();
  });

  it('requires verification on the new network before closing an incident', () => {
    const session = new Session();
    session.start();
    session.rounds(3, 'unreachable');

    session.network(false);
    expect(session.state.incident).not.toBeNull();
    session.network(true, true);
    expect(session.state.phase).toBe('verifying');

    session.rounds(3, 'reachable');
    expect(session.state.phase).toBe('healthy');
    expect(session.activityKinds.slice(-3)).toEqual([
      'network_lost',
      'network_available',
      'incident_restored',
    ]);
  });

  it('brings the next check forward when the same network changes', () => {
    const session = new Session();
    session.start();
    session.round('reachable');
    const finishedAt = session.now;
    session.now += 20_000;

    session.network(true);

    expect(session.state.phase).toBe('healthy');
    expect(session.state.nextRoundAtMs).toBe(session.now);
    expect(session.now).toBeGreaterThan(finishedAt + config.minRoundSpacingMs);
  });

  it('never lets a burst of network events trigger rounds back to back', () => {
    const session = new Session();
    session.start();
    session.round('reachable');
    const finishedAt = session.now;

    session.now += 100;
    session.network(true);
    session.network(true);

    expect(session.state.nextRoundAtMs).toBe(
      finishedAt + config.minRoundSpacingMs,
    );
  });

  it('does not let a network event push a nearer check further away', () => {
    const session = new Session();
    session.start();
    session.round('unreachable');
    const due = session.state.nextRoundAtMs!;
    session.now = due - 1_000;

    session.network(true);

    expect(session.state.nextRoundAtMs).toBeLessThanOrEqual(due);
  });
});

describe('data budget', () => {
  const tightBudget: MonitoringConfig = {
    ...withRecovery,
    sessionDataBudgetBytes: 3_000,
  };

  it('adds up what rounds used and notes rounds the device did not report', () => {
    const session = new Session();
    session.start();

    session.round('reachable', { bytesUsed: 1_500 });
    session.round('reachable', { bytesUsed: null });
    session.round('partial', { bytesUsed: 700 });

    expect(session.state.bytesUsed).toBe(2_200);
    expect(session.state.roundsWithUnknownBytes).toBe(1);
    expect(session.state.roundsCompleted).toBe(3);
  });

  it('pauses health checks once the session budget is used up', () => {
    const session = new Session(tightBudget);
    session.start();

    session.rounds(2, 'reachable');
    expect(session.state.pausedBy).toBeNull();
    session.round('reachable');

    expect(session.state.pausedBy).toBe('data_budget');
    expect(session.state.nextRoundAtMs).toBeNull();
    expect(session.state.phase).toBe('monitoring');
    expect(session.activityKinds.at(-1)).toBe('data_budget_reached');
    expect(session.send({ type: 'tick', atMs: session.now + 600_000 })).toEqual(
      [],
    );
  });

  it('stays paused through network changes and sends no recovery request', () => {
    const session = new Session(tightBudget);
    session.start();

    session.rounds(3, 'unreachable');

    expect(session.state.pausedBy).toBe('data_budget');
    expect(session.count('request_recovery')).toBe(0);

    session.network(true);
    session.network(false);
    session.network(true, true);
    expect(session.state.nextRoundAtMs).toBeNull();
    expect(session.count('run_round')).toBe(3);
    expect(
      session.activityKinds.filter(kind => kind === 'data_budget_reached'),
    ).toHaveLength(1);
  });

  it('has no limit when the budget is null', () => {
    const session = new Session({ ...config, sessionDataBudgetBytes: null });
    session.start();

    session.rounds(50, 'reachable');

    expect(session.state.pausedBy).toBeNull();
    expect(session.state.bytesUsed).toBe(50_000);
  });
});

describe('incidentBackoffMs', () => {
  it('grows geometrically from the base and stops at the maximum', () => {
    expect(
      [0, 1, 2, 3, 4, 5, 10].map(n => incidentBackoffMs(n, config)),
    ).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });
});
