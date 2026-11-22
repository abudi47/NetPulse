import type { MonitoringState } from '../../domain/models/monitoring';
import type { ProbeOutcome, ProbeResult } from '../../domain/models/probe';
import type {
  NetworkSnapshot,
  NetworkTransport,
} from '../../domain/models/network';
import {
  measured,
  unavailable,
  type Reading,
  type UnavailableReason,
} from '../../domain/models/reading';
import type {
  FailureKind,
  RoundAssessment,
} from '../../domain/state-machine/assessRound';
import type {
  ActivityEntry,
  MachineState,
  NeedsUserActionReason,
} from '../../domain/state-machine/monitorMachine';
import {
  formatBytes,
  formatClockTime,
  formatDuration,
} from '../../shared/format';
import type { Tone } from '../../theme';

export interface MonitoringStatePresentation {
  readonly title: string;
  readonly description: string;
  readonly tone: Tone;
}

/**
 * User-facing wording for each monitoring state. The copy never promises a
 * fix: Android only lets NetPulse ask for a network re-check.
 */
const MONITORING_STATE_PRESENTATION: Readonly<
  Record<MonitoringState, MonitoringStatePresentation>
> = {
  idle: {
    title: 'Monitoring is off',
    description: 'NetPulse is not watching your connection.',
    tone: 'neutral',
  },
  monitoring: {
    title: 'Monitoring',
    description: 'Watching the active network for changes.',
    tone: 'info',
  },
  checking: {
    title: 'Checking connection',
    description: 'A small health check is in progress.',
    tone: 'info',
  },
  healthy: {
    title: 'Connection healthy',
    description: 'Recent health checks reached the internet.',
    tone: 'positive',
  },
  suspected_failure: {
    title: 'Possible problem',
    description: 'A health check failed. Confirming before doing anything.',
    tone: 'caution',
  },
  incident: {
    title: 'Internet unreachable',
    description: 'Repeated health checks failed on this network.',
    tone: 'critical',
  },
  recovering: {
    title: 'Requesting a re-check',
    description:
      'Android was asked to re-evaluate this network. This is a request, not a guaranteed fix.',
    tone: 'info',
  },
  verifying: {
    title: 'Verifying connection',
    description: 'Confirming the connection is back with repeated checks.',
    tone: 'info',
  },
  degraded: {
    title: 'Connection degraded',
    description: 'Some health checks succeed and others fail.',
    tone: 'caution',
  },
  no_network: {
    title: 'No network',
    description: 'The phone has no active network. Waiting for one to appear.',
    tone: 'caution',
  },
  needs_user_action: {
    title: 'Your action is needed',
    description: 'Only a system setting you control can help here.',
    tone: 'caution',
  },
  cooldown: {
    title: 'Waiting before retrying',
    description: 'Pausing before another recovery request.',
    tone: 'neutral',
  },
};

export function describeMonitoringState(
  state: MonitoringState,
): MonitoringStatePresentation {
  return MONITORING_STATE_PRESENTATION[state];
}

/** The button offers Start only while monitoring is fully stopped. */
export function monitoringControlLabel(state: MonitoringState): string {
  return state === 'idle' ? 'Start monitoring' : 'Stop monitoring';
}

const UNAVAILABLE_TEXT: Readonly<Record<UnavailableReason, string>> = {
  source_not_connected: 'Unavailable',
  source_error: 'Unavailable',
  pending: 'Checking…',
  not_measured_yet: 'Not measured yet',
  not_reported: 'Not reported',
  no_network: 'No network',
  no_response: 'No response',
  none_yet: 'None yet',
};

export interface ReadingPresentation {
  readonly text: string;
  /** False when `text` is a placeholder rather than a measured value. */
  readonly isMeasured: boolean;
}

export function describeReading(reading: Reading<string>): ReadingPresentation {
  if (reading.kind === 'measured') {
    return { text: reading.value, isMeasured: true };
  }
  return { text: UNAVAILABLE_TEXT[reading.reason], isMeasured: false };
}

const TRANSPORT_LABEL: Readonly<Record<NetworkTransport, string>> = {
  wifi: 'Wi-Fi',
  cellular: 'Mobile data',
  ethernet: 'Ethernet',
  bluetooth: 'Bluetooth',
  vpn: 'VPN',
  other: 'Other',
};

/** "Wi-Fi", "Mobile data via VPN", "No network", ... */
export function networkTypeReading(snapshot: NetworkSnapshot): Reading<string> {
  if (!snapshot.hasNetwork) {
    // "No network" is itself something Android reported, not a missing value.
    return measured('No network', snapshot.capturedAtMs);
  }
  if (snapshot.transport === null) {
    return unavailable('not_reported');
  }
  const label = TRANSPORT_LABEL[snapshot.transport];
  const viaVpn = snapshot.isVpn === true && snapshot.transport !== 'vpn';
  return measured(viaVpn ? `${label} via VPN` : label, snapshot.capturedAtMs);
}

/** Android's own verdict on the network. Not a NetPulse health check. */
export function validationReading(snapshot: NetworkSnapshot): Reading<string> {
  if (!snapshot.hasNetwork) {
    return unavailable('no_network');
  }
  if (snapshot.captivePortal === true) {
    return measured('Sign-in required', snapshot.capturedAtMs);
  }
  if (snapshot.validated === null) {
    return unavailable('not_reported');
  }
  return measured(
    snapshot.validated ? 'Validated' : 'Not validated',
    snapshot.capturedAtMs,
  );
}

export function meteringReading(snapshot: NetworkSnapshot): Reading<string> {
  if (!snapshot.hasNetwork) {
    return unavailable('no_network');
  }
  if (snapshot.metered === null) {
    return unavailable('not_reported');
  }
  return measured(
    snapshot.metered ? 'Metered' : 'Unmetered',
    snapshot.capturedAtMs,
  );
}

const FAILURE_TEXT: Readonly<Record<FailureKind, string>> = {
  captive_portal: 'A sign-in page is blocking access',
  dns_failure: 'Server names could not be looked up (DNS)',
  timeout: 'Health checks timed out',
  tls_failure: 'Secure connections could not be set up',
  unexpected_response: 'Servers gave an unexpected answer',
  connection_failure: 'Connections to the servers failed',
  mixed: 'Health checks failed in different ways',
};

/** "Health checks timed out. Android still reports this network as validated." */
export function describeFailure(
  failureKind: FailureKind,
  systemValidated: boolean | null,
): string {
  const cause = `${FAILURE_TEXT[failureKind]}.`;
  if (systemValidated === null) {
    return cause;
  }
  return systemValidated
    ? `${cause} Android still reports this network as validated.`
    : `${cause} Android also reports this network as not validated.`;
}

const USER_ACTION_TEXT: Readonly<Record<NeedsUserActionReason, string>> = {
  captive_portal: 'Sign in to this network to get online.',
  attempts_exhausted:
    'NetPulse has asked Android to re-check as often as it is allowed to. Turning mobile data or Airplane Mode off and on yourself may help.',
  recovery_unsupported:
    'Android could not act on a re-check request. Turning mobile data or Airplane Mode off and on yourself may help.',
};

/**
 * A sentence specific to the current situation, to show instead of the
 * generic description of the state. Null when there is nothing to add.
 */
export function describeSituation(machine: MachineState): string | null {
  const { incident, lastAssessment } = machine;
  if (incident !== null) {
    const failure = describeFailure(
      incident.failureKind,
      incident.systemValidated,
    );
    const since = `Unreachable since ${formatClockTime(incident.startedAtMs)}.`;
    if (machine.phase === 'verifying') {
      return `The internet is answering again. ${machine.consecutiveReachableRounds} good checks in a row so far.`;
    }
    if (machine.phase === 'needs_user_action') {
      const reason: NeedsUserActionReason =
        incident.failureKind === 'captive_portal'
          ? 'captive_portal'
          : incident.recoveryUnsupported
          ? 'recovery_unsupported'
          : 'attempts_exhausted';
      return `${failure} ${USER_ACTION_TEXT[reason]}`;
    }
    return `${failure} ${since}`;
  }
  if (machine.phase === 'degraded' && lastAssessment !== null) {
    return `${lastAssessment.failures.length} of ${
      lastAssessment.attempted
    } health checks failed (${lastAssessment.failures
      .map(describeProbeFailure)
      .join('; ')}). The internet is still reachable.`;
  }
  return null;
}

/** "cloudflare: timed out", "google: answered 200 instead of 204"… */
export function describeProbeFailure(failure: ProbeResult): string {
  const status = failure.httpStatus === null ? '' : ` ${failure.httpStatus}`;
  const how: Record<ProbeOutcome, string> = {
    success: 'succeeded',
    unexpected_status: `answered${status}, not the expected status`,
    redirect: `was redirected${status === '' ? '' : ` (${status.trim()})`}`,
    timeout: 'timed out',
    dns_error: 'name lookup failed',
    tls_error: 'secure connection failed',
    connect_error: 'could not connect',
    io_error: 'connection dropped',
    cancelled: 'was cancelled',
  };
  return `${failure.endpointId}: ${how[failure.outcome]}`;
}

function healthText(assessment: RoundAssessment): string {
  switch (assessment.verdict) {
    case 'reachable':
      return 'Reachable';
    case 'partial':
      return `Partly reachable (${assessment.failures.length} of ${assessment.attempted} checks failed)`;
    default:
      return 'Unreachable';
  }
}

/** What to show for a probe-based value when there is no assessment to read it from. */
function withoutAssessment(machine: MachineState): Reading<never> {
  if (machine.phase === 'idle') {
    return unavailable('not_measured_yet');
  }
  if (machine.phase === 'no_network') {
    return unavailable('no_network');
  }
  return unavailable(
    machine.pausedBy === null ? 'pending' : 'not_measured_yet',
  );
}

/** NetPulse's own verdict, from its latest round of HTTPS checks. */
export function internetHealthReading(machine: MachineState): Reading<string> {
  const assessment = machine.lastAssessment;
  return assessment === null
    ? withoutAssessment(machine)
    : measured(healthText(assessment), assessment.finishedAtMs);
}

/** The fastest successful check of the latest round: a full HTTPS request, not a ping. */
export function latencyReading(machine: MachineState): Reading<string> {
  const assessment = machine.lastAssessment;
  if (assessment === null) {
    return withoutAssessment(machine);
  }
  return assessment.latencyMs === null
    ? unavailable('no_response')
    : measured(
        `${Math.round(assessment.latencyMs)} ms`,
        assessment.finishedAtMs,
      );
}

export function lastSuccessReading(machine: MachineState): Reading<string> {
  if (machine.lastReachableAtMs !== null) {
    return measured(
      formatClockTime(machine.lastReachableAtMs),
      machine.lastReachableAtMs,
    );
  }
  if (machine.phase === 'idle' || machine.roundsCompleted > 0) {
    return unavailable('not_measured_yet');
  }
  return withoutAssessment(machine);
}

/** Approximate data used by health checks since monitoring was started. */
export function diagnosticDataReading(machine: MachineState): Reading<string> {
  if (machine.roundsCompleted === 0 || machine.lastRoundFinishedAtMs === null) {
    return machine.phase === 'idle' || machine.phase === 'no_network'
      ? unavailable('not_measured_yet')
      : unavailable('pending');
  }
  if (machine.roundsWithUnknownBytes === machine.roundsCompleted) {
    // The device reported nothing for any round; zero would be a made-up figure.
    return unavailable('not_reported');
  }
  return measured(
    `≈ ${formatBytes(machine.bytesUsed)}`,
    machine.lastRoundFinishedAtMs,
  );
}

const RECOVERY_RESULT_TEXT: Readonly<
  Record<NonNullable<MachineState['lastRecovery']>['result'], string>
> = {
  verifying: 'checking the result',
  // Deliberately "back", not "fixed": the request may not be what did it.
  restored: 'connection back',
  not_restored: 'still unreachable',
};

/** The latest request to Android to re-check the network, and what followed. */
export function recoveryReading(machine: MachineState): Reading<string> {
  const record = machine.lastRecovery;
  if (record === null) {
    return unavailable('none_yet');
  }
  return measured(
    `Requested ${formatClockTime(record.requestedAtMs)}, ${
      RECOVERY_RESULT_TEXT[record.result]
    }`,
    record.resolvedAtMs ?? record.requestedAtMs,
  );
}

export interface ActivityPresentation {
  readonly title: string;
  readonly detail: string | null;
  readonly tone: Tone;
}

/** Wording for one line of the activity timeline. */
export function describeActivity(entry: ActivityEntry): ActivityPresentation {
  switch (entry.kind) {
    case 'monitoring_started':
      return { title: 'Monitoring started', detail: null, tone: 'info' };
    case 'monitoring_stopped':
      return {
        title: 'Monitoring stopped',
        detail:
          entry.roundsCompleted === 0
            ? 'No health checks were run.'
            : `${entry.roundsCompleted} health ${
                entry.roundsCompleted === 1 ? 'check' : 'checks'
              } run, about ${formatBytes(entry.bytesUsed)} of data used.`,
        tone: 'neutral',
      };
    case 'network_lost':
      return { title: 'Network lost', detail: null, tone: 'caution' };
    case 'network_available':
      return { title: 'Network available', detail: null, tone: 'info' };
    case 'incident_started':
      return {
        title: 'Internet unreachable',
        detail: describeFailure(entry.failureKind, entry.systemValidated),
        tone: 'critical',
      };
    case 'recovery_requested':
      return {
        title: 'Asked Android to re-check the network',
        detail: `Request ${entry.attempt} for this outage, made with Android's reportNetworkConnectivity. It is a request, not a guaranteed fix.`,
        tone: 'info',
      };
    case 'recovery_not_effective':
      return {
        title: 'Still unreachable after the request',
        detail: `The check that followed request ${entry.attempt} failed.`,
        tone: 'caution',
      };
    case 'needs_user_action':
      return {
        title: 'Your action is needed',
        detail: USER_ACTION_TEXT[entry.reason],
        tone: 'caution',
      };
    case 'incident_restored':
      return {
        title: 'Connection restored',
        detail: `Unreachable for ${formatDuration(entry.durationMs)}. ${
          entry.recoveryAttempts === 0
            ? 'No re-check was requested.'
            : `Re-check requests sent: ${entry.recoveryAttempts}.`
        }`,
        tone: 'positive',
      };
    case 'data_budget_reached':
      return {
        title: 'Health checks paused',
        detail: "This session's diagnostic data budget is used up.",
        tone: 'caution',
      };
  }
}
