# NetPulse

An Android-first network reliability assistant. NetPulse is meant to notice when mobile data looks connected but requests fail, diagnose the problem with small probes, and ask Android to re-check the network.

NetPulse cannot toggle Airplane Mode, reset the modem, or guarantee recovery or 24/7 monitoring. Android does not allow ordinary apps to do those things. See [docs/ANDROID_CONSTRAINTS.md](docs/ANDROID_CONSTRAINTS.md).

## Current state

The app monitors the connection **while it is open on screen**:

- **Network state** comes live from Android: network type, Android's own validation, metering, VPN, sign-in pages.
- **Health checks**, once you tap Start monitoring: one small HTTPS request to each of two independently run endpoints about every 60 seconds. Redirects are not followed and nothing is downloaded.
- **Incidents:** one failing endpoint is shown as degraded, never as an outage. Three consecutive rounds in which every endpoint fails confirm an incident.
- **Recovery:** on a confirmed incident NetPulse asks Android to re-check the network (`reportNetworkConnectivity`), at most three times per incident and at least 60 seconds apart. This is a request Android may act on, not a fix. Connectivity is only reported as restored after three consecutive good rounds.
- **When only you can help** (a sign-in page, or the requests made no difference), the app says so and offers a button to Android's network settings.
- **Every value on screen is measured or labelled as unavailable.** Data use is the figure Android reports for the app, shown as approximate.

Not built yet:

- **Background monitoring.** Checks stop when the app leaves the screen, and the app says so. Whether a persistent service is permissible is assessed in [docs/ANDROID_BACKGROUND_DECISION.md](docs/ANDROID_BACKGROUND_DECISION.md); it needs a decision from the project owner.
- **Saved history and settings.** Activity is kept in memory for the current run only, and the tunable values are constants in one file (below).

What has and has not been verified, including on a real phone, is tracked in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).

## Requirements

These are the versions the React Native 0.88.1 template pins, plus what the official setup guide recommends.

| Tool | Version | Source |
| --- | --- | --- |
| Node.js | 22.13+ or 24.3+ | `react-native` `engines` field |
| JDK | 17 | [React Native setup guide](https://reactnative.dev/docs/set-up-your-environment); newer JDKs are not recommended |
| Android SDK Platform | 37 (`platforms;android-37.0`) | `compileSdkVersion` in `android/build.gradle` |
| Android SDK Build-Tools | 37.0.0 | `android/build.gradle` |
| Android NDK | 27.1.12297006 | `android/build.gradle` |
| CMake | 3.22.1 | Android Gradle Plugin default |
| Gradle | 9.4.1 | Gradle wrapper, downloaded on first build |
| Android Gradle Plugin / Kotlin | 9.2.1 / 2.2.0 | pinned by React Native |

The app targets API 36 and supports Android 7.0 (API 24) and newer.

## Setup

1. Install JDK 17 and the Android SDK packages above, then point your shell at them. Add this to `~/.zshrc` and adjust the paths to where they are installed:

   ```sh
   export JAVA_HOME="$HOME/.jdks/zulu17.70.201-ca-jdk17.0.21.1-linux_x64"
   export ANDROID_HOME="$HOME/Android/Sdk"
   export PATH="$JAVA_HOME/bin:$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
   ```

2. Install JavaScript dependencies:

   ```sh
   npm install
   ```

3. Check the environment:

   ```sh
   ./scripts/environment-check.sh
   ```

## Run on Android

Connect a phone with USB debugging enabled (Settings → Developer options → USB debugging) and confirm it is listed by `adb devices`. Then:

```sh
npm start          # terminal 1: Metro, the JavaScript bundler
npm run android    # terminal 2: build, install and launch the debug app
```

To build the debug APK without installing it:

```sh
cd android && ./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

## Troubleshooting

**The app says "the NetPulse native module is missing" on a phone.** The C++ build settings were cached before the module's generated code existed, so it was never compiled in. Delete the cache and rebuild:

```sh
rm -rf android/app/.cxx
npm run android
```

This happened once during development: the debug build had been configured before the module was added. A fresh clone is not affected.

**A Kotlin probe test times out.** The probe tests use real network timing on this machine. Run them on their own, not alongside `assembleRelease`, which can starve the machine of memory and CPU.

## Checks

```sh
npm run check          # everything below, in order
npm run typecheck      # tsc --noEmit (strict mode)
npm run lint           # ESLint
npm run format:check   # Prettier (npm run format to fix)
npm test               # Jest

cd android && ./gradlew :app:testDebugUnitTest   # Kotlin unit tests (run on this machine, not the phone)
```

Manual tests to run on a phone are in [docs/DEVICE_TESTING.md](docs/DEVICE_TESTING.md).

## Configuration

Every tunable value is in [src/domain/config/monitoringConfig.ts](src/domain/config/monitoringConfig.ts): the probe endpoints, timeouts, the failure threshold, check intervals, the recovery cooldown and attempt limit, and the per-session data budget. The defaults follow [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md). An invalid configuration stops the app at startup with a message saying what is wrong.

The two default endpoints are public connectivity-check addresses run by Google and Cloudflare. NetPulse does not operate them.

## Project layout

```text
index.js                      registers the app with React Native
specs/NativeNetPulse.ts       the contract between TypeScript and Kotlin (read by Codegen)
src/
  app/                        root component and providers
  theme/                      colour palettes, spacing, type scale, ThemeProvider
  domain/
    models/                   platform-agnostic types (network, probes, readings)
    config/                   monitoringConfig.ts: every tunable value
    state-machine/            the incident rules: pure functions, no I/O
  native/                     typed, validated wrapper around the Kotlin module
  features/
    monitoring/               runs the state machine: timers, native calls, lifecycle
    dashboard/                screen, view model, wording, components
  shared/                     reusable UI and formatters
android/app/src/main/java/com/netpulse/
  NetPulseModule.kt           the native module; translates only, no logic
  NetPulsePackage.kt          registers the module with React Native
  network/                    watches Android's default network
  probe/                      sends the health checks (OkHttp, which React Native already ships)
  recovery/                   the safety check before a network is reported as broken
docs/                         product spec, architecture, constraints, decisions, test guides
prompts/                      one prompt per build milestone
```

Tests live next to the code they cover: `__tests__/` folders for TypeScript, `android/app/src/test/` for Kotlin.

How the pieces fit:

1. `network/` reports what Android says about the default network.
2. `probe/` runs a round of health checks when asked and reports each outcome.
3. `domain/state-machine/` decides what those outcomes mean and what to do next. It is plain TypeScript with no access to the clock, timers or network, which is why every rule in it has a unit test.
4. `features/monitoring/` carries out those decisions and feeds results back in.
5. `features/dashboard/` turns the current state into words.

Where this differs from the tree in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md):

- `src/navigation/` does not exist. There is one screen, so no navigation library is installed.
- `src/data/` does not exist. Nothing is persisted yet.
- The monitoring loop runs in TypeScript, which is only sound because checks stop in the background. A background service would need it moved to Kotlin; see the decision document.
- `ios/` is the untouched template project. iOS is out of scope.

### Theme

The app is dark by default, whatever the phone's setting. A light theme exists and passes the same contrast tests; `ThemeProvider` accepts `preference="light"` or `"system"`. Nothing in the UI switches it yet. That belongs to the Settings screen.

### No invented values

Every dashboard value is a `Reading` (`src/domain/models/reading.ts`): either unavailable with a reason, or measured with a timestamp. A value cannot reach the screen without a measurement behind it.
