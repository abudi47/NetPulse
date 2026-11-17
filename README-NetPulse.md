# NetPulse — Claude-ready React Native starter kit

NetPulse is an Android-first mobile network reliability assistant. It monitors connectivity, diagnoses failures with lightweight probes, and attempts only recovery actions that Android permits to ordinary applications.

## Important product boundary

NetPulse is **not** a guaranteed 24/7 modem reset tool. Ordinary Android apps cannot silently toggle Airplane Mode or restart the cellular radio. Android may also stop or defer background work. A persistent foreground monitoring service may be possible for this user-visible core feature, but the correct foreground-service type and Google Play declaration must be verified before implementation/release. See `docs/ANDROID_CONSTRAINTS.md`.

## Technology direction

- React Native 0.88.1, TypeScript, Android-first.
- React Native Community CLI (bare/native project), not Expo Go.
- Kotlin only for the small Android integration layer that needs Android system APIs. Claude generates and maintains this code; the app UI and most product logic remain TypeScript.
- No backend for MVP. Store settings and event history locally.
- Use a typed Turbo Native Module (New Architecture) for the JS/native boundary, unless Claude verifies a current 0.88.1 compatibility issue and documents a justified alternative.

## Suggested development environment

The project can be developed on Linux/Kali. Current React Native 0.88 compatibility information lists Node 22.13+ (or supported newer lines), JDK 17, Android SDK compile 37, target 36, and Gradle 9.4.1. Re-check the compatibility matrix before installing/upgrading tools: https://reactnative.dev/versions

Install:
1. Node.js 22.13+ (use an LTS line supported by the current compatibility matrix).
2. JDK 17.
3. Android Studio and Android SDK / Platform Tools.
4. Android SDK Platform 37 and the SDK components required by the selected RN template.
5. A physical Android phone with USB debugging enabled; use an emulator for UI tests, but cellular failure tests need a real phone/SIM.

## Create the React Native project

From the directory where you keep projects:

```bash
npx @react-native-community/cli@latest init NetPulse --version 0.88.1
cd NetPulse
```

Copy this starter kit's `CLAUDE.md`, `docs/`, and `prompts/` into the generated `NetPulse/` project root. Then open that folder in Claude Code.

Run the base app:

```bash
# Start Metro in terminal 1
npm start

# Build/install Android app in terminal 2
npm run android
```

If the generated template's scripts differ, follow its `package.json` and current React Native docs rather than assuming these names.

## Android SDK environment on Linux

The Android SDK path depends on where Android Studio installed it. A common default is `$HOME/Android/Sdk`.

Add to `~/.bashrc` or `~/.zshrc` (edit the path if yours differs):

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin"
```

Then reload the shell and verify:

```bash
source ~/.bashrc
java -version
node --version
npm --version
adb version
adb devices
```

If `adb devices` shows `unauthorized`, unlock the phone and accept the USB debugging prompt.

## How to use this kit with Claude

1. Create the React Native project using the command above.
2. Put `CLAUDE.md` and the `docs/` folder at the project root.
3. Open the project root in Claude Code.
4. Paste `prompts/01-bootstrap-and-audit.md` as the first task.
5. Ask Claude to work in small phases, run builds/tests, and report exact commands and results.
6. Do not ask Claude to implement background monitoring and UI all at once. Get the app building first, then add each native capability separately.

## Suggested first milestone

A buildable Android app with a polished dashboard, a real connectivity snapshot, manual start/stop, live network-state events, low-data HTTP health checks, and local diagnostic history. Background monitoring and recovery must only be enabled after the Android service type/policy constraints have been assessed and tested.
