# Testing NetPulse on a device

Automated tests cover the logic: what counts as a failure, when an incident starts, when recovery is requested. They cannot show that a real phone behaves the way the code assumes. These manual tests do that.

Record results in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md). A test that has not been run on a device is not passed.

## Before you start

1. Unlock the phone and keep the screen on. Developer options → **Stay awake** helps while charging. Without it, a short screen timeout locks the phone mid-test, and NetPulse (correctly) pauses its checks whenever the phone locks.
2. Check the phone is visible: `adb devices` must list it as `device`.
3. Start the app:

   ```sh
   npm start                       # terminal 1
   npm run android                 # terminal 2
   ```

4. In a third terminal, watch NetPulse's own log lines:

   ```sh
   adb logcat -s NetPulseNetwork NetPulseProbe ReactNativeJS
   ```

Useful commands used below:

```sh
# NetPulse's Android user id, needed to find its entries in system dumps
adb shell dumpsys package com.netpulse | grep -m1 userId=

# Network callbacks currently registered by that user id (replace 10123)
adb shell dumpsys connectivity | grep -c "uid/pid:10123"

# Screenshot to the current folder
adb exec-out screencap -p > screen.png
```

## A. Network snapshot (prompt 02)

| # | Steps | Expected |
| --- | --- | --- |
| A1 | Open the app on mobile data. | Connection card badge reads **Live**. Network type **Mobile data**, Data metering **Metered**, Android validation **Validated**. |
| A2 | Turn Wi-Fi on and connect. | Within a second or two: **Wi-Fi**, usually **Unmetered**. No app restart needed. |
| A3 | Turn Wi-Fi off. | Returns to **Mobile data**. |
| A4 | Turn on Airplane Mode yourself. | Network type **No network**; validation and metering **No network**. |
| A5 | Turn Airplane Mode off. | Values return as the network comes back. |
| A6 | Connect through a VPN, if you use one. | Network type ends with **via VPN**. |
| A7 | Join a Wi-Fi network with a sign-in page, before signing in. | Android validation **Sign-in required**. |
| A8 | Note the callback count (command above), press Home, wait 5 seconds, count again. | The count drops by one in the background and returns when the app is reopened. This proves the callback is unregistered. |
| A9 | In the Metro terminal press `r` to reload JavaScript several times, then count callbacks. | The count does not grow. Reloading must not leak callbacks. |

On Android 7 (API 24 and 25) Android is not guaranteed to send a network's details right after announcing it, so NetPulse reads them itself when they do not arrive. A2 to A5 exercise that path on the Android 7.0 test phone. On Android 8 and newer a different path runs, which this phone cannot test.

## B. Health checks and incidents (prompt 03)

| # | Steps | Expected |
| --- | --- | --- |
| B1 | Tap **Start monitoring** on a working connection. Note: the first check after the app starts can show **Connection degraded** if one endpoint is slow to connect on a cold mobile radio; that is the one-endpoint rule working, not a fault. | Status goes to **Checking connection**, then **Connection healthy** within a few seconds. Internet health **Reachable**; Latency shows milliseconds; Last successful check shows the time; Diagnostic data shows an approximate size. Activity lists **Monitoring started**. |
| B2 | Leave it for three minutes. | One check about every 60 seconds (watch Last successful check). Diagnostic data grows by a similar amount each time. **Write down the bytes per check**; it is the basis for the data-use estimate. |
| B3 | Tap **Stop monitoring**. | Status **Monitoring is off**; probe values **Not measured yet**; Activity lists **Monitoring stopped** with the number of checks and data used. No further log lines. |
| B4 | Start monitoring, then turn on Airplane Mode. | Status **No network**. No checks are attempted while there is no network. |
| B5 | Turn Airplane Mode off. | A check runs within a few seconds; status returns to healthy. Activity shows **Network lost** then **Network available**. |
| B6 | Start monitoring, press Home, wait two minutes, reopen. | No checks ran while the app was in the background (Last successful check did not advance). One runs immediately on return. |

### Simulating failures

A real "connected but dead" network is hard to produce on demand. The reliable way to test the logic on a device is to point the probes at hosts that fail, in `src/domain/config/monitoringConfig.ts`, then reload JavaScript (`r` in the Metro terminal). **Undo the edit afterwards.**

| To simulate | Change |
| --- | --- |
| One endpoint down | Set the `google` endpoint's `url` to `https://netpulse-test.invalid/generate_204` |
| Everything timing out | Set both `url`s to an address that never answers, e.g. `https://10.255.255.1/a` and `https://10.255.255.2/a` |
| DNS failing everywhere | Set both `url`s to different `.invalid` host names |

| # | Steps | Expected |
| --- | --- | --- |
| B7 | One endpoint down; start monitoring. | **Connection degraded**. Internet health **Partly reachable (1 of 2 checks failed)**. It never becomes an incident, however long it runs. |
| B8 | DNS failing everywhere; start monitoring. | **Possible problem** after the first round, re-checked about every 10 seconds. After the third failed round the incident is confirmed: Activity shows **Internet unreachable**, naming a DNS failure and saying Android still reports the network as validated. Recovery then starts (section C). |
| B9 | Everything timing out; start monitoring. | As B8, with the cause shown as a timeout. Each round ends within about 5 seconds. |
| B10 | During B8 or B9, restore the real URLs and reload. | Reloading restarts the app's JavaScript, so monitoring is off again. Start it: healthy. (Restoring connectivity mid-incident is covered by the automated tests; see `monitorMachine.test.ts`, "restored connectivity".) |

## C. Recovery requests (prompt 05)

Run these with both endpoints failing (B8 or B9), so an incident is confirmed while the real network is fine. Android will re-check the network, find it working, and change nothing, which is what makes this safe to test.

| # | Steps | Expected |
| --- | --- | --- |
| C1 | Start monitoring and wait for the third failed round. | Status **Requesting a re-check**, then **Verifying connection**. Activity shows **Asked Android to re-check the network**, request 1. The Recovery tile shows the request time. |
| C2 | Keep waiting. | The next check still fails: Activity shows **Still unreachable after the request**; status **Waiting before retrying**. A second request is made no sooner than 60 seconds after the first, and a third no sooner than 60 seconds after the second. |
| C3 | After the third request fails. | Status **Your action is needed**, with an **Open network settings** button. No fourth request is ever made. |
| C4 | Tap **Open network settings**, then press Back. | Android's own network settings open; NetPulse changes nothing there. Back returns to NetPulse, not to another Settings page. |
| C5 | With one endpoint down (B7), run for five minutes. | No recovery request is ever made. |
| C6 | During C1, turn Airplane Mode on just before the third failed round would finish. | No request is sent for a network that is gone; status **No network**. |

What these tests cannot show: whether a recovery request helps on a genuinely stuck mobile connection. That can only be observed when the fault happens for real. When it does, note the time, what the Activity list recorded, and whether the connection came back without toggling Airplane Mode.

## D. Things to try on other Android versions

The Android 7.0 phone exercises the oldest supported behaviour only. On Android 8 or newer (a second phone or an emulator), repeat A1 to A9 and B1 to B6. Nothing in NetPulse is version-specific beyond the network callback, but that is exactly the part that differs.

## Automated tests

```sh
npm run check                                 # TypeScript: types, lint, format, Jest
cd android && ./gradlew :app:testDebugUnitTest   # Kotlin: tracker, probe engine, config, recovery gate
```

The Kotlin tests run on the build machine, not the phone. Their report is written to `android/app/build/reports/tests/testDebugUnitTest/index.html`.
