# Claude Code Project Instructions — NetPulse

You are the senior React Native / Android engineer for NetPulse. The user is experienced with full-stack JavaScript but is new to Kotlin. Explain decisions plainly, generate native Android code when required, and keep the user-facing application primarily TypeScript/React Native.

## Product objective

Build an Android-first network reliability assistant that detects when mobile data appears connected but internet requests fail, diagnoses the issue using small probes, and attempts safe recovery actions supported by Android. Prioritize reliability, but never claim uninterrupted 24/7 execution or automatic modem resets that Android does not permit.

## Fixed technology choices

- React Native 0.88.1, TypeScript, New Architecture.
- React Native Community CLI / bare native project.
- Android as the first target. Do not add iOS implementation until explicitly requested.
- Kotlin is allowed only where native Android APIs are required. Claude should author and explain it; do not push Kotlin learning as a prerequisite.
- Use a typed Turbo Native Module and Codegen for the app/native boundary where practical and compatible with RN 0.88.1. Do not introduce deprecated APIs without explaining why.
- Jetpack Compose is NOT used; UI is React Native.
- No backend for MVP; local persistence only.

## Non-negotiable Android constraints

1. Do not implement Airplane Mode toggling, silent cellular radio toggling, hidden APIs, root-only commands, Accessibility-service tricks, ADB shell commands in production, or other policy/permission bypasses.
2. Do not assume a foreground service is automatically allowed. Research the correct Android foreground-service type for this app's exact continuous-monitoring use case and current Google Play policy. `specialUse` requires an accurate subtype declaration and Play review; do not add it just to bypass restrictions. If eligibility is unclear, keep persistent monitoring behind a documented design decision and provide a foreground-only / best-effort fallback.
3. A foreground service must be started by an explicit user action while the app is eligible, have a truthful persistent notification, expose a Stop action, and stop when the user disables monitoring.
4. Do not use WorkManager for a 30-second or 1-minute polling promise. Periodic WorkManager work has a 15-minute minimum interval and is inexact. Use it only for coarse deferrable maintenance, not real-time monitoring.
5. Do not rely on JavaScript `setInterval`, a JS timer, or a JS runtime staying alive for background monitoring. The JS process can be suspended/killed. Any approved persistent monitoring loop and connectivity callbacks belong in the native Android layer.
6. `ConnectivityManager.NetworkCallback` reports network lifecycle/capabilities; it does not prove every destination is reachable. Combine it with bounded HTTP health probes. Do not block the connectivity callback thread with network I/O.
7. `reportNetworkConnectivity(network, false)` is only a hint to Android that may cause reevaluation; it is not a guaranteed repair.
8. Never promise recovery is guaranteed. Never automatically download large files or run full Fast.com tests in a tight loop.

## Product defaults

- Monitoring is explicitly enabled by the user.
- Monitor the Android default network; identify Wi-Fi vs cellular where permitted.
- Treat Android `NET_CAPABILITY_VALIDATED` as a useful signal, not the sole truth.
- Use 2 or more independent, configurable HTTPS probe endpoints; short connect/read/call timeouts; low payload; backoff; and bounded concurrency.
- Confirm failure with multiple failed checks before recovery.
- Do not probe while no usable network exists; react to network callbacks instead.
- After recovery, require multiple successful probes before reporting restored.
- Keep a strict diagnostic data budget. A full speed test is not part of MVP. A future quick test must have a user-configurable byte cap and explicit enablement.
- Do not hardcode Fast.com webpage scraping or use undocumented Netflix endpoints.

## Architecture rules

- UI and presentation: React Native + TypeScript.
- App state and orchestration: typed services/hooks/view models in TypeScript.
- Native Android integration: Kotlin Turbo Native Module + Android system components for `ConnectivityManager`, any approved foreground service, notifications, and system settings deep links.
- Local settings: a small, maintained persistence library or Android DataStore through native layer; choose one and document it. Avoid two competing sources of truth.
- Local event history: SQLite-based storage (e.g. a maintained RN SQLite/Drizzle solution) or a native Room repository. Choose one after verifying RN 0.88.1 compatibility; do not add both.
- Keep domain models platform-agnostic where possible.
- All public bridge methods must be typed, validated, and documented. Handle module unavailable/errors gracefully.

## Engineering workflow

Before editing:
1. Inspect the repository, package.json, Android Gradle files, React Native version, and current app structure.
2. Read the relevant files in `docs/`.
3. Verify package/API guidance against official docs for the installed RN and Android versions. Do not rely on old snippets copied from previous chats.

For each task:
1. State a short plan and list exact files to change.
2. Implement one small vertical slice.
3. Run formatting/lint/type-check/tests that exist.
4. Run an Android debug build when native files or dependencies change.
5. Fix build errors before moving on; do not claim success without tool output.
6. Summarize changed files, commands run, outcomes, limitations, and the next small step.

## Code quality

- TypeScript strict mode; avoid `any` unless justified and isolated.
- No giant components or single-file architecture.
- Separate domain, data, native bridge, and presentation layers.
- Use accessible controls, responsive layouts, and clear empty/error/loading states.
- Avoid unnecessary dependencies and avoid replacing existing project versions without a compatibility reason.
- Add unit tests for the state machine, failure counter, cooldown, retry/backoff, and restoration verification.
- Add native tests or manual test instructions for Android callback/service lifecycle.
- Never hide errors with broad empty `catch` blocks. Log safely without sensitive data.
- Do not collect location, phone number, SIM identifiers, contacts, or unrelated personal data for MVP.

## Required behavior for diagnostics

- Distinguish: no active network, network without internet validation, endpoint failure, captive portal/redirect, DNS failure (only when measured), timeout, and healthy connection.
- A single endpoint outage must not trigger recovery. Require agreement across probes or a carefully documented quorum.
- A successful TCP/TLS/HTTP request must be measured against expected response semantics (e.g. expected 204), not just any 2xx/redirect.
- The monitor must not interfere with user traffic or repeatedly change networks.
- On cellular, respect metered data and configurable limits.

## UI direction

Create a premium, calm, dark-first interface with accessible contrast and optional light theme. The dashboard should prioritize:
- Monitoring state and clear Start/Stop control.
- Current network type and internet health.
- Latency / last successful check.
- Recovery state and last recovery result.
- Daily diagnostic data consumption.
- Recent incident timeline.

Avoid fake metrics. Use empty/placeholder states until measured values exist.
