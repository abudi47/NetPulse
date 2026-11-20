package com.netpulse.probe

import okhttp3.HttpUrl

/*
 * Plain data for health probes. Nothing here touches Android classes, so the
 * probe engine can be unit-tested on a laptop.
 */

/** One place to ask "is the internet reachable?": a URL and the exact status it must answer with. */
data class ProbeEndpoint(val id: String, val url: HttpUrl, val expectedStatus: Int)

/**
 * Time limits for one probe. `callMs` covers the whole request. A DNS lookup
 * cannot be interrupted, so a probe stuck in one is abandoned by [ProbeEngine]
 * up to [ProbeEngine.MAX_OVERRUN_MS] after `callMs` and reported as a timeout.
 */
data class ProbeTimeouts(val connectMs: Long, val readMs: Long, val callMs: Long)

/** What happened to one probe. `wireName` is the string sent to TypeScript. */
enum class ProbeOutcome(val wireName: String) {
  /** The endpoint answered with exactly the expected status. */
  SUCCESS("success"),
  /** It answered, but with a different status (e.g. a sign-in page's 200). */
  UNEXPECTED_STATUS("unexpected_status"),
  /** It answered with a redirect, which probes never follow. Typical of captive portals. */
  REDIRECT("redirect"),
  /** No answer within the time limit. */
  TIMEOUT("timeout"),
  /** The host name could not be resolved. */
  DNS_ERROR("dns_error"),
  /** The secure connection could not be established or verified. */
  TLS_ERROR("tls_error"),
  /** The server could not be reached at the network level. */
  CONNECT_ERROR("connect_error"),
  /** Some other failure while sending or receiving. */
  IO_ERROR("io_error"),
  /** The probe was cancelled before it finished. */
  CANCELLED("cancelled"),
}

data class ProbeResult(
    val endpointId: String,
    val outcome: ProbeOutcome,
    /** The HTTP status, when the endpoint answered at all. */
    val httpStatus: Int?,
    /** Wall time from starting the probe to its outcome, DNS and TLS included. */
    val durationMs: Long,
)

/** The result of probing every endpoint once. */
data class ProbeRound(
    /** False when there was no default network, in which case nothing was sent. */
    val hadNetwork: Boolean,
    /** True when the default network changed while probing, so results may mix two networks. */
    val networkChanged: Boolean,
    val startedAtMs: Long,
    val finishedAtMs: Long,
    val results: List<ProbeResult>,
    /**
     * Bytes Android counted for this app while the round ran (sent + received),
     * or null if the device does not report it. Approximate: it includes any
     * other traffic the app made in the same moment.
     */
    val bytesUsed: Long?,
)
