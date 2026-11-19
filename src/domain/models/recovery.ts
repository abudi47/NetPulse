/**
 * What happened when NetPulse asked the system to re-check the network.
 * Mirrors RecoveryOutcome in the Android code.
 */
export const RECOVERY_REQUEST_OUTCOMES = [
  /** The system was told the network appears to have no connectivity. A hint, nothing more. */
  'requested',
  /** There was no default network to report. */
  'no_network',
  /** The default network was no longer the one the failed checks ran on. */
  'network_changed',
  /** Native's own latest probe round did not show this network failing every check. */
  'not_confirmed',
  /** The system rejected the call. */
  'failed',
] as const;

export type RecoveryRequestOutcome = (typeof RECOVERY_REQUEST_OUTCOMES)[number];
