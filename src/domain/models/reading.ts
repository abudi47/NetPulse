/**
 * A value that can only be shown once it has really been measured.
 *
 * NetPulse must never display an invented ping, speed, or health figure. By
 * modelling every dashboard value as a `Reading`, the UI is forced to handle
 * the "no measurement" case explicitly, and a value cannot exist without the
 * time it was measured.
 */
export type Reading<T> =
  | { readonly kind: 'unavailable'; readonly reason: UnavailableReason }
  | {
      readonly kind: 'measured';
      readonly value: T;
      /** Unix epoch milliseconds at which the value was observed. */
      readonly measuredAtMs: number;
    };

export type UnavailableReason =
  /** The part of the app that produces this value is missing from this build. */
  | 'source_not_connected'
  /** The source exists but failed. */
  | 'source_error'
  /** The source has been asked and has not answered yet. */
  | 'pending'
  /** The source exists but has not produced a value so far. */
  | 'not_measured_yet'
  /** The source answered, but did not report this particular value. */
  | 'not_reported'
  /** The value describes a network, and there is no network. */
  | 'no_network'
  /** The value describes a response, and nothing responded. */
  | 'no_response'
  /** The value describes an event, and none has happened this session. */
  | 'none_yet';

export function unavailable(reason: UnavailableReason): Reading<never> {
  return { kind: 'unavailable', reason };
}

export function measured<T>(value: T, measuredAtMs: number): Reading<T> {
  return { kind: 'measured', value, measuredAtMs };
}
