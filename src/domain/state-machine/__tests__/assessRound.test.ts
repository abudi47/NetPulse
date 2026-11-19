import type { NetworkSnapshot } from '../../models/network';
import type { ProbeOutcome, ProbeRound } from '../../models/probe';
import { assessRound as assessRoundFor } from '../assessRound';

/** Assesses a round whose endpoints are exactly the ones it reports on. */
function assessRound(probeRound: ProbeRound, network: NetworkSnapshot | null) {
  return assessRoundFor(
    probeRound,
    network,
    probeRound.results.map(result => result.endpointId),
  );
}

function round(
  outcomes: Partial<Record<string, ProbeOutcome>>,
  overrides: Partial<ProbeRound> = {},
): ProbeRound {
  return {
    hadNetwork: true,
    networkChanged: false,
    startedAtMs: 1_000,
    finishedAtMs: 1_400,
    bytesUsed: 2_048,
    results: Object.entries(outcomes).map(([endpointId, outcome], index) => ({
      endpointId,
      outcome: outcome as ProbeOutcome,
      httpStatus: outcome === 'success' ? 204 : null,
      durationMs: 100 * (index + 1),
    })),
    ...overrides,
  };
}

const network: NetworkSnapshot = {
  hasNetwork: true,
  transport: 'cellular',
  isVpn: false,
  validated: true,
  internetCapable: true,
  captivePortal: false,
  metered: true,
  capturedAtMs: 900,
  cause: 'snapshot',
};

describe('assessRound', () => {
  it('is reachable when every endpoint answers correctly', () => {
    const result = assessRound(
      round({ google: 'success', cloudflare: 'success' }),
      network,
    );

    expect(result).toEqual({
      verdict: 'reachable',
      failureKind: null,
      systemValidated: true,
      succeeded: 2,
      attempted: 2,
      failures: [],
      latencyMs: 100,
      finishedAtMs: 1_400,
      bytesUsed: 2_048,
    });
  });

  it('treats a single endpoint outage as partial, never as unreachable', () => {
    const result = assessRound(
      round({ google: 'timeout', cloudflare: 'success' }),
      network,
    );

    expect(result.verdict).toBe('partial');
    expect(result.failureKind).toBeNull();
    expect(result.failures).toEqual([
      {
        endpointId: 'google',
        outcome: 'timeout',
        httpStatus: null,
        durationMs: 100,
      },
    ]);
    expect(result.latencyMs).toBe(200);
  });

  it('reports the fastest successful probe as latency', () => {
    const result = assessRound(
      round({ a: 'success', b: 'success', c: 'success' }),
      network,
    );

    expect(result.latencyMs).toBe(100);
  });

  it.each([
    ['timeout', 'timeout'],
    ['dns_error', 'dns_failure'],
    ['tls_error', 'tls_failure'],
    ['unexpected_status', 'unexpected_response'],
    ['connect_error', 'connection_failure'],
    ['io_error', 'connection_failure'],
    ['redirect', 'captive_portal'],
  ] as const)(
    'is unreachable with a specific cause when every probe ends in %s',
    (outcome, failureKind) => {
      const result = assessRound(
        round({ google: outcome, cloudflare: outcome }),
        network,
      );

      expect(result.verdict).toBe('unreachable');
      expect(result.failureKind).toBe(failureKind);
      expect(result.succeeded).toBe(0);
      expect(result.latencyMs).toBeNull();
    },
  );

  it('does not claim a specific cause when the probes failed differently', () => {
    const result = assessRound(
      round({ google: 'timeout', cloudflare: 'dns_error' }),
      network,
    );

    expect(result.verdict).toBe('unreachable');
    expect(result.failureKind).toBe('mixed');
  });

  it('treats connect and other I/O errors as the same kind of failure', () => {
    expect(
      assessRound(round({ a: 'connect_error', b: 'io_error' }), network)
        .failureKind,
    ).toBe('connection_failure');
  });

  it('blames a captive portal when the system reports one', () => {
    const result = assessRound(
      round({ google: 'tls_error', cloudflare: 'timeout' }),
      { ...network, captivePortal: true, validated: false },
    );

    expect(result.failureKind).toBe('captive_portal');
    expect(result.systemValidated).toBe(false);
  });

  it('keeps the system verdict alongside its own, even when they disagree', () => {
    const result = assessRound(
      round({ google: 'timeout', cloudflare: 'timeout' }),
      { ...network, validated: true },
    );

    expect(result.verdict).toBe('unreachable');
    expect(result.systemValidated).toBe(true);
  });

  it('records the system verdict as unknown when there is no snapshot', () => {
    expect(
      assessRound(round({ google: 'success', cloudflare: 'success' }), null)
        .systemValidated,
    ).toBeNull();
  });

  it('reports no network when nothing could be sent', () => {
    const result = assessRound(
      round({}, { hadNetwork: false, bytesUsed: null }),
      null,
    );

    expect(result.verdict).toBe('no_network');
    expect(result.attempted).toBe(0);
    expect(result.bytesUsed).toBeNull();
  });

  it('is inconclusive when the network changed mid-round, whatever the results', () => {
    expect(
      assessRound(
        round(
          { google: 'timeout', cloudflare: 'timeout' },
          { networkChanged: true },
        ),
        network,
      ).verdict,
    ).toBe('inconclusive');
    expect(
      assessRound(
        round(
          { google: 'success', cloudflare: 'success' },
          { networkChanged: true },
        ),
        network,
      ).verdict,
    ).toBe('inconclusive');
  });

  it('is inconclusive when any probe was cancelled', () => {
    const result = assessRound(
      round({ google: 'success', cloudflare: 'cancelled' }),
      network,
    );

    expect(result.verdict).toBe('inconclusive');
    expect(result.failureKind).toBeNull();
  });

  it('is inconclusive when a round on a live network has no results', () => {
    expect(assessRound(round({}), network).verdict).toBe('inconclusive');
  });

  it('is inconclusive when an expected endpoint is missing from the results', () => {
    // Without this, one failing result could pass for "every endpoint failed".
    const result = assessRoundFor(round({ google: 'timeout' }), network, [
      'google',
      'cloudflare',
    ]);

    expect(result.verdict).toBe('inconclusive');
  });

  it('is inconclusive when the results name an endpoint that was not asked for', () => {
    const result = assessRoundFor(
      round({ google: 'success', stranger: 'success' }),
      network,
      ['google', 'cloudflare'],
    );

    expect(result.verdict).toBe('inconclusive');
  });

  it('still reports the data an inconclusive round used', () => {
    expect(
      assessRound(round({ google: 'cancelled' }, { bytesUsed: 512 }), network)
        .bytesUsed,
    ).toBe(512);
  });
});
