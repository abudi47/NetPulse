package com.netpulse.probe

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * A probe request from TypeScript, checked before anything is sent.
 *
 * TypeScript types are not enforced at runtime, so everything arriving over
 * the bridge is validated here. [parse] takes plain Kotlin collections rather
 * than React Native types so that it can be unit-tested on a laptop.
 */
data class ProbeConfig(val endpoints: List<ProbeEndpoint>, val timeouts: ProbeTimeouts) {

  companion object {
    const val MIN_TIMEOUT_MS = 500L
    const val MAX_TIMEOUT_MS = 15_000L

    /** @throws IllegalArgumentException describing the first problem found. */
    fun parse(endpoints: List<Any?>, timeouts: Map<String, Any?>): ProbeConfig {
      require(endpoints.size in 1..ProbeEngine.MAX_ENDPOINTS) {
        "Expected 1 to ${ProbeEngine.MAX_ENDPOINTS} probe endpoints, got ${endpoints.size}"
      }
      val parsed = endpoints.mapIndexed { index, raw -> parseEndpoint(index, raw) }
      require(parsed.map { it.id }.toSet().size == parsed.size) {
        "Probe endpoint ids must be unique"
      }

      val connectMs = timeout(timeouts, "connectTimeoutMs")
      val readMs = timeout(timeouts, "readTimeoutMs")
      val callMs = timeout(timeouts, "callTimeoutMs")
      require(callMs >= connectMs) { "callTimeoutMs must not be shorter than connectTimeoutMs" }

      return ProbeConfig(parsed, ProbeTimeouts(connectMs, readMs, callMs))
    }

    private fun parseEndpoint(index: Int, raw: Any?): ProbeEndpoint {
      val map = raw as? Map<*, *> ?: throw IllegalArgumentException("Endpoint $index is not an object")

      val id = map["id"] as? String
      require(!id.isNullOrBlank()) { "Endpoint $index has no id" }

      val url = (map["url"] as? String)?.toHttpUrlOrNull()
      require(url != null) { "Endpoint \"$id\" has no valid URL" }
      require(url.isHttps) { "Endpoint \"$id\" must use https" }

      val expectedStatus = wholeNumber(map["expectedStatus"])
      require(expectedStatus != null && expectedStatus in 200..299) {
        "Endpoint \"$id\" needs an expectedStatus between 200 and 299"
      }

      return ProbeEndpoint(id, url, expectedStatus.toInt())
    }

    private fun timeout(timeouts: Map<String, Any?>, key: String): Long {
      val value = wholeNumber(timeouts[key])
      require(value != null && value in MIN_TIMEOUT_MS..MAX_TIMEOUT_MS) {
        "$key must be between $MIN_TIMEOUT_MS and $MAX_TIMEOUT_MS milliseconds"
      }
      return value
    }

    /** JavaScript numbers arrive as Double; accept only finite whole ones. */
    private fun wholeNumber(value: Any?): Long? {
      val number = (value as? Number)?.toDouble() ?: return null
      if (number.isNaN() || number.isInfinite() || number != Math.floor(number)) return null
      return number.toLong()
    }
  }
}
