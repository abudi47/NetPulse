# Claude Code Prompt — Safe Recovery Engine

Read all project instructions and the approved background-execution decision document before editing.

Implement only the safe recovery path:
- Trigger only after the incident state machine confirms repeated independent probe failures.
- Use `ConnectivityManager.reportNetworkConnectivity(network, false)` only as a hint to Android that the tested network appears broken.
- Never describe this as a modem reset or guaranteed repair.
- Add a strict cooldown, per-incident attempt limit, cancellation, and backoff.
- Verify with multiple successful probes before marking restored.
- If Android cannot perform a recovery action, record `needs_user_action` and provide a button that opens appropriate Android network settings.
- Never toggle Airplane Mode, mobile data, or radio state programmatically.
- Show the exact action and result in the dashboard/timeline.

Add unit tests and native/device test instructions. Run all checks and a debug build.
