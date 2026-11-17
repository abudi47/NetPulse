# Claude Code Prompt — Assess Background Monitoring Before Implementing It

Do not write service code yet.

Research the current official Android documentation and Google Play policy for continuous, user-started mobile network monitoring. This is a core app feature, but it must comply with Android's foreground-service rules.

Deliver:
1. Which background execution options are legally/technically available for this use case.
2. Whether a foreground service type legitimately fits this exact network-monitoring feature. Do not assume `specialUse` is automatically acceptable.
3. Exact manifest declarations and runtime behavior required if eligible.
4. Whether Google Play requires a declaration/review and what evidence the app must provide.
5. How Android 12+ background start restrictions, Android 14+ service types, boot behavior, Doze, OEM battery management, and user-stop controls affect it.
6. A comparison of an approved persistent service versus a best-effort mode using callbacks while the process is active and WorkManager for coarse work (minimum 15-minute periodic interval).
7. A recommendation with explicit limitations and user-visible UX.

Cite official sources with URLs and access dates in `docs/ANDROID_BACKGROUND_DECISION.md`. If policy fit is uncertain, say so and do not implement a questionable service type. No hacks, root, Airplane Mode toggling, or hidden APIs.
