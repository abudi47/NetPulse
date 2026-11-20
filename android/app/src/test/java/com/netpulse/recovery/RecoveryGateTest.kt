package com.netpulse.recovery

import org.junit.Assert.assertEquals
import org.junit.Test

class RecoveryGateTest {

  @Test
  fun `a network whose latest round failed every check may be reported`() {
    assertEquals(
        RecoveryOutcome.REQUESTED,
        RecoveryGate.check(
            lastProbedNetworkId = 7, lastRoundFailedEveryCheck = true, activeNetworkId = 7),
    )
  }

  @Test
  fun `nothing is reported when there is no network`() {
    assertEquals(
        RecoveryOutcome.NO_NETWORK,
        RecoveryGate.check(
            lastProbedNetworkId = 7, lastRoundFailedEveryCheck = true, activeNetworkId = null),
    )
  }

  @Test
  fun `nothing is reported before any probe round has run`() {
    assertEquals(
        RecoveryOutcome.NOT_CONFIRMED,
        RecoveryGate.check(
            lastProbedNetworkId = null, lastRoundFailedEveryCheck = false, activeNetworkId = 7),
    )
  }

  @Test
  fun `a different network from the one that failed is never reported`() {
    assertEquals(
        RecoveryOutcome.NETWORK_CHANGED,
        RecoveryGate.check(
            lastProbedNetworkId = 7, lastRoundFailedEveryCheck = true, activeNetworkId = 8),
    )
  }

  @Test
  fun `a network is not reported if any probe of the latest round succeeded`() {
    assertEquals(
        RecoveryOutcome.NOT_CONFIRMED,
        RecoveryGate.check(
            lastProbedNetworkId = 7, lastRoundFailedEveryCheck = false, activeNetworkId = 7),
    )
  }

  @Test
  fun `the names sent to TypeScript are stable`() {
    assertEquals(
        listOf("requested", "no_network", "network_changed", "not_confirmed", "failed"),
        RecoveryOutcome.values().map { it.wireName },
    )
  }
}
