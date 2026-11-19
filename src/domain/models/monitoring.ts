/**
 * The monitoring / incident states defined in docs/PRODUCT_SPEC.md §8.
 *
 * This file only names the states. The rules for moving between them (failure
 * threshold, cooldown, recovery verification) belong to the state machine,
 * which is a later milestone.
 */
export const MONITORING_STATES = [
  /** Monitoring stopped. */
  'idle',
  /** Active network observation. */
  'monitoring',
  /** A diagnostic request is in progress. */
  'checking',
  /** Multiple valid probes succeeded. */
  'healthy',
  /** One or more failures, not yet confirmed. */
  'suspected_failure',
  /** Failure threshold reached. */
  'incident',
  /** An allowed recovery action is being attempted. */
  'recovering',
  /** Checking whether connectivity returned. */
  'verifying',
  /** Some endpoints work and some do not, or latency is poor. */
  'degraded',
  /** No active default network. */
  'no_network',
  /** Only a user-controlled system setting or action could help. */
  'needs_user_action',
  /** Waiting before another permitted attempt. */
  'cooldown',
] as const;

export type MonitoringState = (typeof MONITORING_STATES)[number];
