import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * The contract between TypeScript and the Android NetPulse module.
 *
 * React Native's Codegen reads this file at build time and generates the
 * Kotlin-facing base class `com.netpulse.NativeNetPulseSpec`, which
 * `NetPulseModule.kt` implements. Changing anything here requires rebuilding
 * the Android app.
 *
 * App code must not import this file directly. Use `src/native/NetPulseNative.ts`,
 * which validates what native sends and copes with the module being absent.
 *
 * Contract version 3 (1: network snapshot; 2: health probes; 3: recovery).
 */

/**
 * The phone's default network at one moment, as Android reports it.
 * `null` always means "Android has not told us", never "false".
 */
export type NativeNetworkSnapshot = {
  /** Whether a default network exists right now. */
  hasNetwork: boolean;
  /** 'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'vpn' | 'other' */
  transport: string | null;
  /** Whether traffic goes through a VPN. */
  isVpn: boolean | null;
  /** Android's NET_CAPABILITY_VALIDATED: its own connectivity check passed. */
  validated: boolean | null;
  /** Android's NET_CAPABILITY_INTERNET: the network is set up for internet. */
  internetCapable: boolean | null;
  /** Android's NET_CAPABILITY_CAPTIVE_PORTAL: a sign-in page was detected. */
  captivePortal: boolean | null;
  /** True unless Android marks the network NET_CAPABILITY_NOT_METERED. */
  metered: boolean | null;
  /** Unix epoch milliseconds at which native captured this snapshot. */
  capturedAtMs: number;
  /** 'snapshot' | 'available' | 'capabilities_changed' | 'lost' */
  cause: string;
};

/** One place to ask "is the internet reachable?". */
export type NativeProbeEndpoint = {
  /** Short stable name used to match results to endpoints. */
  id: string;
  /** Must be an https:// URL. */
  url: string;
  /** The exact HTTP status that counts as success (200-299). */
  expectedStatus: number;
};

/** Hard time limits for each probe, in milliseconds (500-15000). */
export type NativeProbeTimeouts = {
  connectTimeoutMs: number;
  readTimeoutMs: number;
  /** Bounds the whole probe, DNS lookup included. */
  callTimeoutMs: number;
};

export type NativeProbeResult = {
  endpointId: string;
  /**
   * 'success' | 'unexpected_status' | 'redirect' | 'timeout' | 'dns_error' |
   * 'tls_error' | 'connect_error' | 'io_error' | 'cancelled'
   */
  outcome: string;
  /** The HTTP status, when the endpoint answered at all. */
  httpStatus: number | null;
  /** Milliseconds from starting the probe to its outcome, DNS and TLS included. */
  durationMs: number;
};

export type NativeProbeRound = {
  /** False when there was no default network; nothing was sent. */
  hadNetwork: boolean;
  /** True when the default network changed while probing. */
  networkChanged: boolean;
  startedAtMs: number;
  finishedAtMs: number;
  /** One entry per endpoint, in the order given. Empty when `hadNetwork` is false. */
  results: Array<NativeProbeResult>;
  /**
   * Bytes Android counted for the app during the round (sent + received), or
   * null when the device does not report it. Approximate.
   */
  bytesUsed: number | null;
};

export type NativeRecoveryResult = {
  /**
   * 'requested' | 'no_network' | 'network_changed' | 'not_confirmed' | 'failed'
   */
  outcome: string;
};

export interface Spec extends TurboModule {
  /** Reads the current default network once. Does not start observing. */
  getSnapshot(): Promise<NativeNetworkSnapshot>;

  /**
   * Starts watching the default network and resolves with its current state.
   * Calling it again while already observing registers nothing new.
   */
  startObserving(): Promise<NativeNetworkSnapshot>;

  /** Stops watching and unregisters from Android. Safe to call when stopped. */
  stopObserving(): Promise<void>;

  /**
   * Sends one small HTTPS request to each endpoint (1-5) on the current
   * default network and resolves when every one has an outcome. Redirects are
   * not followed and response bodies are not downloaded.
   *
   * Rejects with code `E_PROBE_CONFIG` for invalid arguments and
   * `E_PROBE_BUSY` if a round is already running.
   */
  runProbeRound(
    endpoints: Array<NativeProbeEndpoint>,
    timeouts: NativeProbeTimeouts,
  ): Promise<NativeProbeRound>;

  /** Cancels the round in flight, if any. It still resolves, marked cancelled. */
  cancelProbeRound(): void;

  /**
   * Tells Android that the network the latest probe round ran on appears to
   * have no connectivity (`ConnectivityManager.reportNetworkConnectivity`).
   * A hint only: Android may re-check the network and may act on the result.
   *
   * Native refuses ('not_confirmed', 'network_changed', 'no_network') unless
   * its own latest round, on the network that is still the default, failed
   * every check. Always resolves; 'failed' means Android rejected the call.
   */
  requestNetworkReevaluation(): Promise<NativeRecoveryResult>;

  /**
   * Opens Android's network settings so the user can act themselves.
   * Resolves false if the device has no such screen.
   */
  openNetworkSettings(): Promise<boolean>;

  /** Fires while observing, whenever something this snapshot reports changes. */
  readonly onNetworkChanged: CodegenTypes.EventEmitter<NativeNetworkSnapshot>;
}

// `get` (not `getEnforcing`) returns null when the native module is missing,
// e.g. under Jest, so callers can degrade instead of crashing at import time.
export default TurboModuleRegistry.get<Spec>('NativeNetPulse');
