/** What happened to one health probe. Mirrors ProbeOutcome in the Android code. */
export const PROBE_OUTCOMES = [
  /** The endpoint answered with exactly the expected status. */
  'success',
  /** It answered, but with a different status (e.g. a sign-in page's 200). */
  'unexpected_status',
  /** It answered with a redirect. Probes never follow redirects. */
  'redirect',
  /** No answer within the time limit. */
  'timeout',
  /** The host name could not be resolved. */
  'dns_error',
  /** The secure connection could not be established or verified. */
  'tls_error',
  /** The server could not be reached at the network level. */
  'connect_error',
  /** Some other failure while sending or receiving. */
  'io_error',
  /** The probe was cancelled before it finished. */
  'cancelled',
] as const;

export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

/** One place to ask "is the internet reachable?". */
export interface ProbeEndpoint {
  /** Short stable name used to match results to endpoints. */
  readonly id: string;
  /** Must be an https:// URL. */
  readonly url: string;
  /** The exact HTTP status that counts as success. */
  readonly expectedStatus: number;
}

/** Hard time limits for each probe, in milliseconds. */
export interface ProbeTimeouts {
  readonly connectTimeoutMs: number;
  readonly readTimeoutMs: number;
  /** Bounds the whole probe, DNS lookup included. */
  readonly callTimeoutMs: number;
}

export interface ProbeResult {
  readonly endpointId: string;
  readonly outcome: ProbeOutcome;
  /** The HTTP status, when the endpoint answered at all. */
  readonly httpStatus: number | null;
  /** Milliseconds from starting the probe to its outcome, DNS and TLS included. */
  readonly durationMs: number;
}

/** The result of probing every endpoint once. */
export interface ProbeRound {
  /** False when there was no default network; nothing was sent. */
  readonly hadNetwork: boolean;
  /** True when the default network changed while probing. */
  readonly networkChanged: boolean;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly results: readonly ProbeResult[];
  /**
   * Bytes the system counted for the app during the round (sent + received),
   * or null when the device does not report it. Approximate.
   */
  readonly bytesUsed: number | null;
}
