import type { NetworkSnapshot } from '../../../domain/models/network';
import type { RoundAssessment } from '../../../domain/state-machine/assessRound';
import {
  initialMachineState,
  type ActivityEntry,
  type MachineState,
  type OpenIncident,
} from '../../../domain/state-machine/monitorMachine';
import { formatClockTime } from '../../../shared/format';
import type { NetworkObservation } from '../../monitoring/networkSnapshotStore';
import {
  BUDGET_PAUSED_NOTE,
  buildDashboard,
  FOREGROUND_ONLY_NOTE,
  type DashboardViewModel,
} from '../dashboardViewModel';
import { describeReading } from '../presentation';

const wifi: NetworkSnapshot = {
  hasNetwork: true,
  transport: 'wifi',
  isVpn: false,
  validated: true,
  internetCapable: true,
  captivePortal: false,
  metered: false,
  capturedAtMs: 1_700_000_000_000,
  cause: 'snapshot',
};

function observing(
  overrides: Partial<NetworkSnapshot> = {},
): NetworkObservation {
  return { status: 'observing', snapshot: { ...wifi, ...overrides } };
}

const checkedAt = new Date(2026, 0, 5, 10, 42, 7).getTime();

function assessment(overrides: Partial<RoundAssessment> = {}): RoundAssessment {
  return {
    verdict: 'reachable',
    failureKind: null,
    systemValidated: true,
    succeeded: 2,
    attempted: 2,
    failures: [],
    latencyMs: 183.6,
    finishedAtMs: checkedAt,
    bytesUsed: 2_048,
    ...overrides,
  };
}

const incident: OpenIncident = {
  startedAtMs: checkedAt,
  confirmedAtMs: checkedAt + 20_000,
  failureKind: 'timeout',
  systemValidated: true,
  recoveryAttempts: 0,
  lastRecoveryAtMs: null,
  recoveryUnsupported: false,
  failedRoundsSinceConfirmed: 0,
};

/** A machine in the middle of a healthy monitoring session. */
const healthy: Partial<MachineState> = {
  phase: 'healthy',
  hasNetwork: true,
  lastAssessment: assessment(),
  lastReachableAtMs: checkedAt,
  lastRoundFinishedAtMs: checkedAt,
  roundsCompleted: 1,
  bytesUsed: 2_048,
};

function build(
  options: {
    network?: NetworkObservation;
    machine?: Partial<MachineState>;
    available?: boolean;
    activity?: readonly ActivityEntry[];
  } = {},
) {
  const onStartMonitoring = jest.fn();
  const onStopMonitoring = jest.fn();
  const onOpenNetworkSettings = jest.fn();
  const dashboard = buildDashboard({
    network: options.network ?? observing(),
    monitoring: {
      available: options.available ?? true,
      machine: { ...initialMachineState(), ...options.machine },
      activity: options.activity ?? [],
      suspended: false,
    },
    onStartMonitoring,
    onStopMonitoring,
    onOpenNetworkSettings,
  });
  return {
    dashboard,
    onStartMonitoring,
    onStopMonitoring,
    onOpenNetworkSettings,
  };
}

/** The text shown for each connection row, keyed by row id. */
function connectionText(dashboard: DashboardViewModel): Record<string, string> {
  return Object.fromEntries(
    dashboard.connection.readings.map(item => [
      item.id,
      describeReading(item.reading).text,
    ]),
  );
}

function press(dashboard: DashboardViewModel) {
  const { control } = dashboard.monitoring;
  if (control.kind !== 'available') {
    throw new Error('The monitoring control is not available');
  }
  control.onPress();
}

describe('buildDashboard: layout', () => {
  it('lists the connection values in a fixed order', () => {
    const ids = build().dashboard.connection.readings.map(r => r.id);

    expect(ids).toEqual([
      'network_type',
      'system_validation',
      'metering',
      'internet_health',
      'latency',
      'last_successful_check',
    ]);
  });
});

describe('buildDashboard: without the native module', () => {
  const { dashboard } = build({
    network: { status: 'unavailable' },
    available: false,
  });

  it('shows nothing measured', () => {
    const all = [
      ...dashboard.connection.readings,
      dashboard.recovery,
      dashboard.diagnosticData,
    ];
    for (const item of all) {
      expect(item.reading).toEqual({
        kind: 'unavailable',
        reason: 'source_not_connected',
      });
    }
    expect(dashboard.connection.badge.label).toBe('No live data');
  });

  it('offers no monitoring control, and says why', () => {
    expect(dashboard.monitoring.state).toBe('idle');
    expect(dashboard.monitoring.control.kind).toBe('unavailable');
    expect(dashboard.monitoring.control).not.toHaveProperty('onPress');
    expect(dashboard.monitoring.control).toMatchObject({
      reason: expect.stringMatching(/native module is missing/),
    });
  });
});

describe('buildDashboard: what Android reports', () => {
  it('shows a validated, unmetered Wi-Fi network', () => {
    const { dashboard } = build();

    expect(connectionText(dashboard)).toMatchObject({
      network_type: 'Wi-Fi',
      system_validation: 'Validated',
      metering: 'Unmetered',
    });
    expect(dashboard.connection.badge).toEqual({ label: 'Live', tone: 'info' });
  });

  it('stamps system readings with the time Android reported them', () => {
    const [networkType] = build().dashboard.connection.readings;

    expect(networkType.reading).toEqual({
      kind: 'measured',
      value: 'Wi-Fi',
      measuredAtMs: wifi.capturedAtMs,
    });
  });

  it('shows metered mobile data that Android has not validated', () => {
    const { dashboard } = build({
      network: observing({
        transport: 'cellular',
        validated: false,
        metered: true,
      }),
    });

    expect(connectionText(dashboard)).toMatchObject({
      network_type: 'Mobile data',
      system_validation: 'Not validated',
      metering: 'Metered',
    });
  });

  it('mentions a VPN alongside the underlying transport', () => {
    expect(
      connectionText(build({ network: observing({ isVpn: true }) }).dashboard)
        .network_type,
    ).toBe('Wi-Fi via VPN');
    expect(
      connectionText(
        build({ network: observing({ transport: 'vpn', isVpn: true }) })
          .dashboard,
      ).network_type,
    ).toBe('VPN');
  });

  it('shows a captive portal as needing sign-in rather than as validated', () => {
    const { dashboard } = build({
      network: observing({ captivePortal: true, validated: false }),
    });

    expect(connectionText(dashboard).system_validation).toBe(
      'Sign-in required',
    );
  });

  it('reports no network as an observation, with the other values not applicable', () => {
    const { dashboard } = build({
      network: observing({
        hasNetwork: false,
        transport: null,
        isVpn: null,
        validated: null,
        internetCapable: null,
        captivePortal: null,
        metered: null,
        cause: 'lost',
      }),
    });

    expect(connectionText(dashboard)).toMatchObject({
      network_type: 'No network',
      system_validation: 'No network',
      metering: 'No network',
    });
    expect(dashboard.connection.readings[0].reading.kind).toBe('measured');
    expect(dashboard.connection.readings[1].reading.kind).toBe('unavailable');
  });

  it('says "not reported" for facts Android left out, instead of guessing', () => {
    const { dashboard } = build({
      network: observing({ transport: null, validated: null, metered: null }),
    });

    expect(connectionText(dashboard)).toMatchObject({
      network_type: 'Not reported',
      system_validation: 'Not reported',
      metering: 'Not reported',
    });
  });

  it.each<NetworkObservation>([{ status: 'starting' }, { status: 'idle' }])(
    'shows system readings as pending while $status',
    network => {
      const { dashboard } = build({ network });

      expect(connectionText(dashboard)).toMatchObject({
        network_type: 'Checking…',
        system_validation: 'Checking…',
        metering: 'Checking…',
      });
      expect(dashboard.connection.note).toBeNull();
    },
  );

  it('explains a read failure without showing values', () => {
    const { dashboard } = build({
      network: { status: 'error', message: 'native_error' },
    });

    expect(connectionText(dashboard).network_type).toBe('Unavailable');
    expect(dashboard.connection.badge.tone).toBe('caution');
    expect(dashboard.connection.note).toMatch(/could not read/i);
  });

  it('warns that Android validation is not proof of reachability', () => {
    expect(build().dashboard.connection.note).toMatch(
      /do not prove that any site is reachable/i,
    );
  });
});

describe('buildDashboard: monitoring off', () => {
  it('offers Start, which starts monitoring', () => {
    const { dashboard, onStartMonitoring, onStopMonitoring } = build();

    expect(dashboard.monitoring.state).toBe('idle');
    press(dashboard);

    expect(onStartMonitoring).toHaveBeenCalledTimes(1);
    expect(onStopMonitoring).not.toHaveBeenCalled();
  });

  it('shows probe-based values as not measured, and no notes', () => {
    const { dashboard } = build();

    expect(connectionText(dashboard)).toMatchObject({
      internet_health: 'Not measured yet',
      latency: 'Not measured yet',
      last_successful_check: 'Not measured yet',
    });
    expect(describeReading(dashboard.diagnosticData.reading).text).toBe(
      'Not measured yet',
    );
    expect(dashboard.monitoring.notes).toEqual([]);
    expect(dashboard.monitoring.detail).toBeNull();
  });
});

describe('buildDashboard: monitoring on', () => {
  it('offers Stop, which stops monitoring', () => {
    const { dashboard, onStartMonitoring, onStopMonitoring } = build({
      machine: healthy,
    });

    press(dashboard);

    expect(onStopMonitoring).toHaveBeenCalledTimes(1);
    expect(onStartMonitoring).not.toHaveBeenCalled();
  });

  it('says plainly that checks only run while the app is open', () => {
    const { dashboard } = build({ machine: healthy });

    expect(dashboard.monitoring.notes).toEqual([FOREGROUND_ONLY_NOTE]);
    expect(FOREGROUND_ONLY_NOTE).toMatch(
      /Background monitoring is not available/,
    );
  });

  it('shows the first check as pending rather than as a result', () => {
    const { dashboard } = build({
      machine: { phase: 'checking', hasNetwork: true, roundInFlight: true },
    });

    expect(connectionText(dashboard)).toMatchObject({
      internet_health: 'Checking…',
      latency: 'Checking…',
      last_successful_check: 'Checking…',
    });
    expect(describeReading(dashboard.diagnosticData.reading).text).toBe(
      'Checking…',
    );
  });

  it('shows a healthy round: measured latency, time and data use', () => {
    const { dashboard } = build({ machine: healthy });

    expect(dashboard.monitoring.state).toBe('healthy');
    expect(connectionText(dashboard)).toMatchObject({
      internet_health: 'Reachable',
      latency: '184 ms',
      last_successful_check: '10:42:07',
    });
    expect(dashboard.diagnosticData.reading).toEqual({
      kind: 'measured',
      value: '≈ 2.0 KB',
      measuredAtMs: checkedAt,
    });
    expect(dashboard.connection.note).toMatch(/not a ping/);
  });

  it('shows one failing endpoint as partly reachable, not as an outage', () => {
    const { dashboard } = build({
      machine: {
        ...healthy,
        phase: 'degraded',
        lastAssessment: assessment({
          verdict: 'partial',
          succeeded: 1,
          failures: [
            {
              endpointId: 'cloudflare',
              outcome: 'timeout',
              httpStatus: null,
              durationMs: 5_000,
            },
          ],
        }),
      },
    });

    expect(connectionText(dashboard).internet_health).toBe(
      'Partly reachable (1 of 2 checks failed)',
    );
    expect(dashboard.monitoring.detail).toBe(
      '1 of 2 health checks failed (cloudflare: timed out). The internet is still reachable.',
    );
  });

  it('shows an outage with its cause and what Android says, and no latency', () => {
    const { dashboard } = build({
      machine: {
        ...healthy,
        phase: 'incident',
        incident,
        lastAssessment: assessment({
          verdict: 'unreachable',
          failureKind: 'timeout',
          succeeded: 0,
          latencyMs: null,
        }),
      },
    });

    expect(connectionText(dashboard)).toMatchObject({
      internet_health: 'Unreachable',
      latency: 'No response',
      last_successful_check: '10:42:07',
    });
    expect(dashboard.monitoring.detail).toBe(
      'Health checks timed out. Android still reports this network as validated. Unreachable since 10:42:07.',
    );
  });

  it('notes when Android agrees the network is not validated', () => {
    const { dashboard } = build({
      machine: {
        ...healthy,
        phase: 'incident',
        incident: {
          ...incident,
          failureKind: 'dns_failure',
          systemValidated: false,
        },
      },
    });

    expect(dashboard.monitoring.detail).toMatch(
      /^Server names could not be looked up \(DNS\)\. Android also reports this network as not validated\./,
    );
  });

  it('does not comment on Android validation when it is unknown', () => {
    const { dashboard } = build({
      machine: {
        ...healthy,
        phase: 'incident',
        incident: { ...incident, systemValidated: null },
      },
    });

    expect(dashboard.monitoring.detail).toBe(
      'Health checks timed out. Unreachable since 10:42:07.',
    );
  });

  it('tells the user to sign in when a captive portal is in the way', () => {
    const { dashboard } = build({
      machine: {
        ...healthy,
        phase: 'needs_user_action',
        incident: {
          ...incident,
          failureKind: 'captive_portal',
          systemValidated: false,
        },
      },
    });

    expect(dashboard.monitoring.detail).toMatch(
      /Sign in to this network to get online\.$/,
    );
  });

  it('never suggests NetPulse can toggle Airplane Mode itself', () => {
    const { dashboard } = build({
      machine: {
        ...healthy,
        phase: 'needs_user_action',
        incident: { ...incident, recoveryAttempts: 3 },
      },
    });

    expect(dashboard.monitoring.detail).toMatch(
      /Turning mobile data or Airplane Mode off and on yourself may help\.$/,
    );
  });

  it('reports verification progress while an outage is being confirmed over', () => {
    const { dashboard } = build({
      machine: {
        ...healthy,
        phase: 'verifying',
        incident,
        consecutiveReachableRounds: 2,
      },
    });

    expect(dashboard.monitoring.detail).toBe(
      'The internet is answering again. 2 good checks in a row so far.',
    );
  });

  it('shows probe values as not applicable when there is no network', () => {
    const { dashboard } = build({
      machine: { phase: 'no_network', hasNetwork: false },
    });

    expect(connectionText(dashboard)).toMatchObject({
      internet_health: 'No network',
      latency: 'No network',
      last_successful_check: 'No network',
    });
  });

  it('says so when checks are paused by the data budget', () => {
    const { dashboard } = build({
      machine: {
        phase: 'monitoring',
        hasNetwork: true,
        pausedBy: 'data_budget',
        roundsCompleted: 40,
        bytesUsed: 5_300_000,
        lastRoundFinishedAtMs: checkedAt,
      },
    });

    expect(dashboard.monitoring.notes).toEqual([
      BUDGET_PAUSED_NOTE,
      FOREGROUND_ONLY_NOTE,
    ]);
    expect(connectionText(dashboard).internet_health).toBe('Not measured yet');
    expect(describeReading(dashboard.diagnosticData.reading).text).toBe(
      '≈ 5.1 MB',
    );
  });

  it('does not invent a data figure when the device reported none', () => {
    const { dashboard } = build({
      machine: {
        ...healthy,
        bytesUsed: 0,
        roundsCompleted: 4,
        roundsWithUnknownBytes: 4,
      },
    });

    expect(dashboard.diagnosticData.reading).toEqual({
      kind: 'unavailable',
      reason: 'not_reported',
    });
  });

  it('says no recovery request has been made, rather than showing nothing', () => {
    const { dashboard } = build({ machine: healthy });

    expect(dashboard.recovery.reading).toEqual({
      kind: 'unavailable',
      reason: 'none_yet',
    });
    expect(describeReading(dashboard.recovery.reading).text).toBe('None yet');
  });

  it.each([
    ['verifying', null, 'Requested 10:42:07, checking the result'],
    ['restored', checkedAt + 20_000, 'Requested 10:42:07, connection back'],
    [
      'not_restored',
      checkedAt + 6_000,
      'Requested 10:42:07, still unreachable',
    ],
  ] as const)(
    'shows a recovery request that is %s',
    (result, resolvedAtMs, text) => {
      const { dashboard } = build({
        machine: {
          ...healthy,
          lastRecovery: {
            requestedAtMs: checkedAt,
            attempt: 1,
            result,
            resolvedAtMs,
          },
        },
      });

      expect(dashboard.recovery.reading).toEqual({
        kind: 'measured',
        value: text,
        measuredAtMs: resolvedAtMs ?? checkedAt,
      });
    },
  );

  it('never words a recovery result as a fix', () => {
    const texts = (['verifying', 'restored', 'not_restored'] as const).map(
      result =>
        describeReading(
          build({
            machine: {
              ...healthy,
              lastRecovery: {
                requestedAtMs: checkedAt,
                attempt: 1,
                result,
                resolvedAtMs: null,
              },
            },
          }).dashboard.recovery.reading,
        ).text,
    );

    expect(texts.join(' ')).not.toMatch(/fixed|repaired|reset|recovered/i);
  });

  it('offers network settings only when the user has to act', () => {
    const needsAction = build({
      machine: {
        ...healthy,
        phase: 'needs_user_action',
        incident: { ...incident, recoveryAttempts: 3 },
      },
    });

    expect(needsAction.dashboard.monitoring.userAction?.label).toBe(
      'Open network settings',
    );
    needsAction.dashboard.monitoring.userAction?.onPress();
    expect(needsAction.onOpenNetworkSettings).toHaveBeenCalledTimes(1);

    for (const phase of [
      'healthy',
      'incident',
      'recovering',
      'cooldown',
    ] as const) {
      expect(
        build({ machine: { ...healthy, phase, incident } }).dashboard.monitoring
          .userAction,
      ).toBeNull();
    }
    expect(build().dashboard.monitoring.userAction).toBeNull();
  });
});

describe('buildDashboard: activity', () => {
  const activity: ActivityEntry[] = [
    {
      kind: 'incident_restored',
      atMs: checkedAt + 185_000,
      durationMs: 185_000,
      recoveryAttempts: 0,
    },
    {
      kind: 'incident_started',
      atMs: checkedAt + 20_000,
      failureKind: 'timeout',
      systemValidated: true,
    },
    { kind: 'monitoring_started', atMs: checkedAt },
  ];

  it('is empty when nothing has happened', () => {
    expect(build().dashboard.activity).toEqual([]);
  });

  it('describes each entry with its local time, newest first', () => {
    const items = build({ activity }).dashboard.activity;

    expect(items.map(item => [item.time, item.title, item.detail])).toEqual([
      [
        formatClockTime(checkedAt + 185_000),
        'Connection restored',
        'Unreachable for 3 min 5 s. No re-check was requested.',
      ],
      [
        formatClockTime(checkedAt + 20_000),
        'Internet unreachable',
        'Health checks timed out. Android still reports this network as validated.',
      ],
      ['10:42:07', 'Monitoring started', null],
    ]);
    expect(items.map(item => item.tone)).toEqual([
      'positive',
      'critical',
      'info',
    ]);
  });

  it('gives entries keys that are unique and stay put as new ones arrive', () => {
    const before = build({ activity }).dashboard.activity;
    const after = build({
      activity: [
        { kind: 'network_lost', atMs: checkedAt + 200_000 },
        ...activity,
      ],
    }).dashboard.activity;

    expect(new Set(after.map(item => item.key)).size).toBe(after.length);
    expect(after.slice(1).map(item => item.key)).toEqual(
      before.map(item => item.key),
    );
  });

  it.each<[ActivityEntry, string, RegExp | null]>([
    [{ kind: 'network_lost', atMs: 0 }, 'Network lost', null],
    [{ kind: 'network_available', atMs: 0 }, 'Network available', null],
    [
      {
        kind: 'monitoring_stopped',
        atMs: 0,
        bytesUsed: 14_336,
        roundsCompleted: 7,
      },
      'Monitoring stopped',
      /^7 health checks run, about 14\.0 KB of data used\.$/,
    ],
    [
      {
        kind: 'monitoring_stopped',
        atMs: 0,
        bytesUsed: 2_048,
        roundsCompleted: 1,
      },
      'Monitoring stopped',
      /^1 health check run,/,
    ],
    [
      { kind: 'monitoring_stopped', atMs: 0, bytesUsed: 0, roundsCompleted: 0 },
      'Monitoring stopped',
      /^No health checks were run\.$/,
    ],
    [
      { kind: 'recovery_requested', atMs: 0, attempt: 2 },
      'Asked Android to re-check the network',
      /^Request 2 for this outage, made with Android's reportNetworkConnectivity\. It is a request, not a guaranteed fix\.$/,
    ],
    [
      { kind: 'recovery_not_effective', atMs: 0, attempt: 2 },
      'Still unreachable after the request',
      /^The check that followed request 2 failed\.$/,
    ],
    [
      { kind: 'needs_user_action', atMs: 0, reason: 'captive_portal' },
      'Your action is needed',
      /Sign in to this network/,
    ],
    [
      {
        kind: 'incident_restored',
        atMs: 0,
        durationMs: 42_000,
        recoveryAttempts: 2,
      },
      'Connection restored',
      /^Unreachable for 42 s\. Re-check requests sent: 2\.$/,
    ],
    [
      { kind: 'data_budget_reached', atMs: 0 },
      'Health checks paused',
      /data budget is used up/,
    ],
  ])('describes %o', (entry, title, detail) => {
    const [item] = build({ activity: [entry] }).dashboard.activity;

    expect(item.title).toBe(title);
    if (detail === null) {
      expect(item.detail).toBeNull();
    } else {
      expect(item.detail).toMatch(detail);
    }
  });
});
