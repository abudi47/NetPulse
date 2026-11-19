import type { NetworkSnapshot } from '../models/network';
import type { ProbeOutcome, ProbeResult, ProbeRound } from '../models/probe';

/** What one probe round says about the internet connection. */
export type RoundVerdict =
  /** Every endpoint answered correctly. */
  | 'reachable'
  /** At least one answered and at least one did not: an endpoint problem, not an outage. */
  | 'partial'
  /** No endpoint answered correctly. */
  | 'unreachable'
  /** There was no network to probe; nothing was sent. */
  | 'no_network'
  /** The round cannot be trusted (network changed mid-round, cancelled, or empty). */
  | 'inconclusive';

/** For an unreachable round, the most specific cause the evidence supports. */
export type FailureKind =
  /** A sign-in page is in the way (the system says so, or every probe was redirected). */
  | 'captive_portal'
  /** Every probe failed to resolve its host name. */
  | 'dns_failure'
  /** Every probe ran out of time. */
  | 'timeout'
  /** Every probe failed to set up a secure connection. */
  | 'tls_failure'
  /** Every endpoint answered, but none with the expected status. */
  | 'unexpected_response'
  /** Every probe failed to connect or lost its connection. */
  | 'connection_failure'
  /** The probes failed in different ways. */
  | 'mixed';

export interface RoundAssessment {
  readonly verdict: RoundVerdict;
  /** Set exactly when `verdict` is 'unreachable'. */
  readonly failureKind: FailureKind | null;
  /**
   * What the operating system said about the network: true/false for its
   * own validation, null when unknown. Kept alongside the verdict because
   * "probes fail but the system still says validated" is the very situation
   * NetPulse exists for.
   */
  readonly systemValidated: boolean | null;
  readonly succeeded: number;
  readonly attempted: number;
  /** The probes that did not succeed, with how each one failed. */
  readonly failures: readonly ProbeResult[];
  /** Duration of the fastest successful probe, or null if none succeeded. */
  readonly latencyMs: number | null;
  readonly finishedAtMs: number;
  /** Approximate bytes used by the round, or null if the device did not report it. */
  readonly bytesUsed: number | null;
}

const KIND_BY_OUTCOME: Readonly<
  Record<Exclude<ProbeOutcome, 'success' | 'cancelled'>, FailureKind>
> = {
  redirect: 'captive_portal',
  dns_error: 'dns_failure',
  timeout: 'timeout',
  tls_error: 'tls_failure',
  unexpected_status: 'unexpected_response',
  connect_error: 'connection_failure',
  io_error: 'connection_failure',
};

/**
 * Judges a probe round. Pure: no clocks, no I/O.
 *
 * @param network What the system last reported about the default network, or
 *   null if nothing is known. Used only as supporting evidence.
 * @param expectedEndpointIds The endpoints that were supposed to be probed.
 *   A round that does not report on exactly these is inconclusive, so that a
 *   truncated result can never pass for "every endpoint failed".
 */
export function assessRound(
  round: ProbeRound,
  network: NetworkSnapshot | null,
  expectedEndpointIds: readonly string[],
): RoundAssessment {
  const base = {
    failureKind: null,
    systemValidated: network?.hasNetwork ? network.validated : null,
    succeeded: 0,
    attempted: round.results.length,
    failures: [] as readonly ProbeResult[],
    latencyMs: null,
    finishedAtMs: round.finishedAtMs,
    bytesUsed: round.bytesUsed,
  };

  if (!round.hadNetwork) {
    return { ...base, verdict: 'no_network', attempted: 0 };
  }
  const reportedIds = round.results.map(result => result.endpointId);
  const coversEveryEndpoint =
    reportedIds.length === expectedEndpointIds.length &&
    expectedEndpointIds.every(id => reportedIds.includes(id));
  if (
    round.networkChanged ||
    !coversEveryEndpoint ||
    expectedEndpointIds.length === 0 ||
    round.results.some(result => result.outcome === 'cancelled')
  ) {
    return { ...base, verdict: 'inconclusive' };
  }

  const successes = round.results.filter(r => r.outcome === 'success');
  const failures = round.results.filter(r => r.outcome !== 'success');
  const measured = {
    ...base,
    succeeded: successes.length,
    failures,
    latencyMs:
      successes.length > 0
        ? Math.min(...successes.map(result => result.durationMs))
        : null,
  };

  if (failures.length === 0) {
    return { ...measured, verdict: 'reachable' };
  }
  if (successes.length > 0) {
    return { ...measured, verdict: 'partial' };
  }

  const kinds = new Set(
    failures.map(
      result => KIND_BY_OUTCOME[result.outcome as keyof typeof KIND_BY_OUTCOME],
    ),
  );
  let failureKind: FailureKind = kinds.size === 1 ? [...kinds][0] : 'mixed';
  if (network?.hasNetwork && network.captivePortal === true) {
    // The system has itself detected a sign-in page; that explains the failures.
    failureKind = 'captive_portal';
  }
  return { ...measured, verdict: 'unreachable', failureKind };
}
