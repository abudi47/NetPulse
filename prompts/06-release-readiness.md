# Claude Code Prompt — NetPulse Release Readiness

Review the entire app against `CLAUDE.md`, all docs, and MVP acceptance criteria.

Check:
- Android permissions are minimal and justified.
- Any foreground service uses a verified valid type, truthful notification, explicit user start, Stop action, and Play declaration readiness.
- No hidden API, root, accessibility workaround, Airplane Mode toggling, or false 24/7 guarantee exists.
- Probes have bounded size/timeouts, endpoint independence, cancellation, backoff, and data accounting.
- No fake dashboard values.
- Service/callback/listener lifecycle is correct through app backgrounding and process death.
- App behavior after force-stop, reboot, notification Stop, battery optimization, and OEM restrictions is documented.
- Tests cover state machine and major failure paths.
- Debug and release builds work.

Create `docs/RELEASE_CHECKLIST.md` with verified items, failed items, unresolved policy decisions, known limitations, device matrix, and exact build commands. Do not mark a check as passed unless you actually ran it or have evidence.
