/** How the default network physically connects. */
export const NETWORK_TRANSPORTS = [
  'wifi',
  'cellular',
  'ethernet',
  'bluetooth',
  'vpn',
  'other',
] as const;

export type NetworkTransport = (typeof NETWORK_TRANSPORTS)[number];

/** Why a snapshot was produced. */
export const NETWORK_CHANGE_CAUSES = [
  /** A direct read, not a change. */
  'snapshot',
  /** A network became the default network. */
  'available',
  /** Same network, but something about it changed. */
  'capabilities_changed',
  /** The default network went away and nothing replaced it. */
  'lost',
] as const;

export type NetworkChangeCause = (typeof NETWORK_CHANGE_CAUSES)[number];

/**
 * The phone's default network at one moment, as the operating system reports
 * it. This is the system's view only: `validated` being true does not prove
 * that any particular server is reachable.
 *
 * `null` always means "not reported", never "false".
 */
export interface NetworkSnapshot {
  /** Whether a default network exists. */
  readonly hasNetwork: boolean;
  readonly transport: NetworkTransport | null;
  readonly isVpn: boolean | null;
  /** The system's own connectivity check passed. */
  readonly validated: boolean | null;
  /** The network is set up for internet access. */
  readonly internetCapable: boolean | null;
  /** The system detected a sign-in (captive portal) page. */
  readonly captivePortal: boolean | null;
  readonly metered: boolean | null;
  /** Unix epoch milliseconds at which the snapshot was captured. */
  readonly capturedAtMs: number;
  readonly cause: NetworkChangeCause;
}
