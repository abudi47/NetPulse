package com.netpulse.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Runs on the build machine (no phone needed): ./gradlew :app:testDebugUnitTest */
class DefaultNetworkTrackerTest {

  private var clock = 1_000L
  private val tracker = DefaultNetworkTracker { clock }

  private val wifi =
      CapabilityFacts(
          transport = Transport.WIFI,
          isVpn = false,
          validated = true,
          internetCapable = true,
          captivePortal = false,
          metered = false,
      )
  private val cellular = wifi.copy(transport = Transport.CELLULAR, metered = true)

  @Test
  fun `starting with no network reports no network`() {
    val snapshot = tracker.start(networkId = null, facts = null)

    assertFalse(snapshot.hasNetwork)
    assertNull(snapshot.facts)
    assertEquals(ChangeCause.SNAPSHOT, snapshot.cause)
    assertEquals(1_000L, snapshot.capturedAtMs)
  }

  @Test
  fun `starting with no network ignores stray capability facts`() {
    val snapshot = tracker.start(networkId = null, facts = wifi)

    assertFalse(snapshot.hasNetwork)
    assertNull(snapshot.facts)
  }

  @Test
  fun `Android re-announcing the network read at start reports nothing new`() {
    tracker.start(networkId = 1, facts = wifi)

    tracker.onAvailable(1)

    assertNull(tracker.awaitingCapabilities)
    assertNull(tracker.onCapabilities(1, wifi))
    assertEquals(wifi, tracker.snapshot().facts)
  }

  @Test
  fun `a new network is reported once Android describes it`() {
    tracker.start(networkId = null, facts = null)

    tracker.onAvailable(1)
    assertEquals(1L, tracker.awaitingCapabilities)
    clock = 2_000L
    val snapshot = tracker.onCapabilities(1, wifi)

    assertEquals(NetworkSnapshot(true, wifi, 2_000L, ChangeCause.AVAILABLE), snapshot)
    assertNull(tracker.awaitingCapabilities)
  }

  @Test
  fun `on Android 7 a new network is reported from the fallback read`() {
    tracker.start(networkId = null, facts = null)
    tracker.onAvailable(1)

    val snapshot = tracker.onCapabilitiesUnreported(1, cellular)

    assertEquals(NetworkSnapshot(true, cellular, 1_000L, ChangeCause.AVAILABLE), snapshot)
  }

  @Test
  fun `a network Android never describes is reported with unknown facts, not false ones`() {
    tracker.start(networkId = null, facts = null)
    tracker.onAvailable(1)

    val snapshot = tracker.onCapabilitiesUnreported(1, fallbackFacts = null)

    assertTrue(snapshot!!.hasNetwork)
    assertNull(snapshot.facts)
    assertEquals(ChangeCause.AVAILABLE, snapshot.cause)
  }

  @Test
  fun `the fallback read is ignored when Android already described the network`() {
    tracker.start(networkId = null, facts = null)
    tracker.onAvailable(1)
    tracker.onCapabilities(1, wifi)

    assertNull(tracker.onCapabilitiesUnreported(1, cellular))
    assertEquals(wifi, tracker.snapshot().facts)
  }

  @Test
  fun `a change in validation is reported as a capability change`() {
    tracker.start(networkId = 1, facts = wifi)

    val snapshot = tracker.onCapabilities(1, wifi.copy(validated = false))

    assertEquals(ChangeCause.CAPABILITIES_CHANGED, snapshot!!.cause)
    assertFalse(snapshot.facts!!.validated)
  }

  @Test
  fun `repeated identical capabilities are reported only once`() {
    tracker.start(networkId = 1, facts = wifi)
    tracker.onCapabilities(1, wifi.copy(validated = false))

    assertNull(tracker.onCapabilities(1, wifi.copy(validated = false)))
  }

  @Test
  fun `switching networks without a loss reports the new network`() {
    tracker.start(networkId = 1, facts = wifi)

    tracker.onAvailable(2)
    val snapshot = tracker.onCapabilities(2, cellular)

    assertEquals(ChangeCause.AVAILABLE, snapshot!!.cause)
    assertEquals(cellular, snapshot.facts)
  }

  @Test
  fun `capabilities for a network that is no longer the default are ignored`() {
    tracker.start(networkId = 1, facts = wifi)
    tracker.onAvailable(2)
    tracker.onCapabilities(2, cellular)

    assertNull(tracker.onCapabilities(1, wifi.copy(validated = false)))
    assertEquals(cellular, tracker.snapshot().facts)
  }

  @Test
  fun `a new network clears the previous network's facts until it is described`() {
    tracker.start(networkId = 1, facts = wifi)

    tracker.onAvailable(2)

    assertTrue(tracker.snapshot().hasNetwork)
    assertNull(tracker.snapshot().facts)
  }

  @Test
  fun `losing the default network reports no network`() {
    tracker.start(networkId = 1, facts = wifi)
    clock = 3_000L

    val snapshot = tracker.onLost(1)

    assertEquals(NetworkSnapshot(false, null, 3_000L, ChangeCause.LOST), snapshot)
  }

  @Test
  fun `losing a network that is not the default changes nothing`() {
    tracker.start(networkId = 2, facts = cellular)

    assertNull(tracker.onLost(1))
    assertTrue(tracker.snapshot().hasNetwork)
  }

  @Test
  fun `losing a network before it was described still reports the loss`() {
    tracker.start(networkId = null, facts = null)
    tracker.onAvailable(1)

    val snapshot = tracker.onLost(1)

    assertEquals(ChangeCause.LOST, snapshot!!.cause)
    assertNull(tracker.awaitingCapabilities)
  }

  @Test
  fun `a direct read does not disturb what is tracked`() {
    tracker.start(networkId = 1, facts = wifi)

    val read = tracker.snapshot()

    assertEquals(ChangeCause.SNAPSHOT, read.cause)
    assertNull(tracker.onCapabilities(1, wifi))
  }
}
