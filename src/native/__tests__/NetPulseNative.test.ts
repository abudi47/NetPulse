import { NetPulseBridgeError } from '../errors';
import {
  createNetPulseBridge,
  type NativeNetPulseModule,
} from '../NetPulseNative';

const payload = {
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

const round = {
  hadNetwork: true,
  networkChanged: false,
  startedAtMs: 1_700_000_000_000,
  finishedAtMs: 1_700_000_000_300,
  results: [
    { endpointId: 'a', outcome: 'success', httpStatus: 204, durationMs: 120 },
  ],
  bytesUsed: 900,
};

const endpoints = [
  { id: 'a', url: 'https://a.example/generate_204', expectedStatus: 204 },
];
const timeouts = {
  connectTimeoutMs: 4000,
  readTimeoutMs: 4000,
  callTimeoutMs: 5000,
};

function createFakeNative() {
  let emit: ((value: unknown) => void) | null = null;
  const remove = jest.fn(() => {
    emit = null;
  });
  const native = {
    getSnapshot: jest.fn(async () => payload),
    startObserving: jest.fn(async () => payload),
    stopObserving: jest.fn(async () => {}),
    runProbeRound: jest.fn(async () => round),
    cancelProbeRound: jest.fn(),
    requestNetworkReevaluation: jest.fn(async () => ({ outcome: 'requested' })),
    openNetworkSettings: jest.fn(async () => true),
    onNetworkChanged: jest.fn((handler: (value: unknown) => void) => {
      emit = handler;
      return { remove };
    }),
  };
  return {
    native: native as unknown as NativeNetPulseModule,
    calls: native,
    remove,
    emit: (value: unknown) => emit?.(value),
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

describe('createNetPulseBridge without a native module', () => {
  const bridge = createNetPulseBridge(null);

  it('reports itself unavailable', () => {
    expect(bridge.isAvailable()).toBe(false);
  });

  it('rejects reads with a typed "unavailable" error', async () => {
    for (const call of [bridge.getSnapshot(), bridge.startObserving()]) {
      const error = await rejection(call);
      expect(error).toBeInstanceOf(NetPulseBridgeError);
      expect((error as NetPulseBridgeError).code).toBe('unavailable');
    }
  });

  it('lets callers stop and listen without failing', async () => {
    await expect(bridge.stopObserving()).resolves.toBeUndefined();
    const removeListener = bridge.addNetworkListener(() => {});
    expect(() => removeListener()).not.toThrow();
  });

  it('rejects a recovery request and reports that settings could not be opened', async () => {
    expect(await rejection(bridge.requestNetworkReevaluation())).toMatchObject({
      code: 'unavailable',
    });
    await expect(bridge.openNetworkSettings()).resolves.toBe(false);
  });

  it('rejects probe rounds, and tolerates a cancel', async () => {
    expect(
      await rejection(bridge.runProbeRound(endpoints, timeouts)),
    ).toMatchObject({ code: 'unavailable' });
    expect(() => bridge.cancelProbeRound()).not.toThrow();
  });
});

describe('createNetPulseBridge with a native module', () => {
  it('returns validated snapshots', async () => {
    const { native } = createFakeNative();
    const bridge = createNetPulseBridge(native);

    expect(bridge.isAvailable()).toBe(true);
    await expect(bridge.getSnapshot()).resolves.toEqual(payload);
    await expect(bridge.startObserving()).resolves.toEqual(payload);
  });

  it('turns a native failure into a typed error', async () => {
    const { native, calls } = createFakeNative();
    calls.getSnapshot.mockRejectedValueOnce(new Error('SecurityException'));
    calls.stopObserving.mockRejectedValueOnce(new Error('boom'));
    const bridge = createNetPulseBridge(native);

    const readError = await rejection(bridge.getSnapshot());
    expect(readError).toBeInstanceOf(NetPulseBridgeError);
    expect(readError).toMatchObject({
      code: 'native_error',
      message: 'SecurityException',
    });
    expect(await rejection(bridge.stopObserving())).toMatchObject({
      code: 'native_error',
    });
  });

  it('rejects a snapshot that does not match the contract', async () => {
    const { native, calls } = createFakeNative();
    calls.startObserving.mockResolvedValueOnce({
      hasNetwork: 'maybe',
    } as never);
    const bridge = createNetPulseBridge(native);

    expect(await rejection(bridge.startObserving())).toMatchObject({
      code: 'invalid_payload',
    });
  });

  it('runs a probe round with exactly the configured endpoints and timeouts', async () => {
    const { native, calls } = createFakeNative();
    const bridge = createNetPulseBridge(native);

    await expect(bridge.runProbeRound(endpoints, timeouts)).resolves.toEqual(
      round,
    );
    expect(calls.runProbeRound).toHaveBeenCalledWith(endpoints, timeouts);
  });

  it('turns a refused probe round into a typed error', async () => {
    const { native, calls } = createFakeNative();
    calls.runProbeRound.mockRejectedValueOnce(
      new Error('A probe round is already running'),
    );
    const bridge = createNetPulseBridge(native);

    expect(
      await rejection(bridge.runProbeRound(endpoints, timeouts)),
    ).toMatchObject({
      code: 'native_error',
      message: 'A probe round is already running',
    });
  });

  it('rejects a probe round that does not match the contract', async () => {
    const { native, calls } = createFakeNative();
    calls.runProbeRound.mockResolvedValueOnce({
      ...round,
      results: 'none',
    } as never);
    const bridge = createNetPulseBridge(native);

    expect(
      await rejection(bridge.runProbeRound(endpoints, timeouts)),
    ).toMatchObject({ code: 'invalid_payload' });
  });

  it('cancels the round in flight, and never throws while doing so', () => {
    const { native, calls } = createFakeNative();
    const bridge = createNetPulseBridge(native);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    bridge.cancelProbeRound();
    expect(calls.cancelProbeRound).toHaveBeenCalledTimes(1);

    calls.cancelProbeRound.mockImplementationOnce(() => {
      throw new Error('module torn down');
    });
    expect(() => bridge.cancelProbeRound()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      '[NetPulse] Could not cancel the probe round: native_error',
    );
    warn.mockRestore();
  });

  it('passes on what native did with a recovery request', async () => {
    const { native, calls } = createFakeNative();
    const bridge = createNetPulseBridge(native);

    await expect(bridge.requestNetworkReevaluation()).resolves.toBe(
      'requested',
    );
    calls.requestNetworkReevaluation.mockResolvedValueOnce({
      outcome: 'not_confirmed',
    });
    await expect(bridge.requestNetworkReevaluation()).resolves.toBe(
      'not_confirmed',
    );
  });

  it('never reports a recovery request it cannot confirm was made', async () => {
    const { native, calls } = createFakeNative();
    calls.requestNetworkReevaluation.mockResolvedValueOnce({} as never);
    calls.requestNetworkReevaluation.mockRejectedValueOnce(new Error('boom'));
    const bridge = createNetPulseBridge(native);

    expect(await rejection(bridge.requestNetworkReevaluation())).toMatchObject({
      code: 'invalid_payload',
    });
    expect(await rejection(bridge.requestNetworkReevaluation())).toMatchObject({
      code: 'native_error',
    });
  });

  it('opens network settings and reports whether a screen was shown', async () => {
    const { native, calls } = createFakeNative();
    const bridge = createNetPulseBridge(native);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(bridge.openNetworkSettings()).resolves.toBe(true);
    calls.openNetworkSettings.mockResolvedValueOnce(false);
    await expect(bridge.openNetworkSettings()).resolves.toBe(false);
    calls.openNetworkSettings.mockRejectedValueOnce(new Error('no activity'));
    await expect(bridge.openNetworkSettings()).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[NetPulse] Could not open network settings: native_error',
    );
    warn.mockRestore();
  });

  it('delivers valid change events and reports invalid ones separately', () => {
    const { native, emit } = createFakeNative();
    const bridge = createNetPulseBridge(native);
    const listener = jest.fn();
    const onInvalid = jest.fn();

    bridge.addNetworkListener(listener, onInvalid);
    emit({ ...payload, cause: 'capabilities_changed', validated: false });
    emit({ nonsense: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      ...payload,
      cause: 'capabilities_changed',
      validated: false,
    });
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(onInvalid.mock.calls[0][0]).toMatchObject({
      code: 'invalid_payload',
    });
  });

  it('removes the native subscription when the listener is removed', () => {
    const { native, emit, remove } = createFakeNative();
    const bridge = createNetPulseBridge(native);
    const listener = jest.fn();

    const removeListener = bridge.addNetworkListener(listener);
    removeListener();
    emit(payload);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
