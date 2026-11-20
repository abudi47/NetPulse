package com.netpulse.network

/*
 * Plain data describing the phone's default network.
 *
 * Nothing in this file touches Android classes, so the logic that uses it
 * (DefaultNetworkTracker) can be unit-tested on a laptop without a phone.
 */

/** How the network physically connects. `wireName` is the string sent to TypeScript. */
enum class Transport(val wireName: String) {
  WIFI("wifi"),
  CELLULAR("cellular"),
  ETHERNET("ethernet"),
  BLUETOOTH("bluetooth"),
  VPN("vpn"),
  OTHER("other"),
}

/** Why a snapshot was produced. `wireName` is the string sent to TypeScript. */
enum class ChangeCause(val wireName: String) {
  /** A direct read, not a change. */
  SNAPSHOT("snapshot"),
  /** A network became the default network. */
  AVAILABLE("available"),
  /** The default network is the same, but something about it changed. */
  CAPABILITIES_CHANGED("capabilities_changed"),
  /** The default network went away and nothing replaced it. */
  LOST("lost"),
}

/** The parts of Android's NetworkCapabilities that NetPulse reports. */
data class CapabilityFacts(
    val transport: Transport,
    val isVpn: Boolean,
    /** Android's own connectivity check passed (NET_CAPABILITY_VALIDATED). */
    val validated: Boolean,
    /** The network is set up for internet access (NET_CAPABILITY_INTERNET). */
    val internetCapable: Boolean,
    /** Android detected a sign-in page (NET_CAPABILITY_CAPTIVE_PORTAL). */
    val captivePortal: Boolean,
    /** Android does not mark the network as unmetered. */
    val metered: Boolean,
)

/**
 * The default network at one moment.
 *
 * `facts == null` while `hasNetwork` is true means Android has not reported
 * the network's capabilities: they are unknown, not false.
 */
data class NetworkSnapshot(
    val hasNetwork: Boolean,
    val facts: CapabilityFacts?,
    val capturedAtMs: Long,
    val cause: ChangeCause,
)
