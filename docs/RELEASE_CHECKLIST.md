# NetPulse release checklist

**Reviewed:** 20 November 2026, against `CLAUDE.md`, `docs/`, and the MVP acceptance criteria in [PRODUCT_SPEC.md §9](PRODUCT_SPEC.md).
**Verdict: not ready for release.** All automated checks pass and both builds succeed, but nothing beyond installing the app has been verified on a phone. The release build is signed with the shared debug key, and the background-monitoring decision is open.

How to read the status column:

| Status | Meaning |
| --- | --- |
| ✅ Verified | A check was run in this review and the evidence is cited. |
| ⚠️ Partial | Verified by automated tests or code inspection, but not yet on a device. |
| ⏳ Not verified | Not run yet. Not a failure, but not a pass. |
| ❌ Failed | Checked and does not meet the bar. |
| — | Does not apply to what has been built. |

## 1. Results

### Permissions and Android policy

| Check | Status | Evidence |
| --- | --- | --- |
| Release permissions are minimal and justified | ✅ | `aapt2 dump badging` on the release APK lists only `INTERNET` (health checks) and `ACCESS_NETWORK_STATE` (reading the default network, required by `registerDefaultNetworkCallback` and `reportNetworkConnectivity`). The third entry, `com.netpulse.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, is defined by the AndroidX core library to protect its own internal receivers; it is not shown to users. |
| Debug-only permissions stay out of release | ✅ | The debug APK also has `SYSTEM_ALERT_WINDOW` and `ACCESS_LOCAL_NETWORK`. The manifest-merger report traces both to React Native's debug library (developer menu and Metro connection). Neither is in the release APK. |
| No foreground service, boot receiver, alarms, wake locks or WorkManager | ✅ | The manifest declares no `<service>` or `<receiver>`; a source scan for `startForeground`, `BOOT_COMPLETED`, `AlarmManager`, `WakeLock` and `WorkManager` finds nothing. |
| Foreground service uses a valid type, truthful notification, Stop action, Play declaration | — | No service exists. The assessment is in [ANDROID_BACKGROUND_DECISION.md](ANDROID_BACKGROUND_DECISION.md) and awaits your decision (section 3 below). |
| No hidden APIs, root, Accessibility tricks, Airplane Mode or radio toggling | ✅ | Source scan of `android/app/src/main`, `specs/` and `src/` for reflection (`getDeclaredMethod`, `setAccessible`, `Class.forName`), shell (`Runtime.exec`, `ProcessBuilder`, `su`), `AccessibilityService`, `Settings.Global/System` writes, `setMobileDataEnabled`, `setDataEnabled` and `TelephonyManager` finds nothing. Network settings are only *opened* for the user (`Settings.ACTION_WIRELESS_SETTINGS`). |
| No personal data collected | ✅ | Same scan: no location, phone number, SIM or device identifiers, contacts. Probes send a fixed user agent, `NetPulse (connectivity check)`, and nothing else about the user or device. Logs record error codes only. |
| No claim of 24/7 monitoring or guaranteed recovery | ✅ | UI wording scanned. The dashboard says checks run only while the app is open; every recovery message says "a request, not a guaranteed fix"; a restored connection is described as "connection back", never "fixed". Tests assert this wording (`dashboardViewModel.test.ts`, `presentation.test.ts`). |

### Probes and data

| Check | Status | Evidence |
| --- | --- | --- |
| Bounded timeouts | ✅ | 4 s connect, 4 s read, 5 s for the whole call, DNS included. `ProbeEngineTest`: a stalled endpoint is reported as a timeout within the call limit. Native refuses any timeout outside 0.5–15 s (`ProbeConfigTest`). |
| No body downloads | ✅ | `ProbeEngineTest`: an endpoint that promises 1 MB and stalls is judged on its status line and the connection dropped in under a second. Redirects are never followed (`ProbeEngineTest`). |
| Strict response check | ✅ | Only the exact expected status (204) counts; any other 2xx is "unexpected response", any 3xx "redirect". `ProbeEngineTest`, `assessRound.test.ts`. |
| Endpoint independence | ✅ | Two endpoints on different hosts run by different companies (Google, Cloudflare). The configuration is refused if hosts repeat (`monitoringConfig.test.ts`). Note: Android's own validation uses Google's endpoint too, so the Cloudflare probe is the truly independent one. |
| One endpoint failing never triggers recovery | ✅ | `monitorMachine.test.ts` "a single endpoint outage": ten partial rounds, no incident, no request. |
| Cancellation | ✅ | `ProbeEngineTest` (cancel ends a round promptly); `monitorMachine.test.ts` and `monitoringController.test.ts` (stop, network loss and going to the background cancel the round in flight and discard its result). |
| One round at a time | ✅ | Native refuses a second concurrent round (`E_PROBE_BUSY`); the state machine never schedules one (`monitorMachine.test.ts` "never runs two rounds at once"). |
| Backoff | ✅ | Rounds during an incident are spaced 15 s, 30 s, 60 s, … up to 5 min (`monitorMachine.test.ts`). |
| Data accounting | ⚠️ | Each round's bytes come from Android's per-app traffic counters and are summed per session; rounds the device does not report are counted separately and never shown as zero (`monitorMachine.test.ts`, `dashboardViewModel.test.ts`). **Real bytes per round have not been measured.** In debug builds the counter may include Metro traffic, so measure on a release build. |
| Data budget | ⚠️ | Checks pause after 5 MB in one monitoring session (tested). The product spec asks for a *daily* budget; that needs persistence, which is not built. |

### Monitoring logic

| Check | Status | Evidence |
| --- | --- | --- |
| Incident needs 3 consecutive all-failed rounds (configurable) | ✅ | `monitorMachine.test.ts` "all endpoints failing"; threshold 5 also tested. |
| Recovery only after a confirmed incident | ✅ | `monitorMachine.test.ts`, `monitoringController.test.ts` "asks the system for a re-check only once an incident is confirmed". Native refuses independently unless its own latest round on the same, still-default network failed every check (`RecoveryGateTest`). |
| Cooldown (60 s) and attempt limit (3 per incident) | ✅ | `monitorMachine.test.ts` "cooldown", "attempt limit"; controller test "stops asking at the attempt limit". |
| Restored only after 3 consecutive good rounds | ✅ | `monitorMachine.test.ts` "restored connectivity", including a failure part-way that restarts the count. |
| Hand-over to the user when only they can help | ✅ | Captive portals never trigger a request; after the attempt limit or a rejected request the state is `needs_user_action` with an "Open network settings" button (`monitorMachine.test.ts`, `dashboardViewModel.test.ts`, `MonitoringStatusCard.test.tsx`). |
| Recovery logged with reason and time | ⚠️ | The activity list records the incident (with its cause and Android's validation state), each request, and its outcome, all timestamped. It is kept **in memory only** and lost when the app closes. |
| Tests mean what they say | ✅ | Five rules in the state machine were deliberately broken one at a time (threshold, cooldown, attempt limit, verification count, captive-portal handling); each break was caught by the tests. The new "wait for a known network" rule was checked the same way. |

### Lifecycle

| Check | Status | Evidence |
| --- | --- | --- |
| Network callback registered once, removed when not needed | ⚠️ | Native ignores a second start (`DefaultNetworkObserver`); TypeScript stops observing when the app goes to the background or the last screen unsubscribes (`networkSnapshotStore.test.ts`). On a JavaScript reload the native module closes its observer. **Not yet confirmed on a device** (`DEVICE_TESTING.md` A8, A9). |
| Stop monitoring cancels everything | ⚠️ | Timers cleared, round cancelled, late results and late recovery replies discarded, listeners released (`monitoringController.test.ts` "stopping"). The network callback deliberately stays registered while the dashboard is on screen, because the dashboard shows live network state even with monitoring off. |
| Backgrounding | ⚠️ | Checks are put on hold and the round in flight cancelled; on return the next check waits until the network is known again (`monitoringController.test.ts` "in the background"). Not yet observed on a device (`DEVICE_TESTING.md` B6). |
| Process death, force-stop, reboot | ⚠️ | By design, monitoring is off after any of these until the user taps Start again; there is nothing to restore. Not tested on a device. |
| Notification Stop, battery optimisation, manufacturer task killers | — | Only relevant to a background service, which does not exist. Covered for the future in [ANDROID_BACKGROUND_DECISION.md §5](ANDROID_BACKGROUND_DECISION.md). |

### Builds and code quality

| Check | Status | Evidence |
| --- | --- | --- |
| TypeScript, lint, formatting, unit tests | ✅ | `npm run check`: `tsc` strict with no errors, ESLint with no warnings, Prettier clean, **333 Jest tests passed in 14 suites**. |
| Kotlin unit tests | ✅ | `./gradlew :app:testDebugUnitTest`: **46 tests passed** (network tracker 16, probe engine 16, probe config 8, recovery gate 6). |
| Debug build | ✅ | `./gradlew assembleDebug`: BUILD SUCCESSFUL. |
| Release build | ✅ | `./gradlew assembleRelease`: BUILD SUCCESSFUL, including Android lint (`lintVitalRelease`). 56 MB APK for arm64-v8a, armeabi-v7a, x86 and x86_64. |
| Release signing | ❌ | `apksigner verify --print-certs`: signed with `CN=Android Debug`, the key shipped in the template and committed to the repository. Play would reject it, and anyone could sign an "update". A private release key is needed (section 3). |
| No `any`, no suppressed type errors, no empty `catch` | ✅ | Source scan of non-test code: none. |
| Dependencies | ✅ | Nothing added beyond the template. HTTP uses OkHttp, which React Native already ships; Kotlin tests add only JUnit. |

### On a device

Run on 20 November 2026 on the TECNO CX Air (Android 7.0, mobile data, Ethio Telecom), with the debug build unless stated. Test numbers refer to [DEVICE_TESTING.md](DEVICE_TESTING.md). Screenshots were taken on the build machine and are not stored in the repository.

| Test | Status | What happened |
| --- | --- | --- |
| A1: app opens to the dashboard with live network values | ✅ | Dark dashboard, no white flash at launch. Connection card **Live**: Mobile data, Validated, Metered. Every probe value **Not measured yet**. |
| A8: one network callback, released in the background | ✅ | Read from Android's own registry (`dumpsys connectivity`): exactly one default-network request while open (id 418); released at 14:53:48 when Home was pressed; a single new one (423) on return. |
| A9: JavaScript reloads do not leak callbacks | ✅ | Three reloads: each released the previous request before registering the next (424, 425, 426). One active afterwards. |
| B1: first health check | ✅ | Start → a check within a second → **Connection healthy** (or **degraded**, see findings 3). |
| B2: checks every 60 s; latency; data per check | ✅ | Checks at 14:56:02, 14:57:02, 14:58:03, 14:59:04. Latency **330–410 ms** (full HTTPS request on mobile data). Data **about 5 KB per check** after a 10 KB first check: roughly 300 KB an hour, 7 MB a day if left open. |
| B6: nothing runs in the background | ✅ | Tested three times (90 s to 2 min 15 s away). No check ran while away, and Android listed **0** NetPulse callbacks. On return the app waited for the network, ran one check within about a second, and showed the result. |
| C1: incident and first recovery request | ✅ | Probes pointed at unresolvable names. Failed rounds at 0, 10 and 20 s → incident (**DNS failure**, "Android still reports this network as validated") → `reportNetworkConnectivity` accepted by Android and by the native safety check → 5 s settle → still failing → cooldown. Failed DNS rounds used **0 bytes**. |
| C2: cooldown | ✅ | Requests at 15:15:49, 15:16:50 and 15:17:50: never closer than 60 s. |
| C3: attempt limit and hand-over | ✅ | After the third request: **Your action is needed**, suggesting the user toggle mobile data or Airplane Mode themselves, with **Open network settings**. No fourth request; checks slowed to every 5 minutes. |
| C4: Open network settings | ❌ → fixed | The button opened Android's network settings, but Back went to another Settings page instead of NetPulse (see finding 4). Fixed; retest below. |

### Open issue reported by the owner

After the second test session (which stopped at about 15:32 when the phone locked), the owner found **Airplane Mode on, with no way to switch it off**, and uninstalled NetPulse. The phone was restarted at about 16:24 and again at about 16:29, after which Airplane Mode was off and mobile data worked normally (checked 16:38).

- **Cause not established.** Android keeps its logs in memory, and the restarts erased everything before 16:24. No crash or error was recorded for NetPulse, Settings or the system between 15:00 and 16:24.
- **NetPulse cannot change Airplane Mode.** Doing so needs a system-only permission (`WRITE_SECURE_SETTINGS`) that ordinary apps cannot hold. The app's code never refers to it, and the build that was installed requested only internet and network-state access, plus React Native's developer-only permissions.
- **The test automation did not touch it either.** Every tap was made inside NetPulse after confirming it was on screen. One exception: at 15:18 the test's "Open network settings" step showed Android's wireless settings (where the Airplane switch is), and after Back three scroll gestures ran on the Tethering page by mistake. They were scrolls, not taps, and the phone's internet was confirmed working afterwards at 15:19.
- **The owner's account:** about 20–30 minutes before reporting it, they turned Airplane Mode on themselves. The switch then stayed grey and could not be turned on or off. It became usable again after they uninstalled NetPulse.
- **Timeline from Android's app-usage history** (kept on disk, so it survived the restarts; one-minute resolution):

  | Time | Event |
  | --- | --- |
  | 15:30 | Test session 2 reinstalls NetPulse over USB; Google Play Protect shows a warning dialog about the install. |
  | 15:31 | NetPulse goes to the background (phone locks). |
  | 15:33, 15:38 | Android's "choose SIM" dialog appears on its own, twice, while NetPulse is in the background. On this phone that dialog has also appeared after SIM or radio resets (for example at 08:47). |
  | 15:38–15:40 | The owner uses NetPulse. |
  | 16:22, 16:25 | NetPulse on screen briefly, followed each time by Android's wireless settings page (where the Airplane switch is). It could have been NetPulse's "Open network settings" button or a long-press on the Airplane tile; the history does not say. |
  | 16:24 | First restart. |
  | 16:26–16:28 | The owner works through wireless, SIM, tethering and data settings. |
  | 16:27 | NetPulse last on screen; it was uninstalled after this, before the second restart. |
  | 16:29 | The mobile network registers again (Safaricom), followed by the second restart, then Ethio Telecom at 16:31. |

- **Possible contributors, none confirmed:**
  1. This phone's mobile radio may already have been misbehaving: the unprompted SIM dialogs at 15:33 and 15:38 came before the Airplane problem, while NetPulse was in the background and not listening. Phones of this type (MediaTek, Android 7) grey out the Airplane switch while the radio is switching; a stuck radio keeps it grey until it recovers or restarts.
  2. NetPulse may have been running the **simulated-outage test settings** when the owner opened it at 15:38. They were restored in the code at 15:33, but an app sitting in the background may not have reloaded them. In that case it would have reported a false outage, asked Android to re-check the real network, and suggested toggling Airplane Mode. That would be a test-process fault.
  3. An interaction between NetPulse and this manufacturer's modified Android that is not understood. It cannot be ruled out from the evidence, and the owner's observation (grey until uninstalled) points that way.
- **How to settle it, only if the owner agrees:** with NetPulse not installed, toggle Airplane Mode a few times as a baseline. Then install the **release** build, which contains no test settings, and toggle with the app open but monitoring off, then with monitoring on. Stop at the first stuck switch (a restart cleared it before), and capture the phone's log live so the cause is visible.
- **Changed as a result:** no more scripted input on the owner's phone unless a test window has been agreed, so automation cannot collide with their own use.

### Findings from the device tests

1. **Native module missing from the debug build** (fixed). The first device run showed "the NetPulse native module is missing". The debug build's C++ settings had been cached before the module existed, so its generated code was never compiled in. Unit tests cannot catch this. The app degraded exactly as designed (no crash, everything marked unavailable). Fixed by clearing `android/app/.cxx`; the release build was never affected. Troubleshooting note added to the README.
2. **Which endpoint failed was not shown** (fixed). "1 of 2 health checks failed" now reads, for example, "1 of 2 health checks failed (google: timed out)".
3. **The first check after the app starts can be "degraded"** (observation, not changed). Twice, the first check after a cold start timed out on Google's endpoint while Cloudflare answered; later checks succeeded on both. From the phone, Google did not answer a ping within 3 s while Cloudflare answered in 28 ms. The product rule held: one failing endpoint was shown as degraded and never treated as an outage. If this proves common, a slightly longer connect limit for the first check is a candidate tuning change.
4. **Back from network settings went to the wrong place** (fixed). Settings was opened as a new task, so it joined the Settings app's existing task; Back then showed the Tethering page that was already open there. It now opens on top of NetPulse. Nothing was changed in Settings during the test; tethering stayed on.
5. **A real 20-second DNS stall was caught** (fixed a reporting bug it exposed). On the working connection, two consecutive rounds failed on both endpoints at 15:09:41 and 15:09:58, each taking about 7 s, longer than the 5 s call limit. A request stuck in a DNS lookup cannot be interrupted, so the engine's backstop ended the round; it then misreported those probes as "connection dropped". They are now reported as timeouts, with a test. Had the app stayed open, a third failure would have confirmed an incident, which matches the configured threshold (about 20–30 s of total failure).
6. **One Kotlin test failed once under load** (not a code fault). During a release build that left about 600 MB of free memory, a probe test timed out on a local request and took 218 s. Re-run on its own, twice: 48/48 passed in 7 s. Run the Kotlin tests separately from release builds.

## 2. MVP acceptance criteria

From [PRODUCT_SPEC.md §9](PRODUCT_SPEC.md):

| Criterion | Status |
| --- | --- |
| A clean install builds and launches on a supported Android device | ⚠️ Builds and installs; launch seen only as the process starting (phone locked). |
| Start/Stop monitoring works and the UI reflects native state | ⚠️ Unit-tested; not seen on a device. |
| Network changes surfaced without blocking Android's callback threads | ⚠️ All callback work runs on NetPulse's own thread and does no I/O; not observed on a device. |
| A single failing endpoint does not trigger recovery | ✅ |
| Three consecutive failed rounds across independent probes create an incident | ✅ |
| Probes have bounded timeouts and small responses | ✅ |
| Recovery action logged with reason and timestamp | ⚠️ In memory only. |
| Recovery marked successful only after multiple successful checks | ✅ |
| Stop unregisters callbacks, cancels work, stops any service | ⚠️ Work is cancelled; the network callback is kept while the dashboard is on screen (by design, see above); no service exists. |
| No fake speed, ping, uptime or recovery-success values | ✅ |
| Unit tests cover transitions, retry limits, cooldown, recovery verification | ✅ |

## 3. Open decisions and blockers

1. **Background monitoring** (yours to decide). Options A, B and C are in [ANDROID_BACKGROUND_DECISION.md](ANDROID_BACKGROUND_DECISION.md#decision-needed). Recommended: A, foreground-only, until you choose otherwise. Policy fit for a Play-distributed `specialUse` service is uncertain and can only be settled by submitting a declaration.
2. **Release signing key.** Generate a private upload key, keep it out of the repository, and configure `signingConfigs.release` in `android/app/build.gradle`. Enrolling in Play App Signing is recommended.
3. **Persistence.** Incident history and settings are not stored; one store needs choosing (see `CLAUDE.md`, "Architecture rules"). This also unlocks the daily data budget and a history that survives restarts. It was not part of prompts 01–06.
4. **Device testing.** Run [DEVICE_TESTING.md](DEVICE_TESTING.md) on the TECNO phone, and sections A and B on at least one Android 12+ device or emulator.

## 4. Known limitations

- Monitoring runs only while NetPulse is open on screen. The app says so on the dashboard.
- A recovery request is `reportNetworkConnectivity(network, false)`: a hint that Android may re-check the network. It can change nothing. NetPulse cannot reset the modem or toggle Airplane Mode or mobile data; when that is what would help, it says so and opens Android's settings.
- Whether a recovery request ever helps a genuinely stuck mobile connection is unknown until it is observed during a real fault.
- Activity and session data are lost when the app closes.
- The data figure is Android's count for the whole app during each round, so it is approximate.
- On Android 7, Android may not describe a new network straight away; NetPulse then reads it itself. On Android 8+ a different code path runs that the only test phone cannot exercise.
- The Google probe shares infrastructure with Android's own validation check, so the two signals are not fully independent of each other.

## 5. Device matrix

| Device | Android | Status |
| --- | --- | --- |
| TECNO CX Air (H3713), arm64 | 7.0 (API 24) | Connected over USB; every build installed. No on-screen test yet (locked). |
| Any Android 8–11 device | — | None available. |
| Any Android 12–16 device or emulator | — | None available. No emulator system image is installed; one is roughly a 1–1.5 GB download. |

The TECNO phone is also this computer's internet connection (USB tethering), so tests that cut its mobile data also cut the build machine off.

## 6. Build commands

Environment used for every result above (Linux, no Android Studio):

```sh
export JAVA_HOME="$HOME/.jdks/zulu17.70.201-ca-jdk17.0.21.1-linux_x64"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$PATH:$ANDROID_HOME/platform-tools"
```

| Purpose | Command | Output |
| --- | --- | --- |
| All TypeScript checks | `npm run check` | — |
| Kotlin unit tests | `cd android && ./gradlew :app:testDebugUnitTest` | `android/app/build/reports/tests/testDebugUnitTest/index.html` |
| Debug APK (your phone only, faster) | `cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a` | `android/app/build/outputs/apk/debug/app-debug.apk` |
| Debug APK (all architectures) | `cd android && ./gradlew assembleDebug` | same |
| Release APK | `cd android && ./gradlew assembleRelease` | `android/app/build/outputs/apk/release/app-release.apk` |
| Install and run with Metro | `npm start`, then `npm run android` | — |
| Check the release APK's permissions | `$ANDROID_HOME/build-tools/37.0.0/aapt2 dump badging android/app/build/outputs/apk/release/app-release.apk \| grep uses-permission` | — |
| Check the release APK's signer | `$ANDROID_HOME/build-tools/37.0.0/apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk` | — |
