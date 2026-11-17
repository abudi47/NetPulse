# First Claude Code Prompt — Bootstrap NetPulse

You are working in the root of a newly created React Native 0.88.1 project named `NetPulse`.

First read `CLAUDE.md`, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/ANDROID_CONSTRAINTS.md` completely.

My background is full-stack JavaScript/TypeScript. I chose React Native because I do not know Kotlin. You may generate Kotlin code only when Android native APIs require it, but explain what each native file does and keep the app UI/product logic in TypeScript. Do not ask me to write Kotlin manually.

## Your task in this session

1. Audit the repository and report the installed React Native, React, Gradle, Android Gradle Plugin, Kotlin, JDK, Node, and Android SDK versions you can verify.
2. Check compatibility with React Native 0.88.1 using official documentation. Do not blindly upgrade dependencies.
3. Make sure the untouched starter project builds and launches on Android. If the environment does not have Android SDK/device access, say exactly what is missing and still complete source-level checks.
4. Set up a clean, maintainable TypeScript project structure for NetPulse, including a minimal dashboard shell with a dark-first theme and optional light theme only if it can be done without unnecessary dependencies.
5. Add basic lint/type-check/test scripts only when supported by the generated template; keep dependencies minimal.
6. Do not implement the monitoring service, foreground service, recovery, Airplane Mode controls, speed testing, or speculative native APIs in this first session.
7. Add/update a concise project README with verified setup and run commands.

## Design direction

The dashboard should feel like a polished network utility, not a generic starter template. Use a restrained dark palette, clear typography, readable contrast, one prominent monitoring status/control, current network information placeholders clearly labelled as unavailable until real data is connected, and a small recent-activity section. Do not fabricate ping, speed, signal, uptime, or recovery metrics.

## Acceptance criteria

- The project builds successfully or the exact environment blocker is documented.
- The app launches to a NetPulse dashboard.
- TypeScript has no newly introduced type errors.
- There are no unused permissions or background services.
- No fake network readings are displayed.
- End with changed files, commands actually run, results, remaining blockers, and the recommended next task.

Work incrementally. Inspect first; then plan; then edit. Do not dump a large amount of code without testing it.
