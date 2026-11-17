# NetPulse Technical Architecture

## 1. Application shape

Use React Native 0.88.1, TypeScript, and the New Architecture. Use the React Native Community CLI so the Android project is directly available for the small native integration layer.

### TypeScript responsibilities

- Screens and navigation.
- Dashboard, settings, analytics, and incident timeline.
- Presentation state and view models/hooks.
- Domain models and pure incident-state logic where appropriate.
- User preferences and display formatting.
- Calling the typed native bridge and handling bridge errors.

### Android-native responsibilities

- `ConnectivityManager` default-network callbacks.
- Reading `NetworkCapabilities` and network type/metredness (only what permissions allow).
- The approved monitoring execution mechanism when app is backgrounded.
- User-visible ongoing notification and Stop action if a foreground service is approved and implemented.
- Lightweight, bounded HTTP health probes while the JS runtime is not guaranteed to exist.
- Reporting observed connectivity through `reportNetworkConnectivity()` as a hint, not a promise of repair.
- Emitting snapshots and events to React Native when the JS runtime is active.

Do not put background-critical work exclusively in JavaScript timers or React hooks.

## 2. High-level flow

```text
Android ConnectivityManager
        |
        v
Native Connectivity Monitor
        |
        v
Native Health Probe Engine <---- Probe Endpoint Configuration
        |
        v
Incident / Recovery State Machine
        |
        +---- permitted network reevaluation hint
        |
        v
Recovery Verification
        |
        v
Native Event / Snapshot Bridge
        |
        v
React Native TypeScript UI
        |
        v
Local incident history and settings
```

## 3. Suggested source tree

```text
NetPulse/
├── CLAUDE.md
├── docs/
├── src/
│   ├── app/
│   ├── navigation/
│   ├── features/
│   │   ├── dashboard/
│   │   ├── monitoring/
│   │   ├── incidents/
│   │   ├── analytics/
│   │   └── settings/
│   ├── domain/
│   │   ├── models/
│   │   ├── state-machine/
│   │   └── use-cases/
│   ├── data/
│   │   ├── repositories/
│   │   └── persistence/
│   ├── native/
│   │   ├── NetPulseNative.ts
│   │   └── native-events.ts
│   ├── shared/
│   └── theme/
├── specs/
│   └── NativeNetPulse.ts
└── android/
    └── app/src/main/java/com/netpulse/
        ├── NetPulsePackage.kt (only if required by chosen module setup)
        ├── network/
        ├── monitoring/
        └── notifications/
```

Claude may adjust the tree to match the RN 0.88.1 Codegen/template conventions, but must keep responsibilities separated and document deviations.

## 4. Native bridge contract (proposed)

Expose a typed module with operations conceptually equivalent to:

- `getSnapshot()`: returns current monitoring and network snapshot.
- `startMonitoring(options)`: starts user-requested monitoring if Android lifecycle/policy constraints permit; returns a structured result.
- `stopMonitoring()`: fully stops the native monitor/service and unregisters callbacks.
- `openNetworkSettings()`: opens the relevant Android system settings screen for user-assisted actions.
- Native events: `networkChanged`, `healthChanged`, `incidentChanged`, `recoveryChanged`, and `monitoringChanged`.

The exact TurboModule Codegen event/API shape must follow official React Native 0.88 docs. Do not invent unsupported event-emitter APIs. Include typed payloads and version the contract if it changes.

## 5. Probe engine

- Use HTTPS requests to small endpoints with expected response semantics.
- Prefer at least two independently operated endpoints.
- Use strict connect/read/call timeouts and cancellation.
- Do not download large files for health checks.
- Treat redirects, captive portals, TLS errors, DNS failures, timeouts, and unexpected status codes distinctly where evidence supports it.
- Do not equate a DNS lookup with general internet reachability.
- Avoid running simultaneous redundant probes.
- Bind probe attempts to the relevant default network where necessary and verify the network hasn't changed mid-check.

## 6. State machine and safeguards

- Require repeated failures before an incident is confirmed.
- Maintain one in-flight probe round at a time.
- Apply cooldown and per-incident attempt limits.
- Use exponential backoff after repeated failures.
- Do not call recovery actions because one diagnostic provider is down.
- Log every action and result locally.
- Verify recovery with several successful probes.

## 7. Persistence

Keep MVP local-only. Persist:
- User-configurable settings.
- Monitoring session boundaries.
- Incident start/end times.
- Probe summaries (not full response bodies).
- Recovery action name, result, and reason.
- Estimated diagnostic bytes sent/received.

Avoid storing raw network identifiers or unnecessary sensitive device data. Choose one persistence approach and document why; do not duplicate the same data in multiple stores.

## 8. Build stages

1. RN app scaffold, navigation, theme, dashboard shell.
2. Native connectivity snapshot and event bridge.
3. Lightweight diagnostics and typed health state.
4. Pure state machine with tests.
5. Local history and settings.
6. Background execution decision and native monitoring implementation after FGS eligibility/policy research.
7. Safe recovery hint, cooldown, verification, and incident display.
8. Device/OEM tests, data and battery measurements, release hardening.
