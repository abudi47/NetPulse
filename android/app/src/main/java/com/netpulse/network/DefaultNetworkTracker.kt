package com.netpulse.network

/**
 * Turns Android's stream of network callbacks into NetPulse snapshots.
 *
 * Android reports the default network as separate events (a network became
 * available, its capabilities changed, it was lost). This class remembers which
 * network is current and decides when there is something new worth telling
 * TypeScript. It holds no Android objects: networks are identified by a number
 * that never leaves this process.
 *
 * Not thread-safe. DefaultNetworkObserver calls it from a single thread.
 */
class DefaultNetworkTracker(private val now: () -> Long) {

  private var networkId: Long? = null
  private var facts: CapabilityFacts? = null

  /** False from "a new default network appeared" until the first snapshot reporting it. */
  private var announced = true

  /** The current state, for a direct read. */
  fun snapshot(): NetworkSnapshot = snapshot(ChangeCause.SNAPSHOT)

  /** Sets the starting state from a direct read, taken just before callbacks are registered. */
  fun start(networkId: Long?, facts: CapabilityFacts?): NetworkSnapshot {
    this.networkId = networkId
    this.facts = if (networkId == null) null else facts
    announced = true
    return snapshot(ChangeCause.SNAPSHOT)
  }

  /**
   * A network became the default. Nothing is reported yet: its capabilities
   * arrive separately, either from Android or from [onCapabilitiesUnreported].
   */
  fun onAvailable(id: Long) {
    if (id == networkId) return // Already known, e.g. from the starting read.
    networkId = id
    facts = null
    announced = false
  }

  /** Android reported capabilities. Returns a snapshot only if something NetPulse reports changed. */
  fun onCapabilities(id: Long, newFacts: CapabilityFacts): NetworkSnapshot? {
    if (id != networkId) return null // About a network that is not, or is no longer, the default.
    if (announced && newFacts == facts) return null // E.g. only signal strength changed.
    facts = newFacts
    val cause = if (announced) ChangeCause.CAPABILITIES_CHANGED else ChangeCause.AVAILABLE
    announced = true
    return snapshot(cause)
  }

  /**
   * The network that Android has announced but not yet described, if any.
   * Android 8+ always describes a network right after announcing it; Android 7
   * does not, so the observer checks this and reads the capabilities itself.
   */
  val awaitingCapabilities: Long?
    get() = if (announced) null else networkId

  /**
   * Android did not follow "available" with capabilities, so the observer read
   * them directly. `fallbackFacts` is null if that read returned nothing.
   */
  fun onCapabilitiesUnreported(id: Long, fallbackFacts: CapabilityFacts?): NetworkSnapshot? {
    if (id != networkId || announced) return null
    facts = fallbackFacts
    announced = true
    return snapshot(ChangeCause.AVAILABLE)
  }

  /** The default network went away with nothing to replace it. */
  fun onLost(id: Long): NetworkSnapshot? {
    if (id != networkId) return null
    networkId = null
    facts = null
    announced = true
    return snapshot(ChangeCause.LOST)
  }

  private fun snapshot(cause: ChangeCause) =
      NetworkSnapshot(
          hasNetwork = networkId != null,
          facts = facts,
          capturedAtMs = now(),
          cause = cause,
      )
}
