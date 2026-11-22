import type { MonitoringState } from '../../domain/models/monitoring';
import type { NetworkSnapshot } from '../../domain/models/network';
import {
  unavailable,
  type Reading,
  type UnavailableReason,
} from '../../domain/models/reading';
import { formatClockTime } from '../../shared/format';
import type { Tone } from '../../theme';
import type { MonitoringView } from '../monitoring/monitoringController';
import type { NetworkObservation } from '../monitoring/networkSnapshotStore';
import {
  describeActivity,
  describeSituation,
  diagnosticDataReading,
  internetHealthReading,
  lastSuccessReading,
  latencyReading,
  meteringReading,
  networkTypeReading,
  recoveryReading,
  validationReading,
} from './presentation';

/**
 * Whether the Start/Stop button can be used.
 *
 * The press handler only exists in the `available` case, so the UI cannot
 * offer a button that claims to start monitoring when nothing would run.
 */
export type MonitoringControl =
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'available'; readonly onPress: () => void };

export interface MonitoringStatus {
  readonly state: MonitoringState;
  readonly control: MonitoringControl;
  /**
   * A sentence about the current situation, shown instead of the state's
   * generic description. Null when the generic one says it all.
   */
  readonly detail: string | null;
  /** Limits the user should know about, e.g. checks being paused. */
  readonly notes: readonly string[];
  /**
   * A way for the user to act when only they can help: opening the system's
   * network settings. Null whenever that is not the situation.
   */
  readonly userAction: {
    readonly label: string;
    readonly onPress: () => void;
  } | null;
}

/** One labelled value on the dashboard, already formatted for display. */
export interface DashboardReading {
  readonly id: string;
  readonly label: string;
  readonly reading: Reading<string>;
}

export interface ConnectionSection {
  readonly readings: readonly DashboardReading[];
  /** Says at a glance whether the values are live. */
  readonly badge: { readonly label: string; readonly tone: Tone };
  /** A line under the readings that explains where they come from, if any. */
  readonly note: string | null;
}

/** One line of the activity timeline. */
export interface ActivityItem {
  readonly key: string;
  /** Local time of day, HH:MM:SS. */
  readonly time: string;
  readonly title: string;
  readonly detail: string | null;
  readonly tone: Tone;
}

/** Everything the dashboard screen needs to draw itself. */
export interface DashboardViewModel {
  readonly monitoring: MonitoringStatus;
  readonly connection: ConnectionSection;
  readonly recovery: DashboardReading;
  readonly diagnosticData: DashboardReading;
  /** Newest first. */
  readonly activity: readonly ActivityItem[];
}

export interface DashboardInputs {
  readonly network: NetworkObservation;
  readonly monitoring: MonitoringView;
  readonly onStartMonitoring: () => void;
  readonly onStopMonitoring: () => void;
  readonly onOpenNetworkSettings: () => void;
}

export const MONITORING_UNAVAILABLE_REASON =
  'Monitoring is not available in this build: the NetPulse native module is missing.';

export const FOREGROUND_ONLY_NOTE =
  'Checks run only while NetPulse is open. Background monitoring is not available yet.';

export const BUDGET_PAUSED_NOTE =
  "Health checks are paused: this session's diagnostic data budget is used up. Stop and start monitoring to continue.";

function monitoringStatus(inputs: DashboardInputs): MonitoringStatus {
  const { monitoring } = inputs;
  const { machine } = monitoring;

  if (!monitoring.available) {
    return {
      state: 'idle',
      control: { kind: 'unavailable', reason: MONITORING_UNAVAILABLE_REASON },
      detail: null,
      notes: [],
      userAction: null,
    };
  }

  const running = machine.phase !== 'idle';
  return {
    state: machine.phase,
    control: {
      kind: 'available',
      onPress: running ? inputs.onStopMonitoring : inputs.onStartMonitoring,
    },
    detail: describeSituation(machine),
    notes: [
      ...(machine.pausedBy === 'data_budget' ? [BUDGET_PAUSED_NOTE] : []),
      ...(running ? [FOREGROUND_ONLY_NOTE] : []),
    ],
    userAction:
      machine.phase === 'needs_user_action'
        ? {
            label: 'Open network settings',
            onPress: inputs.onOpenNetworkSettings,
          }
        : null,
  };
}

/** Readings Android supplies, or placeholders when it has supplied no snapshot. */
function systemReadings(
  snapshot: NetworkSnapshot | null,
  fallback: UnavailableReason,
): readonly DashboardReading[] {
  const reading = (from: (s: NetworkSnapshot) => Reading<string>) =>
    snapshot === null ? unavailable(fallback) : from(snapshot);

  return [
    {
      id: 'network_type',
      label: 'Network type',
      reading: reading(networkTypeReading),
    },
    {
      id: 'system_validation',
      label: 'Android validation',
      reading: reading(validationReading),
    },
    {
      id: 'metering',
      label: 'Data metering',
      reading: reading(meteringReading),
    },
  ];
}

/** Readings from NetPulse's own health checks. */
function probeReadings(
  monitoring: MonitoringView,
): readonly DashboardReading[] {
  const reading = (from: (m: MonitoringView['machine']) => Reading<string>) =>
    monitoring.available
      ? from(monitoring.machine)
      : unavailable('source_not_connected');

  return [
    {
      id: 'internet_health',
      label: 'Internet health',
      reading: reading(internetHealthReading),
    },
    { id: 'latency', label: 'Latency', reading: reading(latencyReading) },
    {
      id: 'last_successful_check',
      label: 'Last successful check',
      reading: reading(lastSuccessReading),
    },
  ];
}

const SYSTEM_NOTE =
  'Network type, validation and metering come from Android. They do not prove that any site is reachable.';
const PROBE_NOTE =
  "Internet health and latency come from NetPulse's own HTTPS checks. Latency is the fastest full check, not a ping.";

function connectionSection(inputs: DashboardInputs): ConnectionSection {
  const { network, monitoring } = inputs;
  const probes = probeReadings(monitoring);
  const monitoringOn = monitoring.machine.phase !== 'idle';

  switch (network.status) {
    case 'observing':
      return {
        readings: [...systemReadings(network.snapshot, 'pending'), ...probes],
        badge: { label: 'Live', tone: 'info' },
        note: monitoringOn ? `${SYSTEM_NOTE} ${PROBE_NOTE}` : SYSTEM_NOTE,
      };
    case 'starting':
    case 'idle':
      return {
        readings: [...systemReadings(null, 'pending'), ...probes],
        badge: { label: 'Connecting', tone: 'neutral' },
        note: null,
      };
    case 'error':
      return {
        readings: [...systemReadings(null, 'source_error'), ...probes],
        badge: { label: 'No live data', tone: 'caution' },
        note: 'NetPulse could not read the network state from Android.',
      };
    case 'unavailable':
      return {
        readings: [...systemReadings(null, 'source_not_connected'), ...probes],
        badge: { label: 'No live data', tone: 'neutral' },
        note: 'Network details are not available in this build.',
      };
  }
}

/**
 * Builds the dashboard from what is currently known. Pure: the same input
 * always gives the same output, and nothing here is estimated or invented.
 */
export function buildDashboard(inputs: DashboardInputs): DashboardViewModel {
  const { monitoring } = inputs;

  return {
    monitoring: monitoringStatus(inputs),
    connection: connectionSection(inputs),
    recovery: {
      id: 'last_recovery',
      label: 'Recovery',
      reading: monitoring.available
        ? recoveryReading(monitoring.machine)
        : unavailable('source_not_connected'),
    },
    diagnosticData: {
      id: 'diagnostic_data_session',
      label: 'Diagnostic data',
      reading: monitoring.available
        ? diagnosticDataReading(monitoring.machine)
        : unavailable('source_not_connected'),
    },
    activity: monitoring.activity.map((entry, index) => ({
      // Entries are only ever added at the front, so counting from the end
      // gives each one a key that stays the same as new ones arrive.
      key: `${monitoring.activity.length - index}-${entry.kind}-${entry.atMs}`,
      time: formatClockTime(entry.atMs),
      ...describeActivity(entry),
    })),
  };
}
