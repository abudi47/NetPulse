# Claude Code Prompt — Native Connectivity Snapshot

Read `CLAUDE.md` and the architecture/platform docs first. Build only the native connectivity snapshot slice.

Implement a typed React Native 0.88.1 New Architecture Turbo Native Module (with Codegen) that exposes:
- `getSnapshot()` for the current default network snapshot.
- start/stop observation methods with safe duplicate-registration handling.
- typed events for default-network availability/loss/capability changes.

Use Android `ConnectivityManager.registerDefaultNetworkCallback`. Wait for capability callbacks rather than synchronously reading capabilities in `onAvailable`. Do not perform HTTP I/O on Android's connectivity callback thread. Report transport, validated capability, meteredness, and timestamp only where accurately available. Treat missing data as unknown.

Connect the bridge to a TypeScript hook/service and display real values in the dashboard. Ensure listeners are removed and native callbacks are unregistered correctly. Do not add a foreground service, WorkManager polling, Airplane Mode controls, or speed tests in this task.

Run Codegen/build/type-check/tests and report actual outcomes.
