package com.netpulse.recovery

/** What happened when NetPulse was asked to report a network as broken. */
enum class RecoveryOutcome(val wireName: String) {
  /** Android was told the network appears to have no connectivity. A hint, nothing more. */
  REQUESTED("requested"),
  /** There is no default network to report. */
  NO_NETWORK("no_network"),
  /** The default network is no longer the one the failed checks ran on. */
  NETWORK_CHANGED("network_changed"),
  /** The latest probe round did not show this network failing every check. */
  NOT_CONFIRMED("not_confirmed"),
  /** Android rejected the call. */
  FAILED("failed"),
}

/**
 * The last line of defence before a network is reported as broken.
 *
 * TypeScript decides *when* to ask (after repeated failed rounds, respecting
 * cooldown and attempt limits). This check is independent of that logic: even
 * if TypeScript asked by mistake, a network is only ever reported when this
 * device's own latest probe round, on that same network, failed every check.
 *
 * Plain Kotlin, so it is unit-tested on a laptop.
 */
object RecoveryGate {

  /**
   * @param lastProbedNetworkId the network the latest completed round ran on, or null if none has
   * @param lastRoundFailedEveryCheck true only if that round was conclusive and no probe succeeded
   * @param activeNetworkId the current default network, or null if there is none
   * @return [RecoveryOutcome.REQUESTED] if reporting may go ahead, otherwise the reason it may not
   */
  fun check(
      lastProbedNetworkId: Long?,
      lastRoundFailedEveryCheck: Boolean,
      activeNetworkId: Long?,
  ): RecoveryOutcome =
      when {
        activeNetworkId == null -> RecoveryOutcome.NO_NETWORK
        lastProbedNetworkId == null -> RecoveryOutcome.NOT_CONFIRMED
        lastProbedNetworkId != activeNetworkId -> RecoveryOutcome.NETWORK_CHANGED
        !lastRoundFailedEveryCheck -> RecoveryOutcome.NOT_CONFIRMED
        else -> RecoveryOutcome.REQUESTED
      }
}
