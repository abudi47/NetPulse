import type { ProbeEndpoint, ProbeTimeouts } from '../models/probe';

/**
 * Every tunable number in NetPulse's monitoring lives in this file.
 *
 * The defaults follow docs/PRODUCT_SPEC.md §7. They are starting values, not
 * guarantees, and are meant to be tuned after measuring battery and data use
 * on real devices.
 */
export interface MonitoringConfig {
  /**
   * Where health probes are sent. At least two, on different hosts run by
   * different operators, so that one provider's outage is never mistaken for
   * the phone losing internet access.
   */
  readonly endpoints: readonly ProbeEndpoint[];
  readonly timeouts: ProbeTimeouts;

  /** Consecutive rounds in which every endpoint failed before an incident is declared. */
  readonly failureThreshold: number;
  /** Consecutive rounds that reach the internet before an incident is called restored. */
  readonly verificationRounds: number;

  /** Time between rounds while the connection is healthy. */
  readonly healthyIntervalMs: number;
  /** Time before re-checking after a failed round, to confirm or dismiss it. */
  readonly confirmIntervalMs: number;
  /** Time between rounds while verifying that connectivity is back. */
  readonly verifyIntervalMs: number;
  /**
   * While an incident persists, rounds are spaced further and further apart:
   * baseMs, then baseMs × factor, ... never more than maxMs.
   */
  readonly incidentBackoff: {
    readonly baseMs: number;
    readonly factor: number;
    readonly maxMs: number;
  };
  /** Rounds triggered by network changes are never closer together than this. */
  readonly minRoundSpacingMs: number;

  readonly recovery: {
    /**
     * Whether a confirmed incident makes NetPulse ask Android to re-check the
     * network (a hint Android may act on; never a guaranteed fix). When false,
     * incidents are detected and tracked but nothing is attempted.
     */
    readonly enabled: boolean;
    readonly maxAttemptsPerIncident: number;
    /** Minimum time between recovery requests within one incident. */
    readonly cooldownMs: number;
    /** Time given to the system after a request before verification starts. */
    readonly settleMs: number;
  };

  /**
   * Health checks pause once a monitoring session has used this many bytes.
   * `null` disables the limit.
   */
  readonly sessionDataBudgetBytes: number | null;
}

export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  // Both answer HTTPS requests with an empty "204 No Content". They are run by
  // unrelated companies on unrelated networks. NetPulse does not operate them;
  // swap in your own endpoint here if you host one.
  endpoints: [
    {
      id: 'google',
      url: 'https://www.google.com/generate_204',
      expectedStatus: 204,
    },
    {
      id: 'cloudflare',
      url: 'https://cp.cloudflare.com/generate_204',
      expectedStatus: 204,
    },
  ],
  timeouts: {
    connectTimeoutMs: 4_000,
    readTimeoutMs: 4_000,
    callTimeoutMs: 5_000,
  },
  failureThreshold: 3,
  verificationRounds: 3,
  healthyIntervalMs: 60_000,
  confirmIntervalMs: 10_000,
  verifyIntervalMs: 5_000,
  incidentBackoff: { baseMs: 15_000, factor: 2, maxMs: 300_000 },
  minRoundSpacingMs: 3_000,
  recovery: {
    enabled: true,
    maxAttemptsPerIncident: 3,
    cooldownMs: 60_000,
    settleMs: 5_000,
  },
  sessionDataBudgetBytes: 5 * 1024 * 1024,
};

function hostOf(url: string): string | null {
  const match = /^https:\/\/([^/:?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Lists everything wrong with a configuration, in plain words. An empty list
 * means it is safe to use. The limits mirror what the native probe code
 * accepts, so a bad value is caught here rather than at the first probe.
 */
export function findConfigProblems(config: MonitoringConfig): string[] {
  const problems: string[] = [];
  const wholeAtLeast = (value: number, minimum: number) =>
    Number.isInteger(value) && value >= minimum;

  if (config.endpoints.length < 2 || config.endpoints.length > 5) {
    problems.push('Between 2 and 5 probe endpoints are required.');
  }
  const hosts = config.endpoints.map(endpoint => hostOf(endpoint.url));
  if (hosts.includes(null)) {
    problems.push('Every probe endpoint needs an https:// URL.');
  } else if (new Set(hosts).size !== hosts.length) {
    problems.push('Probe endpoints must be on different hosts.');
  }
  if (
    new Set(config.endpoints.map(e => e.id)).size !== config.endpoints.length
  ) {
    problems.push('Probe endpoint ids must be unique.');
  }
  if (config.endpoints.some(e => e.id.trim() === '')) {
    problems.push('Every probe endpoint needs an id.');
  }
  if (
    config.endpoints.some(
      e =>
        !Number.isInteger(e.expectedStatus) ||
        e.expectedStatus < 200 ||
        e.expectedStatus > 299,
    )
  ) {
    problems.push('Expected statuses must be whole numbers from 200 to 299.');
  }

  const { connectTimeoutMs, readTimeoutMs, callTimeoutMs } = config.timeouts;
  if (
    [connectTimeoutMs, readTimeoutMs, callTimeoutMs].some(
      ms => !Number.isInteger(ms) || ms < 500 || ms > 15_000,
    )
  ) {
    problems.push('Probe timeouts must be whole numbers from 500 to 15000 ms.');
  }
  if (callTimeoutMs < connectTimeoutMs) {
    problems.push(
      'The call timeout must not be shorter than the connect timeout.',
    );
  }

  if (!wholeAtLeast(config.failureThreshold, 2)) {
    problems.push(
      'The failure threshold must be at least 2, so one bad round is never an incident.',
    );
  }
  if (!wholeAtLeast(config.verificationRounds, 2)) {
    problems.push('At least 2 verification rounds are required.');
  }
  if (
    [
      config.healthyIntervalMs,
      config.confirmIntervalMs,
      config.verifyIntervalMs,
      config.minRoundSpacingMs,
      config.incidentBackoff.baseMs,
    ].some(ms => !wholeAtLeast(ms, 1_000))
  ) {
    problems.push('Intervals must be whole numbers of at least 1000 ms.');
  }
  if (
    !(config.incidentBackoff.factor >= 1) ||
    config.incidentBackoff.maxMs < config.incidentBackoff.baseMs
  ) {
    problems.push(
      'Incident backoff needs a factor of at least 1 and a maximum no smaller than its base.',
    );
  }
  if (
    !wholeAtLeast(config.recovery.maxAttemptsPerIncident, 1) ||
    !wholeAtLeast(config.recovery.cooldownMs, 1_000) ||
    !wholeAtLeast(config.recovery.settleMs, 0)
  ) {
    problems.push(
      'Recovery needs at least 1 attempt, a cooldown of at least 1000 ms and a non-negative settle time.',
    );
  }
  if (
    config.sessionDataBudgetBytes !== null &&
    !wholeAtLeast(config.sessionDataBudgetBytes, 1)
  ) {
    problems.push(
      'The session data budget must be a positive whole number of bytes, or null.',
    );
  }

  return problems;
}
