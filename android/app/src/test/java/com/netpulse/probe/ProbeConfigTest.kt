package com.netpulse.probe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Values are written as Double because that is how JavaScript numbers arrive. */
class ProbeConfigTest {

  private val google =
      mapOf("id" to "google", "url" to "https://www.google.com/generate_204", "expectedStatus" to 204.0)
  private val cloudflare =
      mapOf(
          "id" to "cloudflare",
          "url" to "https://cp.cloudflare.com/generate_204",
          "expectedStatus" to 204.0,
      )
  private val timeouts =
      mapOf("connectTimeoutMs" to 3000.0, "readTimeoutMs" to 3000.0, "callTimeoutMs" to 5000.0)

  private fun rejects(
      endpoints: List<Any?> = listOf(google, cloudflare),
      timeouts: Map<String, Any?> = this.timeouts,
      because: String,
  ) {
    val error =
        assertThrows(IllegalArgumentException::class.java) { ProbeConfig.parse(endpoints, timeouts) }
    assertTrue("\"${error.message}\" should mention \"$because\"", error.message!!.contains(because))
  }

  @Test
  fun `a valid request is accepted`() {
    val config = ProbeConfig.parse(listOf(google, cloudflare), timeouts)

    assertEquals(listOf("google", "cloudflare"), config.endpoints.map { it.id })
    assertEquals("www.google.com", config.endpoints[0].url.host)
    assertEquals(204, config.endpoints[0].expectedStatus)
    assertEquals(ProbeTimeouts(connectMs = 3000, readMs = 3000, callMs = 5000), config.timeouts)
  }

  @Test
  fun `plain http endpoints are refused`() {
    rejects(
        endpoints = listOf(google + ("url" to "http://www.google.com/generate_204")),
        because = "must use https",
    )
  }

  @Test
  fun `endpoints need a usable url and id`() {
    rejects(endpoints = listOf(google + ("url" to "not a url")), because = "no valid URL")
    rejects(endpoints = listOf(google - "url"), because = "no valid URL")
    rejects(endpoints = listOf(google + ("id" to " ")), because = "has no id")
    rejects(endpoints = listOf("https://www.google.com"), because = "is not an object")
  }

  @Test
  fun `the expected status must be a whole 2xx number`() {
    rejects(endpoints = listOf(google + ("expectedStatus" to 302.0)), because = "expectedStatus")
    rejects(endpoints = listOf(google + ("expectedStatus" to 204.5)), because = "expectedStatus")
    rejects(endpoints = listOf(google + ("expectedStatus" to "204")), because = "expectedStatus")
    rejects(endpoints = listOf(google - "expectedStatus"), because = "expectedStatus")
  }

  @Test
  fun `endpoint ids must be unique`() {
    rejects(endpoints = listOf(google, google), because = "must be unique")
  }

  @Test
  fun `between one and five endpoints are allowed`() {
    rejects(endpoints = emptyList(), because = "1 to 5")
    rejects(endpoints = (1..6).map { google + ("id" to "e$it") }, because = "1 to 5")
  }

  @Test
  fun `timeouts must be present, whole and within bounds`() {
    rejects(timeouts = timeouts + ("connectTimeoutMs" to 100.0), because = "connectTimeoutMs")
    rejects(timeouts = timeouts + ("readTimeoutMs" to 60_000.0), because = "readTimeoutMs")
    rejects(timeouts = timeouts - "callTimeoutMs", because = "callTimeoutMs")
    rejects(timeouts = timeouts + ("callTimeoutMs" to Double.NaN), because = "callTimeoutMs")
    rejects(timeouts = timeouts + ("callTimeoutMs" to 2500.5), because = "callTimeoutMs")
  }

  @Test
  fun `the overall limit cannot be shorter than the connect limit`() {
    rejects(
        timeouts = timeouts + ("connectTimeoutMs" to 5000.0) + ("callTimeoutMs" to 3000.0),
        because = "must not be shorter",
    )
  }
}
