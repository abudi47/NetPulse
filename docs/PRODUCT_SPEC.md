# NetPulse Product Specification

## 1. Product summary

NetPulse is an Android-first mobile network monitoring and recovery assistant. It addresses a common experience: mobile data is enabled and the phone appears connected, but apps cannot reach the internet until the user manually toggles Airplane Mode or otherwise reconnects.

The application does not control the cellular modem directly. It detects likely failures, gathers evidence, requests permitted Android network reevaluation, and verifies whether connectivity returns.

## 2. Product mission

Reduce the need for manual intervention when mobile internet becomes unresponsive, while keeping diagnostic traffic small and transparent.

## 3. Target user

Android users who frequently experience unreliable mobile data, especially where cellular coverage or operator connectivity is inconsistent.

## 4. MVP goals

- Detect default network availability and changes.
- Identify whether Android reports internet validation.
- Independently probe actual HTTPS reachability.
- Classify common failures conservatively.
- Confirm repeated failures before declaring an incident.
- Attempt safe, permitted recovery actions.
- Verify recovery with repeated successful probes.
- Show monitoring status, incident history, and diagnostic data use.
- Work without an application backend.

## 5. Non-goals / out of scope

- Silently turning Airplane Mode on/off.
- Restarting or power-cycling the cellular modem.
- Bypassing Android permissions, root, privileged APIs, or OEM controls.
- Guaranteeing 24/7 execution on every Android device.
- Running a full speed test continuously.
- Automatically downloading large files.
- iOS support in the first release.
- Cloud account, user tracking, advertising, or server-side analytics in MVP.

## 6. User stories

1. As a user, I can start monitoring from the app and see that monitoring is active.
2. As a user, I can stop monitoring immediately from the app and notification.
3. As a user, I can see whether the phone has a network, whether Android validates internet, and whether independent probes succeed.
4. As a user, I receive a clear incident status when internet becomes unavailable.
5. As a user, the app attempts only safe recovery actions and tells me what it tried.
6. As a user, I can see whether connectivity was restored and how long the incident lasted.
7. As a user, I can set probe frequency, failure threshold, cooldown, and diagnostic data budget within safe bounds.
8. As a user, I can review diagnostic data consumption and pause automatic diagnostics.

## 7. Proposed initial defaults (to be validated on device)

- Event-driven network monitoring as the primary trigger.
- Low-data health-check interval: 60 seconds while an approved monitoring session is active; configurable after battery/data tests.
- Probe timeout: 4–5 seconds.
- Confirm an incident after 3 consecutive failed probe rounds, using at least 2 independent endpoints.
- Recovery cooldown: 60 seconds.
- Maximum automated recovery requests per incident: 3.
- Recovery verification: 3 successful probe rounds.
- Full speed test: disabled by default and excluded from MVP.

These are starting values, not performance guarantees. Tune after measuring battery/data consumption on real devices.

## 8. Incident states

- `idle`: monitoring stopped.
- `monitoring`: active network observation.
- `checking`: diagnostic request in progress.
- `healthy`: multiple valid probes succeeded.
- `suspected_failure`: one or more failures, not yet confirmed.
- `incident`: failure threshold reached.
- `recovering`: an allowed recovery action is being attempted.
- `verifying`: checking if connectivity returned.
- `degraded`: some endpoints work, some do not, or latency is poor.
- `no_network`: no active default network.
- `needs_user_action`: only a user-controlled system setting or action could help.
- `cooldown`: waiting before another permitted attempt.

## 9. MVP acceptance criteria

- A clean install builds and launches on a supported Android device.
- Start/Stop monitoring works and UI reflects native state.
- Network default/capability changes are surfaced without blocking Android callback threads.
- A failed single endpoint does not by itself trigger recovery.
- Three consecutive failed rounds across independent probes create an incident (threshold configurable).
- All probes have bounded timeouts and small response bodies.
- Recovery action is logged with a reason and timestamp.
- Recovery is only marked successful after multiple successful checks.
- Stop monitoring unregisters callbacks, cancels work, and stops any eligible service/notification.
- No fake speed, ping, uptime, or recovery-success values are shown.
- Unit tests cover state transitions, retry limits, cooldown, and recovery verification.

## 10. Product metrics (local only for MVP)

- Successful probe ratio.
- Time from detected outage to restored connectivity.
- Recovery attempts per incident.
- Recovery verification success rate.
- Data bytes used by diagnostics.
- Monitoring session duration.

Do not upload these metrics by default.
