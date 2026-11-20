package com.netpulse.probe

import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.SocketFactory
import javax.net.ssl.SSLException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.Dispatcher
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response

/**
 * Sends one small HTTPS request to each endpoint and reports what happened.
 *
 * Built on OkHttp, the HTTP library React Native already ships, so this adds
 * nothing to the app's size. Deliberate limits:
 *  - Redirects are never followed; a redirect is reported, not obeyed.
 *  - A response only counts as success if its status is exactly the expected one.
 *  - Response bodies are never downloaded; only the status line is judged.
 *  - Connections are not kept open between rounds, so every round proves the
 *    whole path (DNS, TCP, TLS, HTTP) works now.
 *  - Nothing is retried. Deciding what a failure means is TypeScript's job.
 *
 * Plain Kotlin with no Android classes: see ProbeEngineTest.
 */
class ProbeEngine {

  private val client: OkHttpClient =
      OkHttpClient.Builder()
          .dispatcher(
              Dispatcher(
                      // At most MAX_ENDPOINTS probes at once, each on a short-lived thread.
                      ThreadPoolExecutor(
                          0,
                          MAX_ENDPOINTS,
                          10,
                          TimeUnit.SECONDS,
                          SynchronousQueue(),
                      ) { runnable ->
                        Thread(runnable, "NetPulseProbe").apply { isDaemon = true }
                      })
                  .apply {
                    maxRequests = MAX_ENDPOINTS
                    maxRequestsPerHost = MAX_ENDPOINTS
                  })
          .connectionPool(ConnectionPool(0, 1, TimeUnit.MILLISECONDS))
          .protocols(listOf(Protocol.HTTP_1_1))
          .followRedirects(false)
          .followSslRedirects(false)
          .retryOnConnectionFailure(false)
          .cache(null)
          .build()

  /** Calls in flight for the current round, so [cancel] can reach them. */
  private val inFlight = mutableListOf<Call>()

  /** Set by [cancel]; tells a deliberate cancellation apart from a timeout. */
  private val cancelRequested = AtomicBoolean(false)

  /** Set when the round outlives its time limit and stuck probes are abandoned. */
  private val overran = AtomicBoolean(false)

  /**
   * Probes every endpoint at the same time and blocks until all have an outcome.
   * [dns] and [socketFactory] let the caller pin the probes to one network.
   * Results are in the same order as [endpoints]. Run one round at a time.
   */
  fun runRound(
      endpoints: List<ProbeEndpoint>,
      timeouts: ProbeTimeouts,
      dns: Dns = Dns.SYSTEM,
      socketFactory: SocketFactory = SocketFactory.getDefault(),
      nanoTime: () -> Long = System::nanoTime,
  ): List<ProbeResult> {
    require(endpoints.size in 1..MAX_ENDPOINTS) { "Expected 1..$MAX_ENDPOINTS endpoints" }
    cancelRequested.set(false)
    overran.set(false)

    val roundClient =
        client
            .newBuilder()
            .dns(dns)
            .socketFactory(socketFactory)
            .connectTimeout(timeouts.connectMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeouts.readMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeouts.readMs, TimeUnit.MILLISECONDS)
            .callTimeout(timeouts.callMs, TimeUnit.MILLISECONDS)
            .build()

    val results = arrayOfNulls<ProbeResult>(endpoints.size)
    val done = CountDownLatch(endpoints.size)

    endpoints.forEachIndexed { index, endpoint ->
      val request =
          Request.Builder()
              .url(endpoint.url)
              .header("User-Agent", USER_AGENT)
              .header("Cache-Control", "no-cache")
              .build()
      val call = roundClient.newCall(request)
      synchronized(inFlight) { inFlight.add(call) }
      val startedAt = nanoTime()

      fun finish(outcome: ProbeOutcome, httpStatus: Int?) {
        val durationMs = TimeUnit.NANOSECONDS.toMillis(nanoTime() - startedAt)
        results[index] = ProbeResult(endpoint.id, outcome, httpStatus, durationMs)
        synchronized(inFlight) { inFlight.remove(call) }
        done.countDown()
      }

      call.enqueue(
          object : Callback {
            override fun onResponse(call: Call, response: Response) {
              // The status line and headers have arrived; that is all a probe
              // needs. Cancelling drops the connection at once, so no part of
              // a response body is downloaded, however large it is.
              val status = response.code
              call.cancel()
              response.close()
              finish(classifyStatus(status, endpoint.expectedStatus), status)
            }

            override fun onFailure(call: Call, e: IOException) {
              // A probe this engine abandoned for overrunning failed by timing out,
              // whatever exception the abandonment itself produced.
              val outcome =
                  if (overran.get() && !cancelRequested.get()) ProbeOutcome.TIMEOUT
                  else classifyFailure(e, cancelRequested.get())
              finish(outcome, null)
            }
          })
    }

    // OkHttp's call timeout cancels a call, but a call blocked in a DNS lookup
    // only notices once the lookup returns, which can take much longer. So the
    // round waits at most callMs plus a margin, then abandons stuck probes and
    // reports them as timeouts. Observed on a real phone during a DNS stall.
    if (!done.await(timeouts.callMs + AWAIT_MARGIN_MS, TimeUnit.MILLISECONDS)) {
      overran.set(true)
      synchronized(inFlight) { inFlight.toList() }.forEach { it.cancel() }
      done.await(AWAIT_MARGIN_MS, TimeUnit.MILLISECONDS)
    }

    return endpoints.mapIndexed { index, endpoint ->
      results[index] ?: ProbeResult(endpoint.id, ProbeOutcome.TIMEOUT, null, timeouts.callMs)
    }
  }

  /** Cancels the round in flight, if any. Its probes finish as [ProbeOutcome.CANCELLED]. */
  fun cancel() {
    cancelRequested.set(true)
    synchronized(inFlight) { inFlight.toList() }.forEach { it.cancel() }
  }

  companion object {
    /** More endpoints than this is a configuration mistake, not thoroughness. */
    const val MAX_ENDPOINTS = 5

    private const val AWAIT_MARGIN_MS = 1_000L

    /** The most a round can run past its call timeout before it is ended. */
    const val MAX_OVERRUN_MS = 2 * AWAIT_MARGIN_MS
    private const val USER_AGENT = "NetPulse (connectivity check)"

    /** Only the exact expected status is success; any redirect is reported as such. */
    fun classifyStatus(status: Int, expectedStatus: Int): ProbeOutcome =
        when {
          status == expectedStatus -> ProbeOutcome.SUCCESS
          status in 300..399 -> ProbeOutcome.REDIRECT
          else -> ProbeOutcome.UNEXPECTED_STATUS
        }

    /**
     * Maps a failed request to the most specific cause the evidence supports.
     * [cancelRequested] is whether the caller asked for the round to be cancelled.
     */
    fun classifyFailure(error: IOException, cancelRequested: Boolean): ProbeOutcome =
        when {
          cancelRequested -> ProbeOutcome.CANCELLED
          error is UnknownHostException -> ProbeOutcome.DNS_ERROR
          // OkHttp reports its overall call timeout as InterruptedIOException.
          error is SocketTimeoutException || error is InterruptedIOException -> ProbeOutcome.TIMEOUT
          error is SSLException -> ProbeOutcome.TLS_ERROR
          error is ConnectException ||
              error is NoRouteToHostException ||
              error is PortUnreachableException -> ProbeOutcome.CONNECT_ERROR
          else -> ProbeOutcome.IO_ERROR
        }
  }
}
