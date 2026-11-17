# Recommended Claude Code Workflow

Use one focused task at a time. Do not ask Claude to generate the whole product in a single response.

## Session 1 — Repository audit and app scaffold

- Read `CLAUDE.md` and all product/architecture docs.
- Verify RN version and template.
- Ensure the default app builds and launches on Android.
- Establish TypeScript strictness, linting, formatting, and tests.
- Create a minimal navigation/theme/dashboard shell.
- Do not add the background service yet.

## Session 2 — Native network snapshot

- Implement the smallest native bridge needed to read current default-network state.
- Subscribe to Android default-network changes.
- Add typed events/snapshot API.
- Add UI display for connected / no network / validated / unvalidated / Wi-Fi / cellular / metered.
- Test on a real device and document results.

## Session 3 — Probe and diagnosis

- Add lightweight HTTPS health probes with at least two independent endpoints.
- Add short timeouts, cancellation, and strict response checks.
- Build the incident state machine and unit tests.
- Add diagnostics bytes accounting.

## Session 4 — History and settings

- Persist incidents and settings locally.
- Build incident history, probe interval setting, failure threshold, cooldown, and daily data budget.
- Add truthful empty states and error handling.

## Session 5 — Background execution feasibility

- Research current Android FGS rules and Play policy for this exact user-visible network monitoring use case.
- Document whether an eligible foreground service type exists and whether `specialUse` is appropriate; do not assume approval.
- Decide and document either an approved service implementation or a best-effort fallback.
- Only then implement the native service and notification.

## Session 6 — Recovery and verification

- Implement `reportNetworkConnectivity()` as a hint only when repeated independent probes confirm failure.
- Add cooldown and attempt limit.
- Verify with repeated checks.
- Show exactly what the system was asked to do and whether connectivity actually returned.

## Session 7 — Hardening

- Test network loss/restoration, airplane mode toggled manually, endpoint outage, captive portal, DNS problems, metered data, app process death, user stop, reboot, force-stop, and OEM battery restrictions.
- Measure daily probe data and battery impact.
- Build release APK and document known limitations.
