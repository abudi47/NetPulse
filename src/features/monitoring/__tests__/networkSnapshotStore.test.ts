import type { NetworkSnapshot } from '../../../domain/models/network';
import { NetPulseBridgeError } from '../../../native/errors';
import type { NetPulseBridge } from '../../../native/NetPulseNative';
import {
  createNetworkSnapshotStore,
  type AppLifecycle,
} from '../networkSnapshotStore';

function snapshotAt(
  capturedAtMs: number,
  overrides: Partial<NetworkSnapshot> = {},
): NetworkSnapshot {
  return {
    hasNetwork: true,
    transport: 'wifi',
    isVpn: false,
    validated: true,
    internetCapable: true,
    captivePortal: false,
    metered: false,
    capturedAtMs,
    cause: 'snapshot',
    ...overrides,
  };
}

/** A promise the test resolves or rejects by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeBridge(available = true) {
  const starts: ReturnType<typeof deferred<NetworkSnapshot>>[] = [];
  const networkListeners = new Set<(snapshot: NetworkSnapshot) => void>();
  const invalidListeners = new Set<(error: NetPulseBridgeError) => void>();
  const stopObserving = jest.fn(async () => {});

  const bridge: NetPulseBridge = {
    isAvailable: () => available,
    getSnapshot: async () => snapshotAt(0),
    startObserving: jest.fn(() => {
      const start = deferred<NetworkSnapshot>();
      starts.push(start);
      return start.promise;
    }),
    stopObserving,
    runProbeRound: async () => {
      throw new Error('The network store must never run probes');
    },
    cancelProbeRound: () => {},
    requestNetworkReevaluation: async () => {
      throw new Error('The network store must never request recovery');
    },
    openNetworkSettings: async () => false,
    addNetworkListener: (listener, onInvalid) => {
      networkListeners.add(listener);
      if (onInvalid) {
        invalidListeners.add(onInvalid);
      }
      return () => {
        networkListeners.delete(listener);
        if (onInvalid) {
          invalidListeners.delete(onInvalid);
        }
      };
    },
  };

  return {
    bridge,
    starts,
    stopObserving,
    listenerCount: () => networkListeners.size,
    emit: (snapshot: NetworkSnapshot) =>
      networkListeners.forEach(listener => listener(snapshot)),
    emitInvalid: (error: NetPulseBridgeError) =>
      invalidListeners.forEach(listener => listener(error)),
  };
}

function createFakeLifecycle(active = true) {
  let isActive = active;
  const listeners = new Set<(active: boolean) => void>();
  const lifecycle: AppLifecycle = {
    isActive: () => isActive,
    onChange: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    lifecycle,
    listenerCount: () => listeners.size,
    set: (next: boolean) => {
      isActive = next;
      listeners.forEach(listener => listener(next));
    },
  };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function setup(options: { available?: boolean; active?: boolean } = {}) {
  const fake = createFakeBridge(options.available);
  const app = createFakeLifecycle(options.active);
  const log = jest.fn();
  const store = createNetworkSnapshotStore(fake.bridge, app.lifecycle, log);
  return { ...fake, app, log, store };
}

describe('createNetworkSnapshotStore', () => {
  it('is unavailable, and never calls native, without a native module', () => {
    const { store, bridge, app } = setup({ available: false });

    const unsubscribe = store.subscribe(() => {});

    expect(store.getState()).toEqual({ status: 'unavailable' });
    expect(bridge.startObserving).not.toHaveBeenCalled();
    expect(app.listenerCount()).toBe(0);
    unsubscribe();
    expect(store.getState()).toEqual({ status: 'unavailable' });
  });

  it('does not observe until something subscribes', () => {
    const { store, bridge } = setup();

    expect(store.getState()).toEqual({ status: 'idle' });
    expect(bridge.startObserving).not.toHaveBeenCalled();
  });

  it('starts observing on the first subscriber and reports the result', async () => {
    const { store, starts } = setup();
    const listener = jest.fn();

    store.subscribe(listener);
    expect(store.getState()).toEqual({ status: 'starting' });

    starts[0].resolve(snapshotAt(100));
    await flush();

    expect(store.getState()).toEqual({
      status: 'observing',
      snapshot: snapshotAt(100),
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('asks native to observe only once for several subscribers', () => {
    const { store, bridge, listenerCount } = setup();

    store.subscribe(() => {});
    store.subscribe(() => {});

    expect(bridge.startObserving).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(1);
  });

  it('applies change events', async () => {
    const { store, starts, emit } = setup();
    store.subscribe(() => {});
    starts[0].resolve(snapshotAt(100));
    await flush();

    emit(snapshotAt(200, { hasNetwork: false, cause: 'lost' }));

    expect(store.getState()).toEqual({
      status: 'observing',
      snapshot: snapshotAt(200, { hasNetwork: false, cause: 'lost' }),
    });
  });

  it('never lets an older snapshot overwrite a newer one', async () => {
    const { store, starts, emit } = setup();
    store.subscribe(() => {});

    emit(snapshotAt(300, { transport: 'cellular', cause: 'available' }));
    starts[0].resolve(snapshotAt(100));
    await flush();

    expect(store.getState()).toMatchObject({
      snapshot: { capturedAtMs: 300, transport: 'cellular' },
    });
  });

  it('stops native observation when the last subscriber leaves', async () => {
    const { store, starts, stopObserving, listenerCount, app } = setup();
    const first = store.subscribe(() => {});
    const second = store.subscribe(() => {});
    starts[0].resolve(snapshotAt(100));
    await flush();

    first();
    expect(stopObserving).not.toHaveBeenCalled();
    second();

    expect(stopObserving).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(0);
    expect(app.listenerCount()).toBe(0);
    expect(store.getState()).toEqual({ status: 'idle' });
  });

  it('pauses in the background and resumes in the foreground', async () => {
    const { store, bridge, starts, stopObserving, listenerCount, app } =
      setup();
    store.subscribe(() => {});
    starts[0].resolve(snapshotAt(100));
    await flush();

    app.set(false);
    expect(stopObserving).toHaveBeenCalledTimes(1);
    expect(listenerCount()).toBe(0);
    expect(store.getState()).toEqual({ status: 'idle' });

    app.set(true);
    expect(bridge.startObserving).toHaveBeenCalledTimes(2);
    starts[1].resolve(snapshotAt(500));
    await flush();
    expect(store.getState()).toMatchObject({
      status: 'observing',
      snapshot: { capturedAtMs: 500 },
    });
  });

  it('does not start while the app is in the background', () => {
    const { store, bridge, app } = setup({ active: false });

    store.subscribe(() => {});
    expect(bridge.startObserving).not.toHaveBeenCalled();
    expect(store.getState()).toEqual({ status: 'idle' });

    app.set(true);
    expect(bridge.startObserving).toHaveBeenCalledTimes(1);
  });

  it('ignores a start result that arrives after observation was stopped', async () => {
    const { store, starts, emit } = setup();
    const unsubscribe = store.subscribe(() => {});

    unsubscribe();
    starts[0].resolve(snapshotAt(100));
    emit(snapshotAt(200));
    await flush();

    expect(store.getState()).toEqual({ status: 'idle' });
  });

  it('ignores a stale start result after a restart', async () => {
    const { store, starts, app } = setup();
    store.subscribe(() => {});
    app.set(false);
    app.set(true);

    starts[0].resolve(snapshotAt(900));
    await flush();
    expect(store.getState()).toEqual({ status: 'starting' });

    starts[1].resolve(snapshotAt(100));
    await flush();
    expect(store.getState()).toMatchObject({ snapshot: { capturedAtMs: 100 } });
  });

  it('reports a failed start as an error and logs only the error code', async () => {
    const { store, starts, log } = setup();
    store.subscribe(() => {});

    starts[0].reject(new NetPulseBridgeError('native_error', 'details'));
    await flush();

    expect(store.getState()).toEqual({
      status: 'error',
      message: 'native_error',
    });
    expect(log).toHaveBeenCalledWith(
      '[NetPulse] Could not start network observation: native_error',
    );
  });

  it('can be restarted after an error by resubscribing', async () => {
    const { store, bridge, starts } = setup();
    const unsubscribe = store.subscribe(() => {});
    starts[0].reject(new NetPulseBridgeError('native_error', 'details'));
    await flush();

    unsubscribe();
    store.subscribe(() => {});

    expect(bridge.startObserving).toHaveBeenCalledTimes(2);
    expect(store.getState()).toEqual({ status: 'starting' });
  });

  it('logs an invalid event without changing state', async () => {
    const { store, starts, emitInvalid, log } = setup();
    store.subscribe(() => {});
    starts[0].resolve(snapshotAt(100));
    await flush();

    emitInvalid(new NetPulseBridgeError('invalid_payload', 'bad'));

    expect(store.getState()).toMatchObject({ status: 'observing' });
    expect(log).toHaveBeenCalledWith(
      '[NetPulse] Ignored a network event: invalid_payload',
    );
  });

  it('logs, but survives, a failure to stop', async () => {
    const { store, stopObserving, log } = setup();
    stopObserving.mockRejectedValueOnce(
      new NetPulseBridgeError('native_error', 'details'),
    );

    store.subscribe(() => {})();
    await flush();

    expect(store.getState()).toEqual({ status: 'idle' });
    expect(log).toHaveBeenCalledWith(
      '[NetPulse] Could not stop network observation: native_error',
    );
  });
});
