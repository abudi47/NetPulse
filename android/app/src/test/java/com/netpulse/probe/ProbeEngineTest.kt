package com.netpulse.probe

import java.io.Closeable
import java.io.IOException
import java.io.InterruptedIOException
import java.io.OutputStream
import java.net.ConnectException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import kotlin.concurrent.thread
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Exercises the probe engine against a small web server started inside the
 * test. Runs on the build machine: ./gradlew :app:testDebugUnitTest
 *
 * The test server speaks plain HTTP, which the engine itself allows; the
 * https-only rule is enforced one layer up, in ProbeConfig.
 */
class ProbeEngineTest {

  private lateinit var server: TestServer
  private val engine = ProbeEngine()
  private val timeouts = ProbeTimeouts(connectMs = 1_000, readMs = 1_000, callMs = 2_000)

  @Before
  fun startServer() {
    server =
        TestServer(
            mapOf(
                "/generate_204" to { out -> out.respond("204 No Content") },
                "/page" to
                    { out ->
                      out.respond("200 OK", "<html>Sign in to continue</html>".toByteArray())
                    },
                "/redirect" to
                    { out ->
                      out.respond("302 Found", extraHeader = "Location: /generate_204")
                    },
                "/slow" to
                    { out ->
                      Thread.sleep(1_500)
                      out.respond("204 No Content")
                    },
                "/delayed" to
                    { out ->
                      Thread.sleep(300)
                      out.respond("204 No Content")
                    },
                "/huge" to
                    { out ->
                      // Promises a megabyte, sends a little, then stalls before the rest.
                      out.write(
                          "HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\n\r\n".toByteArray())
                      out.write(ByteArray(1_024))
                      out.flush()
                      Thread.sleep(1_500)
                      out.write(ByteArray(1_000_000 - 1_024))
                    },
            ))
  }

  @After
  fun stopServer() {
    server.close()
  }

  private fun endpoint(id: String, path: String, expectedStatus: Int = 204) =
      ProbeEndpoint(id, "http://127.0.0.1:${server.port}$path".toHttpUrl(), expectedStatus)

  private fun probe(vararg endpoints: ProbeEndpoint, timeouts: ProbeTimeouts = this.timeouts) =
      engine.runRound(endpoints.toList(), timeouts)

  private fun dns(lookup: (String) -> List<InetAddress>) =
      object : Dns {
        override fun lookup(hostname: String) = lookup(hostname)
      }

  @Test
  fun `the exact expected status is a success`() {
    val result = probe(endpoint("a", "/generate_204")).single()

    assertEquals("a", result.endpointId)
    assertEquals(ProbeOutcome.SUCCESS, result.outcome)
    assertEquals(204, result.httpStatus)
    assertTrue(result.durationMs >= 0)
  }

  @Test
  fun `a different 2xx status is not a success`() {
    val result = probe(endpoint("a", "/page")).single()

    assertEquals(ProbeOutcome.UNEXPECTED_STATUS, result.outcome)
    assertEquals(200, result.httpStatus)
  }

  @Test
  fun `a redirect is reported and never followed`() {
    val result = probe(endpoint("a", "/redirect")).single()

    assertEquals(ProbeOutcome.REDIRECT, result.outcome)
    assertEquals(302, result.httpStatus)
    assertEquals("the redirect target must not be requested", 0, server.hits("/generate_204"))
  }

  @Test
  fun `an endpoint that does not answer in time is a timeout, within the call limit`() {
    val startedAt = System.nanoTime()

    val result =
        probe(
                endpoint("a", "/slow"),
                timeouts = ProbeTimeouts(connectMs = 500, readMs = 500, callMs = 700),
            )
            .single()

    val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000
    assertEquals(ProbeOutcome.TIMEOUT, result.outcome)
    assertNull(result.httpStatus)
    assertTrue("took $elapsedMs ms", elapsedMs < 1_400)
  }

  @Test
  fun `a refused connection is a connection error`() {
    val closedPort = ServerSocket(0).use { it.localPort }
    val unreachable = ProbeEndpoint("a", "http://127.0.0.1:$closedPort/".toHttpUrl(), 204)

    val result = engine.runRound(listOf(unreachable), timeouts).single()

    assertEquals(ProbeOutcome.CONNECT_ERROR, result.outcome)
    assertNull(result.httpStatus)
  }

  @Test
  fun `a name that does not resolve is a DNS error`() {
    val failingDns = dns { hostname -> throw UnknownHostException(hostname) }
    val named = ProbeEndpoint("a", "http://probe.invalid/generate_204".toHttpUrl(), 204)

    val result = engine.runRound(listOf(named), timeouts, dns = failingDns).single()

    assertEquals(ProbeOutcome.DNS_ERROR, result.outcome)
  }

  @Test
  fun `the given resolver decides where a host name leads`() {
    val toLocalServer = dns { listOf(InetAddress.getByName("127.0.0.1")) }
    val named =
        ProbeEndpoint(
            "a", "http://probe.invalid:${server.port}/generate_204".toHttpUrl(), 204)

    val result = engine.runRound(listOf(named), timeouts, dns = toLocalServer).single()

    assertEquals(ProbeOutcome.SUCCESS, result.outcome)
  }

  @Test
  fun `a probe stuck in a DNS lookup is reported as a timeout, within the round limit`() {
    // An uninterruptible lookup that outlasts the call timeout, as seen on a real phone.
    val stuckDns = dns { Thread.sleep(1_800); listOf(InetAddress.getByName("127.0.0.1")) }
    val named =
        ProbeEndpoint(
            "a", "http://probe.invalid:${server.port}/generate_204".toHttpUrl(), 204)
    val limits = ProbeTimeouts(connectMs = 500, readMs = 500, callMs = 600)
    val startedAt = System.nanoTime()

    val result = engine.runRound(listOf(named), limits, dns = stuckDns).single()

    val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000
    assertEquals(ProbeOutcome.TIMEOUT, result.outcome)
    assertTrue(
        "took $elapsedMs ms; limit is ${limits.callMs + ProbeEngine.MAX_OVERRUN_MS}",
        elapsedMs <= limits.callMs + ProbeEngine.MAX_OVERRUN_MS + 300,
    )
  }

  @Test
  fun `a round that overran does not affect the next one`() {
    val stuckDns = dns { Thread.sleep(1_800); listOf(InetAddress.getByName("127.0.0.1")) }
    val named =
        ProbeEndpoint(
            "a", "http://probe.invalid:${server.port}/generate_204".toHttpUrl(), 204)
    engine.runRound(listOf(named), ProbeTimeouts(500, 500, 600), dns = stuckDns)

    assertEquals(ProbeOutcome.SUCCESS, probe(endpoint("a", "/generate_204")).single().outcome)
  }

  @Test
  fun `endpoints are probed at the same time and reported in the order given`() {
    val startedAt = System.nanoTime()

    val results =
        probe(
            endpoint("first", "/delayed"),
            endpoint("second", "/generate_204"),
            endpoint("third", "/delayed"),
        )

    val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000
    assertEquals(listOf("first", "second", "third"), results.map { it.endpointId })
    assertTrue(results.all { it.outcome == ProbeOutcome.SUCCESS })
    assertTrue("two 300 ms probes in sequence would need 600 ms; took $elapsedMs", elapsedMs < 550)
  }

  @Test
  fun `one endpoint failing does not affect another`() {
    val results = probe(endpoint("good", "/generate_204"), endpoint("bad", "/page"))

    assertEquals(ProbeOutcome.SUCCESS, results[0].outcome)
    assertEquals(ProbeOutcome.UNEXPECTED_STATUS, results[1].outcome)
  }

  @Test
  fun `a probe never waits for or downloads the response body`() {
    val startedAt = System.nanoTime()

    val result = probe(endpoint("a", "/huge", expectedStatus = 200)).single()

    val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000
    assertEquals(ProbeOutcome.SUCCESS, result.outcome)
    assertTrue("the body stalls for 1500 ms; the probe took $elapsedMs ms", elapsedMs < 1_000)
  }

  @Test
  fun `cancelling ends the round promptly and marks the probes cancelled`() {
    val canceller = thread {
      Thread.sleep(200)
      engine.cancel()
    }
    val startedAt = System.nanoTime()

    val result = probe(endpoint("a", "/slow")).single()

    val elapsedMs = (System.nanoTime() - startedAt) / 1_000_000
    canceller.join()
    assertEquals(ProbeOutcome.CANCELLED, result.outcome)
    assertTrue("took $elapsedMs ms", elapsedMs < 1_000)
  }

  @Test
  fun `a cancellation does not leak into the next round`() {
    engine.cancel()

    assertEquals(ProbeOutcome.SUCCESS, probe(endpoint("a", "/generate_204")).single().outcome)
  }

  @Test
  fun `a round needs between one and five endpoints`() {
    assertThrows(IllegalArgumentException::class.java) { engine.runRound(emptyList(), timeouts) }
    assertThrows(IllegalArgumentException::class.java) {
      engine.runRound((1..6).map { endpoint("e$it", "/generate_204") }, timeouts)
    }
  }

  @Test
  fun `only the exact status counts and any 3xx is a redirect`() {
    assertEquals(ProbeOutcome.SUCCESS, ProbeEngine.classifyStatus(204, 204))
    assertEquals(ProbeOutcome.UNEXPECTED_STATUS, ProbeEngine.classifyStatus(200, 204))
    assertEquals(ProbeOutcome.UNEXPECTED_STATUS, ProbeEngine.classifyStatus(503, 204))
    assertEquals(ProbeOutcome.REDIRECT, ProbeEngine.classifyStatus(301, 204))
    assertEquals(ProbeOutcome.REDIRECT, ProbeEngine.classifyStatus(307, 204))
  }

  @Test
  fun `failures are classified by their cause`() {
    fun classify(error: IOException) = ProbeEngine.classifyFailure(error, cancelRequested = false)

    assertEquals(ProbeOutcome.DNS_ERROR, classify(UnknownHostException("example.invalid")))
    assertEquals(ProbeOutcome.TIMEOUT, classify(SocketTimeoutException("connect timed out")))
    assertEquals(ProbeOutcome.TIMEOUT, classify(InterruptedIOException("timeout")))
    assertEquals(ProbeOutcome.TLS_ERROR, classify(SSLHandshakeException("bad certificate")))
    assertEquals(ProbeOutcome.TLS_ERROR, classify(SSLPeerUnverifiedException("hostname")))
    assertEquals(ProbeOutcome.CONNECT_ERROR, classify(ConnectException("refused")))
    assertEquals(ProbeOutcome.IO_ERROR, classify(IOException("unexpected end of stream")))
  }

  @Test
  fun `a requested cancellation outranks whatever error it produced`() {
    assertEquals(
        ProbeOutcome.CANCELLED,
        ProbeEngine.classifyFailure(IOException("Canceled"), cancelRequested = true),
    )
  }
}

/**
 * A tiny HTTP server for these tests, written on plain sockets so that it adds
 * no dependency. Each route receives the connection's output stream after the
 * request has been read.
 */
private class TestServer(private val routes: Map<String, (OutputStream) -> Unit>) : Closeable {
  private val socket = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
  private val workers = Executors.newCachedThreadPool()
  private val hitCounts = ConcurrentHashMap<String, AtomicInteger>()

  val port: Int
    get() = socket.localPort

  fun hits(path: String): Int = hitCounts[path]?.get() ?: 0

  init {
    workers.execute {
      while (true) {
        val client =
            try {
              socket.accept()
            } catch (e: IOException) {
              break // The server was closed.
            }
        workers.execute { serve(client) }
      }
    }
  }

  private fun serve(client: Socket) {
    client.use {
      try {
        val reader = it.getInputStream().bufferedReader()
        val requestLine = reader.readLine() ?: return
        while (!reader.readLine().isNullOrEmpty()) {
          // Skip request headers.
        }
        val path = requestLine.split(" ")[1]
        hitCounts.computeIfAbsent(path) { AtomicInteger() }.incrementAndGet()
        val route = routes[path]
        if (route == null) it.getOutputStream().respond("404 Not Found")
        else route(it.getOutputStream())
      } catch (e: IOException) {
        // The probe dropped the connection: expected in several tests.
      } catch (e: InterruptedException) {
        // The server is shutting down while a slow route was sleeping.
      }
    }
  }

  override fun close() {
    socket.close()
    workers.shutdownNow()
  }
}

private fun OutputStream.respond(
    statusLine: String,
    body: ByteArray = ByteArray(0),
    extraHeader: String? = null,
) {
  val headers = buildString {
    append("HTTP/1.1 $statusLine\r\n")
    if (extraHeader != null) append("$extraHeader\r\n")
    append("Content-Length: ${body.size}\r\nConnection: close\r\n\r\n")
  }
  write(headers.toByteArray())
  write(body)
  flush()
}
