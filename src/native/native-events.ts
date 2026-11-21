import {
  NETWORK_CHANGE_CAUSES,
  NETWORK_TRANSPORTS,
  type NetworkChangeCause,
  type NetworkSnapshot,
  type NetworkTransport,
} from '../domain/models/network';
import {
  PROBE_OUTCOMES,
  type ProbeOutcome,
  type ProbeResult,
  type ProbeRound,
} from '../domain/models/probe';
import {
  RECOVERY_REQUEST_OUTCOMES,
  type RecoveryRequestOutcome,
} from '../domain/models/recovery';
import { NetPulseBridgeError } from './errors';

/*
 * Validation of what the native module sends.
 *
 * TypeScript's types say what native *should* send; these functions check
 * what it actually sent. A missing or malformed optional fact becomes `null`
 * (unknown). A payload that cannot be trusted at all is rejected.
 */

function invalid(message: string): NetPulseBridgeError {
  return new NetPulseBridgeError('invalid_payload', message);
}

function booleanOrUnknown(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function isOneOf<T extends string>(
  options: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

/**
 * Converts a native network payload into a {@link NetworkSnapshot}.
 *
 * @throws NetPulseBridgeError (`invalid_payload`) when the payload is not an
 * object, or lacks a boolean `hasNetwork`, a finite `capturedAtMs`, or a
 * known `cause`. Those three define what the snapshot means, so guessing them
 * would risk showing something untrue.
 */
export function parseNetworkSnapshot(payload: unknown): NetworkSnapshot {
  if (typeof payload !== 'object' || payload === null) {
    throw invalid('Network snapshot is not an object.');
  }
  const raw = payload as Record<string, unknown>;

  if (typeof raw.hasNetwork !== 'boolean') {
    throw invalid('Network snapshot has no boolean "hasNetwork".');
  }
  if (
    typeof raw.capturedAtMs !== 'number' ||
    !Number.isFinite(raw.capturedAtMs)
  ) {
    throw invalid('Network snapshot has no finite "capturedAtMs".');
  }
  if (!isOneOf<NetworkChangeCause>(NETWORK_CHANGE_CAUSES, raw.cause)) {
    throw invalid('Network snapshot has an unknown "cause".');
  }

  if (!raw.hasNetwork) {
    // Without a network there is nothing to describe; ignore any stray facts.
    return {
      hasNetwork: false,
      transport: null,
      isVpn: null,
      validated: null,
      internetCapable: null,
      captivePortal: null,
      metered: null,
      capturedAtMs: raw.capturedAtMs,
      cause: raw.cause,
    };
  }

  let transport: NetworkTransport | null = null;
  if (isOneOf<NetworkTransport>(NETWORK_TRANSPORTS, raw.transport)) {
    transport = raw.transport;
  } else if (typeof raw.transport === 'string') {
    // A transport this version of the app does not know by name.
    transport = 'other';
  }

  return {
    hasNetwork: true,
    transport,
    isVpn: booleanOrUnknown(raw.isVpn),
    validated: booleanOrUnknown(raw.validated),
    internetCapable: booleanOrUnknown(raw.internetCapable),
    captivePortal: booleanOrUnknown(raw.captivePortal),
    metered: booleanOrUnknown(raw.metered),
    capturedAtMs: raw.capturedAtMs,
    cause: raw.cause,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseProbeResult(payload: unknown, index: number): ProbeResult {
  if (typeof payload !== 'object' || payload === null) {
    throw invalid(`Probe result ${index} is not an object.`);
  }
  const raw = payload as Record<string, unknown>;

  if (typeof raw.endpointId !== 'string' || raw.endpointId === '') {
    throw invalid(`Probe result ${index} has no "endpointId".`);
  }
  if (!isOneOf<ProbeOutcome>(PROBE_OUTCOMES, raw.outcome)) {
    throw invalid(`Probe result ${index} has an unknown "outcome".`);
  }
  if (!isFiniteNumber(raw.durationMs) || raw.durationMs < 0) {
    throw invalid(`Probe result ${index} has no valid "durationMs".`);
  }
  return {
    endpointId: raw.endpointId,
    outcome: raw.outcome,
    httpStatus: isFiniteNumber(raw.httpStatus) ? raw.httpStatus : null,
    durationMs: raw.durationMs,
  };
}

/**
 * Converts a native probe-round payload into a {@link ProbeRound}.
 *
 * @throws NetPulseBridgeError (`invalid_payload`) for anything that would
 * change what the round means: a missing flag or timestamp, a results list
 * that is not a list, or a result with no endpoint, outcome or duration.
 * A missing or nonsensical byte count only becomes `null` (not reported).
 */
export function parseProbeRound(payload: unknown): ProbeRound {
  if (typeof payload !== 'object' || payload === null) {
    throw invalid('Probe round is not an object.');
  }
  const raw = payload as Record<string, unknown>;

  if (typeof raw.hadNetwork !== 'boolean') {
    throw invalid('Probe round has no boolean "hadNetwork".');
  }
  if (typeof raw.networkChanged !== 'boolean') {
    throw invalid('Probe round has no boolean "networkChanged".');
  }
  if (!isFiniteNumber(raw.startedAtMs) || !isFiniteNumber(raw.finishedAtMs)) {
    throw invalid('Probe round has no valid timestamps.');
  }
  if (!Array.isArray(raw.results)) {
    throw invalid('Probe round has no "results" list.');
  }

  return {
    hadNetwork: raw.hadNetwork,
    networkChanged: raw.networkChanged,
    startedAtMs: raw.startedAtMs,
    finishedAtMs: raw.finishedAtMs,
    results: raw.results.map(parseProbeResult),
    bytesUsed:
      isFiniteNumber(raw.bytesUsed) && raw.bytesUsed >= 0
        ? raw.bytesUsed
        : null,
  };
}

/**
 * Reads the outcome of a recovery request.
 *
 * @throws NetPulseBridgeError (`invalid_payload`) if the outcome is missing
 * or unknown. Guessing here could record a request that was never made.
 */
export function parseRecoveryOutcome(payload: unknown): RecoveryRequestOutcome {
  const outcome =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>).outcome
      : undefined;
  if (!isOneOf<RecoveryRequestOutcome>(RECOVERY_REQUEST_OUTCOMES, outcome)) {
    throw invalid('Recovery result has an unknown "outcome".');
  }
  return outcome;
}
