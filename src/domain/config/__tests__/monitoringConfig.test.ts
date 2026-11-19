import {
  DEFAULT_MONITORING_CONFIG as defaults,
  findConfigProblems,
  type MonitoringConfig,
} from '../monitoringConfig';

function problemsWith(overrides: Partial<MonitoringConfig>): string {
  return findConfigProblems({ ...defaults, ...overrides }).join(' | ');
}

describe('the default configuration', () => {
  it('is valid', () => {
    expect(findConfigProblems(defaults)).toEqual([]);
  });

  it('matches the starting values in the product spec', () => {
    expect(defaults.failureThreshold).toBe(3);
    expect(defaults.verificationRounds).toBe(3);
    expect(defaults.healthyIntervalMs).toBe(60_000);
    expect(defaults.recovery.cooldownMs).toBe(60_000);
    expect(defaults.recovery.maxAttemptsPerIncident).toBe(3);
    expect(defaults.timeouts.callTimeoutMs).toBeGreaterThanOrEqual(4_000);
    expect(defaults.timeouts.callTimeoutMs).toBeLessThanOrEqual(5_000);
  });

  it('probes at least two HTTPS endpoints on different hosts', () => {
    const hosts = defaults.endpoints.map(e => new URL(e.url).host);

    expect(defaults.endpoints.length).toBeGreaterThanOrEqual(2);
    expect(new Set(hosts).size).toBe(hosts.length);
    expect(defaults.endpoints.every(e => e.url.startsWith('https://'))).toBe(
      true,
    );
  });

  it('limits recovery requests to a few per incident, spaced apart', () => {
    expect(defaults.recovery.enabled).toBe(true);
    expect(defaults.recovery.maxAttemptsPerIncident).toBeLessThanOrEqual(3);
    expect(defaults.recovery.cooldownMs).toBeGreaterThanOrEqual(60_000);
  });
});

describe('findConfigProblems', () => {
  const [first, second] = defaults.endpoints;

  it('requires at least two endpoints, so one outage cannot look like an incident', () => {
    expect(problemsWith({ endpoints: [first] })).toMatch(/Between 2 and 5/);
  });

  it('requires endpoints on different hosts', () => {
    expect(
      problemsWith({
        endpoints: [first, { ...second, url: `${first.url}?again` }],
      }),
    ).toMatch(/different hosts/);
  });

  it('refuses endpoints that are not https', () => {
    expect(
      problemsWith({
        endpoints: [first, { ...second, url: 'http://cp.cloudflare.com/' }],
      }),
    ).toMatch(/https:\/\/ URL/);
  });

  it('requires unique, non-empty endpoint ids', () => {
    expect(
      problemsWith({ endpoints: [first, { ...second, id: first.id }] }),
    ).toMatch(/must be unique/);
    expect(
      problemsWith({ endpoints: [first, { ...second, id: ' ' }] }),
    ).toMatch(/needs an id/);
  });

  it('only allows 2xx expected statuses', () => {
    expect(
      problemsWith({ endpoints: [first, { ...second, expectedStatus: 302 }] }),
    ).toMatch(/200 to 299/);
  });

  it('keeps timeouts within what the native probe code accepts', () => {
    expect(
      problemsWith({
        timeouts: { ...defaults.timeouts, readTimeoutMs: 60_000 },
      }),
    ).toMatch(/500 to 15000/);
    expect(
      problemsWith({
        timeouts: {
          connectTimeoutMs: 5_000,
          readTimeoutMs: 4_000,
          callTimeoutMs: 3_000,
        },
      }),
    ).toMatch(/must not be shorter/);
  });

  it('refuses a failure threshold of one', () => {
    expect(problemsWith({ failureThreshold: 1 })).toMatch(
      /one bad round is never an incident/,
    );
  });

  it('refuses fewer than two verification rounds', () => {
    expect(problemsWith({ verificationRounds: 1 })).toMatch(/verification/);
  });

  it('refuses sub-second intervals, which would hammer the network', () => {
    expect(problemsWith({ healthyIntervalMs: 200 })).toMatch(
      /at least 1000 ms/,
    );
    expect(problemsWith({ confirmIntervalMs: 0 })).toMatch(/at least 1000 ms/);
  });

  it('checks the backoff, recovery and budget settings', () => {
    expect(
      problemsWith({
        incidentBackoff: { baseMs: 15_000, factor: 0.5, maxMs: 300_000 },
      }),
    ).toMatch(/backoff/);
    expect(
      problemsWith({
        recovery: { ...defaults.recovery, maxAttemptsPerIncident: 0 },
      }),
    ).toMatch(/at least 1 attempt/);
    expect(problemsWith({ sessionDataBudgetBytes: 0 })).toMatch(/budget/);
    expect(problemsWith({ sessionDataBudgetBytes: null })).toBe('');
  });
});
