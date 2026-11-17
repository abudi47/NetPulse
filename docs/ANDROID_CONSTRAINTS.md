# Android Platform Constraints and Product Reality

This file is intentionally strict. NetPulse must not advertise capabilities Android does not grant to ordinary third-party apps.

## 1. Airplane Mode and modem control

Ordinary Play-distributed apps cannot silently toggle Airplane Mode or directly restart the cellular radio. Do not attempt hidden APIs, root commands, Accessibility workarounds, device-owner assumptions, or simulated user actions. If the user needs to toggle Airplane Mode, open Android settings and let the user act.

## 2. Connectivity observation

`ConnectivityManager.registerDefaultNetworkCallback()` can report when the system's default network becomes available, changes capabilities, or is lost. Wait for `onCapabilitiesChanged()` rather than synchronously querying a newly available network inside `onAvailable()` due to callback ordering/race conditions. Keep callback work fast; send slow I/O to a worker/executor/coroutine.

`NET_CAPABILITY_VALIDATED` is valuable system validation information, but independent small HTTPS probes are still needed to determine whether the app's chosen destinations are reachable. A network callback does not guarantee all endpoints or apps can use the internet.

## 3. reportNetworkConnectivity

`ConnectivityManager.reportNetworkConnectivity(network, false)` provides a hint to Android that the app observed a network without working connectivity. Android may reevaluate connectivity or switch networks. This is not a command to restart the modem and is not guaranteed to fix the issue. Record it as a requested hint, not a successful recovery.

## 4. Background execution and WorkManager

WorkManager periodic work has a minimum repeat interval of 15 minutes, and its execution time is inexact. It is not a substitute for a continuous 30-second or 1-minute health monitor.

JavaScript timers are not reliable for long-running background monitoring because the React Native process/runtime may be suspended or terminated. Background-critical behavior must be native if it is lawfully supported.

## 5. Foreground service requirements

- Android 12+ restricts starting foreground services from the background, with limited exceptions.
- Android 14+ requires a valid declared foreground-service type and corresponding permissions. The service must fit the type's actual intended use case.
- `specialUse` is a catch-all only for valid cases not covered by other types, requires a subtype explanation, and is reviewed in Google Play. Do not assume network monitoring will be approved.
- A foreground service is user-visible and should be started by an explicit user action while the app is eligible, show a truthful ongoing notification, expose a Stop action, and run only while the user-requested monitoring is active.
- Review current Google Play foreground-service policy before release. Do not add a type/permission just to keep a process alive.
- Android/OEM battery management, force-stop, user stop controls, reboot behavior, and OS upgrades can still interrupt monitoring.

If the exact use case cannot be approved for persistent foreground execution, ship a clearly labelled best-effort mode: live/event-driven observation while process is active plus coarse scheduled checks, with no claim of real-time 24/7 coverage.

## 6. Data and battery safety

- Health probes should be tiny and bounded.
- Do not use Fast.com webpage scraping or continuous full speed tests.
- Do not automatically download multi-megabyte files after every brief recovery.
- A later quick throughput estimate must be opt-in, have a clearly stated maximum byte budget, and stop at the limit.
- Use exponential backoff and cooldowns.
- Respect metered-network status and user-defined daily budgets.

## 7. Required engineering checks

Before adding a service or manifest permission, Claude must:
1. Identify the exact Android API levels affected.
2. Identify the correct FGS type, permission, and Play Console declaration requirements.
3. Explain why WorkManager / callbacks are insufficient for the exact user story.
4. State what the app can and cannot guarantee.
5. Add an explicit user stop path and persistent notification if a service is implemented.
6. Add test instructions for Android 12, 13, 14, 15, and newer devices available to the team.

## 8. Official references

- Network state and callbacks: https://developer.android.com/develop/connectivity/network-ops/reading-network-state
- ConnectivityManager API: https://developer.android.com/reference/android/net/ConnectivityManager
- WorkManager periodic work: https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
- Foreground service launch: https://developer.android.com/develop/background-work/services/foreground-services/launch
- Background foreground-service launch restrictions: https://developer.android.com/develop/background-work/services/foreground-services/restrictions-bg-start
- Foreground-service types: https://developer.android.com/develop/background-work/services/foreground-services/service-types
- Google Play developer policy: https://support.google.com/googleplay/android-developer/answer/18265346
