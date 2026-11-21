import { NetPulseBridgeError } from '../errors';
import {
  parseNetworkSnapshot,
  parseProbeRound,
  parseRecoveryOutcome,
} from '../native-events';

const validPayload = {
  hasNetwork: true,
  transport: 'cellular',
  isVpn: false,
  validated: true,
  internetCapable: true,
  captivePortal: false,
  metered: true,
  capturedAtMs: 1_700_000_000_000,
  cause: 'available',
};

function expectInvalid(
  payload: unknown,
  parse: (payload: unknown) => unknown = parseNetworkSnapshot,
) {
  let thrown: unknown;
  try {
    parse(payload);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(NetPulseBridgeError);
  expect((thrown as NetPulseBridgeError).code).toBe('invalid_payload');
}

describe('parseNetworkSnapshot', () => {
  it('accepts a complete payload unchanged', () => {
    expect(parseNetworkSnapshot(validPayload)).toEqual(validPayload);
  });

  it('keeps unknown facts as null instead of guessing false', () => {
    const snapshot = parseNetworkSnapshot({
      hasNetwork: true,
      transport: null,
      isVpn: null,
      validated: null,
      internetCapable: null,
      captivePortal: null,
      metered: null,
      capturedAtMs: 1,
      cause: 'available',
    });

    expect(snapshot).toMatchObject({
      hasNetwork: true,
      transport: null,
      isVpn: null,
      validated: null,
      internetCapable: null,
      captivePortal: null,
      metered: null,
    });
  });

  it('treats missing or wrongly typed facts as unknown', () => {
    const snapshot = parseNetworkSnapshot({
      hasNetwork: true,
      validated: 'yes',
      metered: 1,
      capturedAtMs: 1,
      cause: 'snapshot',
    });

    expect(snapshot.transport).toBeNull();
    expect(snapshot.validated).toBeNull();
    expect(snapshot.metered).toBeNull();
    expect(snapshot.isVpn).toBeNull();
  });

  it('maps a transport name it does not know to "other"', () => {
    expect(
      parseNetworkSnapshot({ ...validPayload, transport: 'satellite' })
        .transport,
    ).toBe('other');
  });

  it('drops stray facts when there is no network', () => {
    expect(
      parseNetworkSnapshot({
        ...validPayload,
        hasNetwork: false,
        cause: 'lost',
      }),
    ).toEqual({
      hasNetwork: false,
      transport: null,
      isVpn: null,
      validated: null,
      internetCapable: null,
      captivePortal: null,
      metered: null,
      capturedAtMs: validPayload.capturedAtMs,
      cause: 'lost',
    });
  });

  it.each([
    ['null', null],
    ['a string', 'wifi'],
    ['a missing hasNetwork', { ...validPayload, hasNetwork: undefined }],
    ['a non-boolean hasNetwork', { ...validPayload, hasNetwork: 'true' }],
    ['a missing timestamp', { ...validPayload, capturedAtMs: undefined }],
    ['a non-finite timestamp', { ...validPayload, capturedAtMs: Number.NaN }],
    ['an unknown cause', { ...validPayload, cause: 'rebooted' }],
  ])('rejects %s', (_name, payload) => {
    expectInvalid(payload);
  });
});

const validRound = {
  hadNetwork: true,
  networkChanged: false,
  startedAtMs: 1_700_000_000_000,
  finishedAtMs: 1_700_000_000_450,
  results: [
    {
      endpointId: 'google',
      outcome: 'success',
      httpStatus: 204,
      durationMs: 310,
    },
    {
      endpointId: 'cloudflare',
      outcome: 'timeout',
      httpStatus: null,
      durationMs: 5000,
    },
  ],
  bytesUsed: 3_210,
};

describe('parseProbeRound', () => {
  it('accepts a complete round unchanged', () => {
    expect(parseProbeRound(validRound)).toEqual(validRound);
  });

  it('accepts a round that sent nothing because there was no network', () => {
    expect(
      parseProbeRound({
        ...validRound,
        hadNetwork: false,
        results: [],
        bytesUsed: null,
      }),
    ).toMatchObject({ hadNetwork: false, results: [], bytesUsed: null });
  });

  it('keeps an unreported byte count as null rather than zero', () => {
    for (const bytesUsed of [null, undefined, -1, Number.NaN, '3210']) {
      expect(
        parseProbeRound({ ...validRound, bytesUsed }).bytesUsed,
      ).toBeNull();
    }
  });

  it('keeps a missing HTTP status as null', () => {
    const round = parseProbeRound({
      ...validRound,
      results: [{ endpointId: 'google', outcome: 'tls_error', durationMs: 90 }],
    });

    expect(round.results[0].httpStatus).toBeNull();
  });

  it.each([
    ['null', null],
    ['a missing hadNetwork', { ...validRound, hadNetwork: undefined }],
    ['a missing networkChanged', { ...validRound, networkChanged: 'no' }],
    ['a missing start time', { ...validRound, startedAtMs: undefined }],
    ['a non-finite finish time', { ...validRound, finishedAtMs: Infinity }],
    ['results that are not a list', { ...validRound, results: {} }],
    ['a result that is not an object', { ...validRound, results: ['ok'] }],
    [
      'a result without an endpoint',
      { ...validRound, results: [{ outcome: 'success', durationMs: 1 }] },
    ],
    [
      'a result with an outcome it does not know',
      {
        ...validRound,
        results: [{ endpointId: 'google', outcome: 'ok', durationMs: 1 }],
      },
    ],
    [
      'a result with a negative duration',
      {
        ...validRound,
        results: [{ endpointId: 'google', outcome: 'success', durationMs: -5 }],
      },
    ],
  ])('rejects %s', (_name, payload) => {
    expectInvalid(payload, parseProbeRound);
  });
});

describe('parseRecoveryOutcome', () => {
  it.each([
    'requested',
    'no_network',
    'network_changed',
    'not_confirmed',
    'failed',
  ] as const)('accepts "%s"', outcome => {
    expect(parseRecoveryOutcome({ outcome })).toBe(outcome);
  });

  it.each([
    ['null', null],
    ['a bare string', 'requested'],
    ['a missing outcome', {}],
    ['an outcome it does not know', { outcome: 'modem_reset' }],
    ['a boolean', { outcome: true }],
  ])(
    'rejects %s rather than guessing that a request was made',
    (_name, payload) => {
      expectInvalid(payload, parseRecoveryOutcome);
    },
  );
});
