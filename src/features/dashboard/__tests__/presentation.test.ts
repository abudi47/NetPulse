import { MONITORING_STATES } from '../../../domain/models/monitoring';
import { measured, unavailable } from '../../../domain/models/reading';
import type { ProbeOutcome, ProbeResult } from '../../../domain/models/probe';
import {
  describeMonitoringState,
  describeProbeFailure,
  describeReading,
  monitoringControlLabel,
} from '../presentation';

describe('describeMonitoringState', () => {
  it.each(MONITORING_STATES)('has wording for "%s"', state => {
    const { title, description, tone } = describeMonitoringState(state);
    expect(title.length).toBeGreaterThan(0);
    expect(description.length).toBeGreaterThan(0);
    expect(['neutral', 'info', 'positive', 'caution', 'critical']).toContain(
      tone,
    );
  });

  it('gives every state a distinct title', () => {
    const titles = MONITORING_STATES.map(
      state => describeMonitoringState(state).title,
    );
    expect(new Set(titles).size).toBe(MONITORING_STATES.length);
  });

  it('shows a stopped monitor as neutral, not as healthy', () => {
    expect(describeMonitoringState('idle')).toMatchObject({
      title: 'Monitoring is off',
      tone: 'neutral',
    });
  });

  it('never words a recovery request as a guaranteed fix', () => {
    const { title, description } = describeMonitoringState('recovering');
    expect(`${title} ${description}`).not.toMatch(/fixing|repairing|restored/i);
    expect(description).toMatch(/not a guaranteed fix/i);
  });
});

describe('monitoringControlLabel', () => {
  it('offers Start only while monitoring is stopped', () => {
    expect(monitoringControlLabel('idle')).toBe('Start monitoring');
  });

  it.each(MONITORING_STATES.filter(state => state !== 'idle'))(
    'offers Stop in "%s"',
    state => {
      expect(monitoringControlLabel(state)).toBe('Stop monitoring');
    },
  );
});

describe('describeReading', () => {
  it('labels a value with no source as unavailable', () => {
    expect(describeReading(unavailable('source_not_connected'))).toEqual({
      text: 'Unavailable',
      isMeasured: false,
    });
  });

  it.each([
    ['source_error', 'Unavailable'],
    ['pending', 'Checking…'],
    ['not_measured_yet', 'Not measured yet'],
    ['not_reported', 'Not reported'],
    ['no_network', 'No network'],
  ] as const)('labels "%s" as "%s"', (reason, text) => {
    expect(describeReading(unavailable(reason))).toEqual({
      text,
      isMeasured: false,
    });
  });

  it('passes a measured value through unchanged', () => {
    expect(describeReading(measured('Wi-Fi', 1_700_000_000_000))).toEqual({
      text: 'Wi-Fi',
      isMeasured: true,
    });
  });
});

describe('describeProbeFailure', () => {
  const failure = (
    outcome: ProbeOutcome,
    httpStatus: number | null = null,
  ): ProbeResult => ({
    endpointId: 'cloudflare',
    outcome,
    httpStatus,
    durationMs: 1,
  });

  it.each([
    [failure('timeout'), 'cloudflare: timed out'],
    [failure('dns_error'), 'cloudflare: name lookup failed'],
    [failure('tls_error'), 'cloudflare: secure connection failed'],
    [failure('connect_error'), 'cloudflare: could not connect'],
    [failure('io_error'), 'cloudflare: connection dropped'],
    [failure('cancelled'), 'cloudflare: was cancelled'],
    [failure('redirect', 302), 'cloudflare: was redirected (302)'],
    [failure('redirect'), 'cloudflare: was redirected'],
    [
      failure('unexpected_status', 200),
      'cloudflare: answered 200, not the expected status',
    ],
  ])('describes %o as "%s"', (result, text) => {
    expect(describeProbeFailure(result)).toBe(text);
  });
});
