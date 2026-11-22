# Background monitoring: decision record

**Status:** awaiting the project owner's decision. No service code has been written.
**Researched:** 20 November 2026, from the official pages listed under [Sources](#sources).
**App facts used:** `minSdk` 24, `targetSdk` 36, `compileSdk` 37; today health checks run only while the app is open.

## Summary

1. **No standard foreground-service type fits network monitoring.** The only type whose description can cover it is `specialUse`, the catch-all for "valid foreground service use cases that aren't covered by the other foreground service types" [S1].
2. **Android itself would allow it.** Android checks that a type and its permission are declared, not what the service is for. A user-started `specialUse` service would run on every Android version NetPulse supports.
3. **Google Play may not.** Play reviews every foreground-service declaration against five criteria [S18][S19]. NetPulse clearly meets three. Two are open to a reviewer's judgement, and nothing in the documentation settles them. **Whether Play would approve this cannot be known without submitting it.**
4. **Recommendation:** keep foreground-only monitoring as the shipped behaviour. Build the `specialUse` service only if you decide to, and treat it as unapproved for Play until a declaration has actually been accepted. Do not use `connectedDevice`, `dataSync` or `systemExempted`; each would misdescribe the app.
5. **Even with the service, NetPulse could not promise 24/7 coverage.** Doze, the user's Stop button, reboot, force-stop and manufacturer battery managers can all interrupt it. See [What can and cannot be guaranteed](#what-can-and-cannot-be-guaranteed).

The decision you need to make is at the [end of this document](#decision-needed).

## 1. Background execution options

"Background" has a precise meaning: "An app is running in the background if none of its activities are visible to the user, and the app isn't running any foreground services." [S16]

| Option | What happens in the background | Suitable for one check a minute? |
| --- | --- | --- |
| **Nothing extra** (today) | The process becomes cached. "Since cached processes can be killed by the system at any time, apps should cease all work while in the cached state." From Android 13 it "may receive limited or no execution time". [S15] | No. Monitoring stops when the app leaves the screen, and the app says so. |
| **Network callback only** | The callback stays registered until the app exits or unregisters it [S21], but a cached process may get no time to run it [S15]. | No. It also cannot see the failure NetPulse exists for: a network Android still calls validated, on which requests fail. |
| **WorkManager periodic work** | "The minimum repeat interval that can be defined is 15 minutes." Timing "depends on the constraints ... and on the optimizations performed by the system." [S17] In Doze the system "Doesn't let JobScheduler run. WorkManager uses JobScheduler internally, so WorkManager tasks don't run." [S13] | No. At best one check every 15 minutes, at an inexact time, and none while the phone dozes. |
| **Exact alarms** | In Doze, while-idle alarms cannot fire "more than once per nine minutes, per app" [S13]. | No. |
| **Push messages (FCM)** | Needs a server, which the MVP excludes. A push also cannot arrive over the dead connection it would be reporting. | No. |
| **Battery-optimisation exemption** | "Google Play policies prohibit apps from requesting direct exemption from Power Management features ... unless the core function of the app is adversely affected." The table of acceptable cases does not list a connectivity monitor. [S13] | Not a mechanism in itself, and not one to request. |
| **Foreground service** | The process counts as "visible", which the system keeps running [S15]. Network access has "No restrictions" while the app runs a foreground service [S14]. | Yes, technically. Policy is the question; see sections 2 to 4. |

Android's own guidance is to prefer the alternatives: "In most cases, your best option for running background tasks is to use WorkManager", while foreground services "run continuously once started, so they're a good choice when interrupting the task would have a bad user experience." [S16]

## 2. Does a foreground-service type fit?

From Android 14, "you must declare an appropriate service type for each foreground service" [S1]. Each type, with its official description [S1][S2]:

| Type | Official description | Fits NetPulse? |
| --- | --- | --- |
| `connectedDevice` | "Interactions with external devices that require a Bluetooth, NFC, IR, USB, or network connection." Play's listed use is "Continuous Data Transfer to an External Device", and its demo video must show "the user pairing and connecting to an external device directly inside the app" [S19]. | **No.** NetPulse talks to no external device. `CHANGE_NETWORK_STATE` is one of this type's prerequisite permissions, but holding a permission does not make the description true. |
| `dataSync` | "Data transfer operations", such as upload, download, backup and import. | **No.** A health check is not a data transfer. Play expects a user-initiated transfer [S19], and for apps targeting Android 15+ the type may run only "a total of 6 hours in a 24-hour period" [S7]. |
| `shortService` | "Quickly finish critical work that cannot be interrupted or postponed." Limited to "about 3 minutes". | **No.** |
| `systemExempted` | "Reserved for system applications and specific system integrations". Eligibility includes VPN apps, device owners, and "Apps holding `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM`". | **No.** NetPulse is none of these. Requesting an exact-alarm permission only to qualify would be exactly the bypass this project forbids. |
| `health`, `location`, `mediaPlayback`, `mediaProcessing`, `mediaProjection`, `microphone`, `phoneCall`, `remoteMessaging`, `camera` | Fitness tracking, navigation, playback, media conversion, screen projection, recording, calls, cross-device messaging. | **No.** |
| `specialUse` | "Covers any valid foreground service use cases that aren't covered by the other foreground service types." | **The only candidate.** It is honest about what the service is. Whether the use is "valid" is decided by Play's review. |

Android adds: "If a use case in your app isn't associated with any of these types, we strongly recommend that you migrate your logic to use WorkManager or user-initiated data transfer jobs." [S2] Section 1 shows why neither can do this job; that is the argument a Play declaration would have to make.

## 3. What a `specialUse` service would require

Nothing below has been added to the app. It is recorded so the cost of saying yes is clear.

### Manifest

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
<!-- Android 13+: needed for the ongoing notification to show in the notification drawer. -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<service
    android:name=".monitoring.MonitoringService"
    android:foregroundServiceType="specialUse"
    android:exported="false">
    <property
        android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
        android:value="User-started monitoring of this device's own internet connectivity, with small periodic HTTPS health checks, so that a connection which looks active but has stopped working is detected promptly." />
</service>
```

- The type-specific permissions "are defined as normal permissions and are granted by default" [S2].
- The `<property>` text is free-form and "reviewed when you submit your app in the Google Play Console"; it should "provide enough information to let the reviewer see why you need to use the `specialUse` type" [S1].
- Without the type, `startForeground()` throws `MissingForegroundServiceTypeException`; without the permission, `SecurityException` [S2][S3].

### Runtime behaviour

| Requirement | Why |
| --- | --- |
| Start only from the Start button, while the app is on screen. | Apps targeting Android 12+ "can't start foreground services while the app is running in the background"; doing so throws `ForegroundServiceStartNotAllowedException`. Starting after "the user performs an action on a UI element" is allowed. [S5] |
| Call `startForegroundService()`, then `ServiceCompat.startForeground()` with the notification and the `specialUse` type. | [S4] |
| Show a truthful ongoing notification with a Stop action. Priority `PRIORITY_LOW` or higher. | A lower priority makes the system add its own warning about the service [S4]. The Stop action is a Play requirement (section 4) and a project rule. |
| Ask for notification permission on Android 13+ before starting, and explain why. | The service can start without it, but then users "still see notices related to foreground services in the Task Manager but don't see them in the notification drawer" [S9]. NetPulse's Stop action lives in that notification. |
| Stop the service, unregister the network callback and cancel probes when the user taps Stop in the app or the notification. | Project rule; Play criterion "can be terminated or stopped by the user" [S18]. |
| Do not restart at boot or after the app is stopped. | Project rule: the service starts from an explicit user action. Android would permit a boot start for this type (the Android 15 boot ban covers `dataSync`, `camera`, `mediaPlayback`, `phoneCall`, `mediaProjection` and `microphone` [S10]), but the documentation does not say `specialUse` is allowed, and an unrequested restart is not "initiated by the user". |
| Run no WorkManager or JobScheduler work alongside it expecting extra time. | On Android 16, "jobs that are executing concurrently with a foreground service will adhere to the job runtime quota" [S11]. |

### Code that would have to move

Today the incident state machine is TypeScript, driven by a JavaScript timer. That is acceptable only because checks stop when the app leaves the screen. A service must not depend on the JavaScript runtime staying alive, so the monitoring loop (timer, state machine, recovery decisions) would have to run in Kotlin inside the service, with TypeScript only displaying its state. The native probe engine and network observer already exist and would be reused unchanged. The state machine's rules would be ported to Kotlin and checked against the same test cases as the TypeScript version.

## 4. Google Play: declaration, review and fit

### What Play requires

- "When your apps target Android 14 and above, you'll need to declare any foreground service types that you use" on the Play Console's App content page [S19][S2].
- For each type the declaration asks for: a description of the app functionality that uses it; the "user impact if" the task is deferred or interrupted by the system; and "a link to a video demonstrating each foreground service feature", which "should demonstrate the steps the user needs to take in your app in order to trigger the feature" [S19].
- "All foreground service types are subject to review." `specialUse` may be declared "in limited scenarios, if your use case meets the other characteristics required for foreground service usage" [S19]. No page says any type is approved automatically.
- Play also says: "Don't declare invalid or inaccurate FGS types in your app's manifest." [S18]

### The five criteria

"Apps are only allowed to declare a foreground service permission if the use" meets all of these [S18]:

| Criterion (quoted) | Does NetPulse meet it? |
| --- | --- |
| "provides a feature that is beneficial to the user and relevant to the core functionality of the app" | **Yes.** Monitoring is the app's core function. |
| "is initiated by the user or is user perceptible" | **Yes**, if it starts only from the Start button and shows an ongoing notification. |
| "can be terminated or stopped by the user" | **Yes**, with Stop in the app and in the notification. |
| "can't be interrupted or deferred by the system without causing a negative user experience" | **Uncertain.** The case for: the failure NetPulse targets is invisible to network callbacks, and WorkManager cannot check more often than every 15 minutes, so deferral means long undetected outages. The case against: a reviewer may judge that a delayed check is an acceptable experience. Play's own advice is "Don't use FGS if system management of your task doesn't break the user experience in your app. Consider alternatives like WorkManager." [S18] |
| "runs only for as long as necessary to complete the task" | **Uncertain.** Monitoring has no natural end; it runs until the user stops it. Whether "until the user stops it" satisfies this is a reviewer's call. |

**Conclusion on policy fit: uncertain.** The documentation neither approves nor rules out continuous connectivity monitoring. No listed use case names it. The only way to find out is to submit a declaration, and a rejection is a realistic outcome that the product must be able to survive.

One caveat on sources: Play's Developer Program Policy page [S20] was too long to read in full, so its foreground-service wording was taken from the Device and Network Abuse page [S18] it incorporates. Quotations from Play's help pages are short by necessity; read the pages themselves before submitting.

## 5. How each Android version and device behaviour affects the service

| Area | Effect |
| --- | --- |
| **Android 7 and 8** (the owner's test phone is 7.0) | None of the rules below exist at runtime, so a service runs with few limits. The manifest must still satisfy newer versions because the app targets API 36. **This phone cannot verify any Android 12+ behaviour.** |
| **Android 9** | The `FOREGROUND_SERVICE` permission is required [S8]. |
| **Android 12** | No foreground-service starts from the background, with listed exceptions [S5]. NetPulse must start it while visible. If the process dies, the service cannot be restarted silently. |
| **Android 13** | Notification permission becomes a runtime permission [S9]. The Task Manager lets users stop any app running a foreground service: "your **entire app stops**", and "the system doesn't send your app any callbacks" [S6]. |
| **Android 14** | A type and its permission are mandatory [S1][S3]. Play declaration required [S2]. |
| **Android 15** | Time limits apply only to `dataSync` and `mediaProcessing` [S7]; `specialUse` has no stated limit. Boot-time restrictions as in section 3 [S10]. |
| **Android 16** | Job quotas apply even while a foreground service runs [S11]. No change to foreground services themselves [S8]. |
| **Android 17** | Neither behaviour-changes page mentions foreground services or background work [S12]. The new local-network permission concerns LAN addresses and applies to apps targeting API 37; NetPulse targets 36 and probes public internet hosts. |
| **Boot** | The service would not restart (section 3). After a reboot monitoring is off until the user opens the app and taps Start. |
| **Doze** | When the phone has been still, unplugged and screen-off for a long time, Doze "Suspends network access" and "Ignores wake locks" [S13]. A separate table says an app running a foreground service has "No restrictions" on network access [S14], but no page read states which rule wins. **Assume checks may be delayed or skipped during Doze until it is tested on real devices.** |
| **App Standby** | An app with a foreground service counts as active. The documentation warns: "Don't start a foreground service just to prevent the system from determining that your app is idle." [S13] |
| **Manufacturer battery managers** | Not covered by Android's documentation. Many manufacturers add their own task killers and start-up managers, which can stop a foreground service regardless of the rules above. It has to be tested per device, starting with the owner's TECNO phone. |
| **Force-stop, swipe from recents, uninstall updates** | Force-stop ends the service until the user reopens the app. Swiping from recents behaves differently across manufacturers and must be tested. |

## 6. Persistent service compared with best-effort mode

| | Persistent `specialUse` service | Best-effort (today's behaviour, optionally plus coarse checks) |
| --- | --- | --- |
| Checks while another app is on screen | Yes, about once a minute | No. Optional WorkManager check at most every 15 minutes, inexact, none in Doze |
| Time to notice a dead connection | About 30 seconds (three failed rounds) | Only when NetPulse is opened, or up to 15+ minutes with coarse checks |
| Recovery hint sent while the user is elsewhere | Yes | No (coarse checks could send one, late) |
| User-visible cost | Permanent notification; steady data and battery use | None while closed |
| Data use at one round a minute | Not yet measured on a device. Each round opens two fresh HTTPS connections, so it will not be negligible on mobile data | Only while the app is open |
| Play risk | Declaration, video and review; may be rejected | None |
| Engineering cost | New native service, notification, Kotlin port of the monitoring loop, per-version and per-manufacturer testing | None; already built |
| Honest marketing claim | "Monitors while the notification is showing; Android or your phone's battery manager may still pause it" | "Monitors while NetPulse is open" |

The product's purpose is to help when the user is busy in another app, so best-effort mode delivers only part of the value. That is the cost of not building the service, and it should be stated plainly to users.

## 7. Recommendation

1. **Ship foreground-only monitoring as the default**, with the limit shown in the app ("Checks run only while NetPulse is open"). This is implemented.
2. **Do not add a coarse WorkManager check yet.** It adds a dependency and background data use for a 15-minute, Doze-suspended signal. Revisit only if the service is rejected and users ask for it.
3. **Build the `specialUse` service only on your explicit decision**, as its own milestone, with every item in section 3. Until Play has accepted a declaration, describe it as unapproved for Play and keep it out of any Play release.
4. **Never use another type to get around a rejection.** If Play rejects `specialUse`, the Play build stays best-effort.

### What can and cannot be guaranteed

With the service running, NetPulse could say it checks the connection about once a minute while its notification is showing. It could not guarantee:

- uninterrupted monitoring (Doze, Task Manager stop, force-stop, reboot, manufacturer battery managers, low memory);
- that a recovery request fixes anything (`reportNetworkConnectivity` is a hint Android may act on);
- that monitoring survives a reboot or an app update without the user starting it again;
- any ability to toggle Airplane Mode, mobile data or the modem.

### User-visible behaviour, if built

- **Start** (in the app, while visible): explains the notification, asks for notification permission on Android 13+, then starts the service.
- **Notification:** title with the current state ("NetPulse is monitoring", "Internet unreachable since 10:42"), text with the last check time, and a **Stop** action. No sound; low priority.
- **Stop** (app or notification): stops the service, unregisters the network callback, cancels probes, removes the notification.
- **After reboot, force-stop or a Task Manager stop:** monitoring is off; the dashboard says so the next time the app is opened.

### Tests required before any release with the service

Run each on Android 12, 13, 14, 15 and 16 (emulator or device), and on at least one phone from each manufacturer you care about, including the TECNO test phone:

1. Start from the app; confirm the notification, the declared type in `adb shell dumpsys activity services`, and one probe round a minute in logcat.
2. Press Home, use another app for ten minutes; confirm rounds continue.
3. Stop from the notification, then from the app; confirm the callback is unregistered and no further probes are sent.
4. Deny notification permission (Android 13+); confirm the service is listed in the Task Manager and can be stopped there, and that the app copes with being killed without a callback.
5. Stop from the Task Manager; reopen the app; confirm it shows monitoring as off.
6. Force Doze (`adb shell dumpsys deviceidle force-idle`); record whether rounds continue, are delayed, or stop.
7. Reboot; confirm nothing restarts by itself.
8. Swipe the app from recents; record what the device does.
9. Leave it running for 24 hours on mobile data; record battery use and diagnostic bytes.

## Decision needed

Please choose one:

- **A. Stay foreground-only.** No service. Background monitoring is recorded as a known limitation.
- **B. Build the service for your own device only (sideloaded).** Android permits it. It stays out of any Play release until option C succeeds.
- **C. Build the service and submit a Play declaration.** Accept that the review may fail, in which case the Play build falls back to A.

Options B and C both need the work in section 3, and a second test device or emulator running Android 12 or newer, because the Android 7.0 phone cannot exercise any of the modern restrictions.

## Sources

All accessed 20 November 2026.

| | Page |
| --- | --- |
| S1 | Foreground service types — https://developer.android.com/develop/background-work/services/fgs/service-types |
| S2 | Foreground service types are required (Android 14) — https://developer.android.com/about/versions/14/changes/fgs-types-required |
| S3 | Declare foreground services and request permissions — https://developer.android.com/develop/background-work/services/fgs/declare |
| S4 | Launch a foreground service — https://developer.android.com/develop/background-work/services/fgs/launch |
| S5 | Restrictions on starting a foreground service from the background — https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start |
| S6 | Handle user-initiated stopping of a foreground service — https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping |
| S7 | Foreground service timeouts — https://developer.android.com/develop/background-work/services/fgs/timeout |
| S8 | Changes to foreground services — https://developer.android.com/develop/background-work/services/fgs/changes |
| S9 | Notification runtime permission — https://developer.android.com/develop/ui/views/notifications/notification-permission |
| S10 | Android 15 behaviour changes (apps targeting 15) — https://developer.android.com/about/versions/15/behavior-changes-15 |
| S11 | Android 16 behaviour changes — https://developer.android.com/about/versions/16/behavior-changes-all and https://developer.android.com/about/versions/16/behavior-changes-16 |
| S12 | Android 17 behaviour changes — https://developer.android.com/about/versions/17/behavior-changes-all and https://developer.android.com/about/versions/17/behavior-changes-17 |
| S13 | Optimize for Doze and App Standby — https://developer.android.com/training/monitoring-device-state/doze-standby |
| S14 | Power management resource limits — https://developer.android.com/topic/performance/power/power-details |
| S15 | Processes and app lifecycle — https://developer.android.com/guide/components/activities/process-lifecycle |
| S16 | Background tasks overview — https://developer.android.com/develop/background-work/background-tasks |
| S17 | Define work requests (WorkManager) — https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work |
| S18 | Google Play: Device and Network Abuse policy, "Permissions for Foreground Services (FGS)" — https://support.google.com/googleplay/android-developer/answer/9888379 (the same policy text is served at https://support.google.com/googleplay/android-developer/answer/13315670) |
| S19 | Google Play: Understanding foreground service and full-screen intent requirements — https://support.google.com/googleplay/android-developer/answer/13392821 |
| S20 | Google Play: Developer Program Policy (effective 29 October 2026) — https://support.google.com/googleplay/android-developer/answer/18265346 |
| S21 | Read network state — https://developer.android.com/develop/connectivity/network-ops/reading-network-state and https://developer.android.com/reference/android/net/ConnectivityManager |
