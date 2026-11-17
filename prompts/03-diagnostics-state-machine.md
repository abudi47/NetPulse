# Claude Code Prompt — Lightweight Diagnostics and Incident State Machine

Read `CLAUDE.md`, `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, and `ANDROID_CONSTRAINTS.md`.

Implement a low-data health-check engine and pure, unit-tested incident state machine. Start with the app in foreground; do not add long-running background execution in this task.

Requirements:
- At least two independently operated HTTPS probe endpoints, configurable in one place.
- Strict expected response semantics; detect redirects/captive portal-like behavior separately from expected responses.
- Bounded connect/read/call timeouts, cancellation, one in-flight probe round, and no large downloads.
- Distinguish network absent, Android not validated, successful probe, timeout, DNS/TLS error, unexpected response, and endpoint-only failure when evidence allows.
- Require 3 consecutive failed rounds across independent endpoints before declaring an incident.
- Implement cooldown, max recovery-attempt count, and recovery verification as pure testable logic. Do not invoke actual recovery yet.
- Track approximate bytes used by diagnostics if reliable; label estimates accurately.
- Never launch a full Fast.com test or use undocumented Fast.com/Netflix endpoints.

Add tests for single endpoint outage, all endpoints failing, transient failure, cooldown, attempt limit, restored connectivity, and cancellation. Run tests and report results.
