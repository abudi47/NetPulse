import type { MonitoringConfig } from '../config/monitoringConfig';
import type { MonitoringState } from '../models/monitoring';
import type { FailureKind, RoundAssessment } from './assessRound';

/*
 * The incident state machine.
 *
 * `transition(state, event, config)` is the whole of NetPulse's monitoring
 * logic: given what was known and what just happened, it returns what is known
 * now and what should be done about it. It is pure. It never reads a clock,
 * starts a timer, or touches the network; every event carries its own time,
 * and anything to be done comes back as an effect for the caller to carry out.
 * That is what makes each rule below testable in isolation.
 */

/** An outage that has been confirmed and not yet verified as over. */
export interface OpenIncident {
  /** When the first failed round of the streak that confirmed it finished. */
  readonly startedAtMs: number;
  readonly confirmedAtMs: number;
  /** Cause suggested by the most recent failed round. */
  readonly failureKind: FailureKind;
  /** What the system said about the network at the most recent failed round. */
  readonly systemValidated: boolean | null;
  readonly recoveryAttempts: number;
  readonly lastRecoveryAtMs: number | null;
  /** Set when the system could not carry out a recovery request at all. */
  readonly recoveryUnsupported: boolean;
  /** Failed rounds since confirmation; spaces later rounds further apart. */
  readonly failedRoundsSinceConfirmed: number;
}

/** The most recent recovery request of this session and what followed it. */
export interface RecoveryRecord {
  readonly requestedAtMs: number;
  /** 1 for the first request of its incident. */
  readonly attempt: number;
  /**
   * 'verifying': waiting to see whether connectivity returns.
   * 'restored': connectivity was later verified by repeated checks.
   * 'not_restored': the next check after the request still failed.
   * Neither outcome proves the request caused it.
   */
  readonly result: 'verifying' | 'restored' | 'not_restored';
  /** When `result` stopped being 'verifying'. */
  readonly resolvedAtMs: number | null;
}

export interface MachineState {
  readonly phase: MonitoringState;
  /** Last known: is there a default network? `null` before anything is known. */
  readonly hasNetwork: boolean | null;
  readonly roundInFlight: boolean;
  /** When the next round is due, or null when none is scheduled. */
  readonly nextRoundAtMs: number | null;
  /** Rounds in a row in which every endpoint failed, before any incident. */
  readonly consecutiveFailedRounds: number;
  readonly firstFailureAtMs: number | null;
  /** Rounds in a row that reached the internet while an incident is open. */
  readonly consecutiveReachableRounds: number;
  readonly incident: OpenIncident | null;
  readonly lastRecovery: RecoveryRecord | null;
  /** The latest conclusive round on the current network. */
  readonly lastAssessment: RoundAssessment | null;
  readonly lastReachableAtMs: number | null;
  readonly lastRoundFinishedAtMs: number | null;
  /** Approximate bytes used by health checks this session. */
  readonly bytesUsed: number;
  /** Rounds whose data use the device did not report (so `bytesUsed` omits them). */
  readonly roundsWithUnknownBytes: number;
  readonly roundsCompleted: number;
  /** Why health checks are paused although monitoring is on, if they are. */
  readonly pausedBy: 'data_budget' | null;
}

export type MachineEvent =
  /** The user turned monitoring on. */
  | {
      readonly type: 'start';
      readonly atMs: number;
      readonly hasNetwork: boolean | null;
    }
  /** The user turned monitoring off. */
  | { readonly type: 'stop'; readonly atMs: number }
  /** The system reported something about the default network. */
  | {
      readonly type: 'network_changed';
      readonly atMs: number;
      readonly hasNetwork: boolean;
      /** True when a different network became the default. */
      readonly isNewNetwork: boolean;
    }
  /** Time has passed; start a round if one is due. */
  | { readonly type: 'tick'; readonly atMs: number }
  /** A round finished and has been assessed. */
  | {
      readonly type: 'round_finished';
      readonly atMs: number;
      readonly assessment: RoundAssessment;
    }
  /** A round could not be run at all (the native call failed). */
  | { readonly type: 'round_not_run'; readonly atMs: number }
  /** The outcome of carrying out a `request_recovery` effect. */
  | {
      readonly type: 'recovery_requested';
      readonly atMs: number;
      /**
       * 'requested': the hint was given to the system.
       * 'not_sent': nothing was sent because the situation had changed (the
       *   network went away or switched, or native could not confirm the failure).
       * 'unsupported': the system rejected the call.
       */
      readonly outcome: 'requested' | 'not_sent' | 'unsupported';
    };

export type NeedsUserActionReason =
  | 'captive_portal'
  | 'attempts_exhausted'
  | 'recovery_unsupported';

/** Something worth showing in the activity timeline. */
export type ActivityEntry =
  | { readonly kind: 'monitoring_started'; readonly atMs: number }
  | {
      readonly kind: 'monitoring_stopped';
      readonly atMs: number;
      readonly bytesUsed: number;
      readonly roundsCompleted: number;
    }
  | { readonly kind: 'network_lost'; readonly atMs: number }
  | { readonly kind: 'network_available'; readonly atMs: number }
  | {
      readonly kind: 'incident_started';
      readonly atMs: number;
      readonly failureKind: FailureKind;
      readonly systemValidated: boolean | null;
    }
  | {
      readonly kind: 'recovery_requested';
      readonly atMs: number;
      /** 1 for the first request of this incident. */
      readonly attempt: number;
    }
  | {
      /** The first check after a recovery request still failed. */
      readonly kind: 'recovery_not_effective';
      readonly atMs: number;
      readonly attempt: number;
    }
  | {
      readonly kind: 'needs_user_action';
      readonly atMs: number;
      readonly reason: NeedsUserActionReason;
    }
  | {
      readonly kind: 'incident_restored';
      readonly atMs: number;
      readonly durationMs: number;
      readonly recoveryAttempts: number;
    }
  | { readonly kind: 'data_budget_reached'; readonly atMs: number };

export type MachineEffect =
  /** Run a probe round now, then send `round_finished` or `round_not_run`. */
  | { readonly type: 'run_round' }
  /** Cancel the round in flight. */
  | { readonly type: 'cancel_round' }
  /** Ask the system to re-check the network, then send `recovery_requested`. */
  | { readonly type: 'request_recovery' }
  | { readonly type: 'activity'; readonly entry: ActivityEntry };

export interface Transition {
  readonly state: MachineState;
  readonly effects: readonly MachineEffect[];
}

export function initialMachineState(): MachineState {
  return {
    phase: 'idle',
    hasNetwork: null,
    roundInFlight: false,
    nextRoundAtMs: null,
    consecutiveFailedRounds: 0,
    firstFailureAtMs: null,
    consecutiveReachableRounds: 0,
    incident: null,
    lastRecovery: null,
    lastAssessment: null,
    lastReachableAtMs: null,
    lastRoundFinishedAtMs: null,
    bytesUsed: 0,
    roundsWithUnknownBytes: 0,
    roundsCompleted: 0,
    pausedBy: null,
  };
}

const unchanged = (state: MachineState): Transition => ({ state, effects: [] });

const activity = (entry: ActivityEntry): MachineEffect => ({
  type: 'activity',
  entry,
});

/** Delay before the next round while an incident persists. */
export function incidentBackoffMs(
  failedRoundsSinceConfirmed: number,
  config: MonitoringConfig,
): number {
  const { baseMs, factor, maxMs } = config.incidentBackoff;
  return Math.min(maxMs, baseMs * Math.pow(factor, failedRoundsSinceConfirmed));
}

/** The earliest moment another round may start. */
function soonestRoundAt(
  state: MachineState,
  atMs: number,
  config: MonitoringConfig,
) {
  return state.lastRoundFinishedAtMs === null
    ? atMs
    : Math.max(atMs, state.lastRoundFinishedAtMs + config.minRoundSpacingMs);
}

/**
 * With an incident open and the internet still unreachable, decides what
 * happens next: ask for recovery, wait out the cooldown, or hand over to the
 * user. This is the only place recovery is ever initiated.
 */
function continueIncident(
  state: MachineState,
  incident: OpenIncident,
  atMs: number,
  config: MonitoringConfig,
): Transition {
  const backoffAt =
    atMs + incidentBackoffMs(incident.failedRoundsSinceConfirmed, config);

  const handOver = (reason: NeedsUserActionReason): Transition => ({
    state: {
      ...state,
      incident,
      phase: 'needs_user_action',
      nextRoundAtMs: backoffAt,
    },
    // Announce the hand-over once, not on every failed round that follows.
    effects:
      state.phase === 'needs_user_action'
        ? []
        : [activity({ kind: 'needs_user_action', atMs, reason })],
  });

  if (incident.failureKind === 'captive_portal') {
    // Only the user can sign in to a captive portal.
    return handOver('captive_portal');
  }
  if (!config.recovery.enabled) {
    return {
      state: {
        ...state,
        incident,
        phase: 'incident',
        nextRoundAtMs: backoffAt,
      },
      effects: [],
    };
  }
  if (incident.recoveryUnsupported) {
    return handOver('recovery_unsupported');
  }
  if (incident.recoveryAttempts >= config.recovery.maxAttemptsPerIncident) {
    return handOver('attempts_exhausted');
  }

  const cooldownEndsAt =
    incident.lastRecoveryAtMs === null
      ? atMs
      : incident.lastRecoveryAtMs + config.recovery.cooldownMs;
  if (atMs < cooldownEndsAt) {
    return {
      state: {
        ...state,
        incident,
        phase: 'cooldown',
        nextRoundAtMs: Math.min(backoffAt, cooldownEndsAt),
      },
      effects: [],
    };
  }
  return {
    state: { ...state, incident, phase: 'recovering', nextRoundAtMs: null },
    effects: [{ type: 'request_recovery' }],
  };
}

function onNetworkLost(state: MachineState, atMs: number): Transition {
  return {
    state: {
      ...state,
      phase: 'no_network',
      hasNetwork: false,
      nextRoundAtMs: null,
      consecutiveFailedRounds: 0,
      firstFailureAtMs: null,
      consecutiveReachableRounds: 0,
      lastAssessment: null,
    },
    effects: [
      ...(state.roundInFlight ? [{ type: 'cancel_round' } as const] : []),
      ...(state.phase === 'no_network'
        ? []
        : [activity({ kind: 'network_lost', atMs })]),
    ],
  };
}

function onRoundFinished(
  state: MachineState,
  atMs: number,
  assessment: RoundAssessment,
  config: MonitoringConfig,
): Transition {
  // Account for the round whatever it concluded.
  const sentSomething = assessment.verdict !== 'no_network';
  const counted: MachineState = {
    ...state,
    roundInFlight: false,
    lastRoundFinishedAtMs: atMs,
    roundsCompleted: state.roundsCompleted + (sentSomething ? 1 : 0),
    bytesUsed: state.bytesUsed + (assessment.bytesUsed ?? 0),
    roundsWithUnknownBytes:
      state.roundsWithUnknownBytes +
      (sentSomething && assessment.bytesUsed === null ? 1 : 0),
  };

  const decided = decideAfterRound(counted, atMs, assessment, config);

  const overBudget =
    config.sessionDataBudgetBytes !== null &&
    decided.state.bytesUsed >= config.sessionDataBudgetBytes;
  if (!overBudget || decided.state.pausedBy !== null) {
    return decided;
  }
  // Out of data budget: stop sending anything, including recovery requests.
  return {
    state: {
      ...decided.state,
      pausedBy: 'data_budget',
      nextRoundAtMs: null,
      // With no more checks there is no current verdict to stand behind.
      phase: decided.state.phase === 'no_network' ? 'no_network' : 'monitoring',
    },
    effects: [
      ...decided.effects.filter(effect => effect.type !== 'request_recovery'),
      activity({ kind: 'data_budget_reached', atMs }),
    ],
  };
}

function decideAfterRound(
  state: MachineState,
  atMs: number,
  assessment: RoundAssessment,
  config: MonitoringConfig,
): Transition {
  if (assessment.verdict === 'no_network') {
    return onNetworkLost(state, atMs);
  }
  if (state.phase === 'no_network') {
    // The network vanished while this round was in flight; its result is moot.
    return unchanged(state);
  }

  if (assessment.verdict === 'inconclusive') {
    return {
      state: {
        ...state,
        phase: state.phase === 'checking' ? 'monitoring' : state.phase,
        nextRoundAtMs: state.nextRoundAtMs ?? atMs + config.confirmIntervalMs,
      },
      effects: [],
    };
  }

  if (assessment.verdict === 'reachable' || assessment.verdict === 'partial') {
    const settled: MonitoringState =
      assessment.verdict === 'reachable' ? 'healthy' : 'degraded';
    const reached: MachineState = {
      ...state,
      lastAssessment: assessment,
      lastReachableAtMs: atMs,
      consecutiveFailedRounds: 0,
      firstFailureAtMs: null,
    };

    if (state.incident === null) {
      return {
        state: {
          ...reached,
          phase: settled,
          nextRoundAtMs: atMs + config.healthyIntervalMs,
        },
        effects: [],
      };
    }

    const reachableRounds = state.consecutiveReachableRounds + 1;
    if (reachableRounds < config.verificationRounds) {
      return {
        state: {
          ...reached,
          phase: 'verifying',
          consecutiveReachableRounds: reachableRounds,
          nextRoundAtMs: atMs + config.verifyIntervalMs,
        },
        effects: [],
      };
    }
    return {
      state: {
        ...reached,
        phase: settled,
        incident: null,
        consecutiveReachableRounds: 0,
        nextRoundAtMs: atMs + config.healthyIntervalMs,
        lastRecovery:
          state.lastRecovery !== null && state.incident.recoveryAttempts > 0
            ? { ...state.lastRecovery, result: 'restored', resolvedAtMs: atMs }
            : state.lastRecovery,
      },
      effects: [
        activity({
          kind: 'incident_restored',
          atMs,
          durationMs: atMs - state.incident.startedAtMs,
          recoveryAttempts: state.incident.recoveryAttempts,
        }),
      ],
    };
  }

  // Unreachable: no endpoint answered correctly.
  const failureKind = assessment.failureKind ?? 'mixed';
  const failed: MachineState = {
    ...state,
    lastAssessment: assessment,
    consecutiveReachableRounds: 0,
  };

  if (state.incident !== null) {
    // If a recovery request is awaiting its verdict, this failed round is it.
    const pending =
      state.lastRecovery?.result === 'verifying' ? state.lastRecovery : null;
    const continued = continueIncident(
      pending === null
        ? failed
        : {
            ...failed,
            lastRecovery: {
              ...pending,
              result: 'not_restored',
              resolvedAtMs: atMs,
            },
          },
      {
        ...state.incident,
        failureKind,
        systemValidated: assessment.systemValidated,
        failedRoundsSinceConfirmed:
          state.incident.failedRoundsSinceConfirmed + 1,
      },
      atMs,
      config,
    );
    return pending === null
      ? continued
      : {
          state: continued.state,
          effects: [
            activity({
              kind: 'recovery_not_effective',
              atMs,
              attempt: pending.attempt,
            }),
            ...continued.effects,
          ],
        };
  }

  const failedRounds = state.consecutiveFailedRounds + 1;
  const firstFailureAtMs = state.firstFailureAtMs ?? atMs;
  if (failedRounds < config.failureThreshold) {
    return {
      state: {
        ...failed,
        phase: 'suspected_failure',
        consecutiveFailedRounds: failedRounds,
        firstFailureAtMs,
        nextRoundAtMs: atMs + config.confirmIntervalMs,
      },
      effects: [],
    };
  }

  const confirmed = continueIncident(
    { ...failed, consecutiveFailedRounds: 0, firstFailureAtMs: null },
    {
      startedAtMs: firstFailureAtMs,
      confirmedAtMs: atMs,
      failureKind,
      systemValidated: assessment.systemValidated,
      recoveryAttempts: 0,
      lastRecoveryAtMs: null,
      recoveryUnsupported: false,
      failedRoundsSinceConfirmed: 0,
    },
    atMs,
    config,
  );
  return {
    state: confirmed.state,
    effects: [
      activity({
        kind: 'incident_started',
        atMs,
        failureKind,
        systemValidated: assessment.systemValidated,
      }),
      ...confirmed.effects,
    ],
  };
}

function onNetworkChanged(
  state: MachineState,
  event: Extract<MachineEvent, { type: 'network_changed' }>,
  config: MonitoringConfig,
): Transition {
  const { atMs } = event;
  if (!event.hasNetwork) {
    return onNetworkLost(state, atMs);
  }

  const due =
    state.pausedBy === null ? soonestRoundAt(state, atMs, config) : null;

  if (state.phase === 'no_network' || event.isNewNetwork) {
    // A network we have no verdict on. Anything concluded before is stale.
    return {
      state: {
        ...state,
        hasNetwork: true,
        phase: state.incident === null ? 'monitoring' : 'verifying',
        nextRoundAtMs: due,
        consecutiveFailedRounds: 0,
        firstFailureAtMs: null,
        consecutiveReachableRounds: 0,
        lastAssessment: null,
      },
      effects: [
        ...(state.roundInFlight ? [{ type: 'cancel_round' } as const] : []),
        ...(state.phase === 'no_network'
          ? [activity({ kind: 'network_available', atMs })]
          : []),
      ],
    };
  }

  // Same network, something about it changed (e.g. the system's validation).
  // That is a hint worth checking soon, unless a recovery request is pending.
  if (state.phase === 'recovering' || due === null) {
    return unchanged({ ...state, hasNetwork: true });
  }
  return unchanged({
    ...state,
    hasNetwork: true,
    nextRoundAtMs:
      state.nextRoundAtMs === null ? due : Math.min(state.nextRoundAtMs, due),
  });
}

/** The state machine. See the note at the top of this file. */
export function transition(
  state: MachineState,
  event: MachineEvent,
  config: MonitoringConfig,
): Transition {
  if (event.type === 'start') {
    if (state.phase !== 'idle') {
      return unchanged(state);
    }
    const started = activity({ kind: 'monitoring_started', atMs: event.atMs });
    return event.hasNetwork === false
      ? {
          state: {
            ...initialMachineState(),
            phase: 'no_network',
            hasNetwork: false,
          },
          effects: [started],
        }
      : {
          state: {
            ...initialMachineState(),
            phase: 'monitoring',
            hasNetwork: event.hasNetwork,
            nextRoundAtMs: event.atMs,
          },
          effects: [started],
        };
  }

  // Nothing but `start` means anything while monitoring is off.
  if (state.phase === 'idle') {
    return unchanged(state);
  }

  switch (event.type) {
    case 'stop':
      return {
        state: initialMachineState(),
        effects: [
          ...(state.roundInFlight ? [{ type: 'cancel_round' } as const] : []),
          activity({
            kind: 'monitoring_stopped',
            atMs: event.atMs,
            bytesUsed: state.bytesUsed,
            roundsCompleted: state.roundsCompleted,
          }),
        ],
      };

    case 'network_changed':
      return onNetworkChanged(state, event, config);

    case 'tick': {
      const due =
        state.nextRoundAtMs !== null && event.atMs >= state.nextRoundAtMs;
      if (
        !due ||
        state.roundInFlight ||
        state.pausedBy !== null ||
        state.phase === 'no_network' ||
        state.phase === 'recovering'
      ) {
        return unchanged(state);
      }
      return {
        state: {
          ...state,
          roundInFlight: true,
          nextRoundAtMs: null,
          phase: state.phase === 'monitoring' ? 'checking' : state.phase,
        },
        effects: [{ type: 'run_round' }],
      };
    }

    case 'round_finished':
      return state.roundInFlight
        ? onRoundFinished(state, event.atMs, event.assessment, config)
        : unchanged(state);

    case 'round_not_run':
      if (!state.roundInFlight) {
        return unchanged(state);
      }
      return unchanged({
        ...state,
        roundInFlight: false,
        phase: state.phase === 'checking' ? 'monitoring' : state.phase,
        nextRoundAtMs:
          state.phase === 'no_network'
            ? null
            : state.nextRoundAtMs ?? event.atMs + config.confirmIntervalMs,
      });

    case 'recovery_requested': {
      if (state.phase !== 'recovering' || state.incident === null) {
        return unchanged(state);
      }
      if (event.outcome === 'unsupported') {
        return continueIncident(
          state,
          { ...state.incident, recoveryUnsupported: true },
          event.atMs,
          config,
        );
      }
      if (event.outcome === 'not_sent') {
        // Nothing was asked of the system, so no attempt is counted and no
        // cooldown starts. Check again before deciding anything else.
        return unchanged({
          ...state,
          phase: 'incident',
          nextRoundAtMs:
            event.atMs +
            incidentBackoffMs(
              state.incident.failedRoundsSinceConfirmed,
              config,
            ),
        });
      }
      const attempt = state.incident.recoveryAttempts + 1;
      return {
        state: {
          ...state,
          phase: 'verifying',
          consecutiveReachableRounds: 0,
          nextRoundAtMs: event.atMs + config.recovery.settleMs,
          incident: {
            ...state.incident,
            recoveryAttempts: attempt,
            lastRecoveryAtMs: event.atMs,
          },
          lastRecovery: {
            requestedAtMs: event.atMs,
            attempt,
            result: 'verifying',
            resolvedAtMs: null,
          },
        },
        effects: [
          activity({ kind: 'recovery_requested', atMs: event.atMs, attempt }),
        ],
      };
    }
  }
}
