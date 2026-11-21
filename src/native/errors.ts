export type NetPulseBridgeErrorCode =
  /** The native module is missing from this build or platform. */
  | 'unavailable'
  /** The native call itself failed. */
  | 'native_error'
  /** Native returned something that does not match the contract. */
  | 'invalid_payload';

/** The only error type the native bridge throws or rejects with. */
export class NetPulseBridgeError extends Error {
  readonly code: NetPulseBridgeErrorCode;

  constructor(code: NetPulseBridgeErrorCode, message: string) {
    super(message);
    this.name = 'NetPulseBridgeError';
    this.code = code;
  }
}

/** Wraps anything thrown by native code in a {@link NetPulseBridgeError}. */
export function toBridgeError(error: unknown): NetPulseBridgeError {
  if (error instanceof NetPulseBridgeError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new NetPulseBridgeError('native_error', detail);
}
