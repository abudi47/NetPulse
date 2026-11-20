package com.netpulse.probe

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.TrafficStats
import android.os.Process
import android.util.Log
import com.netpulse.recovery.RecoveryGate
import com.netpulse.recovery.RecoveryOutcome
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Dns

/**
 * Runs a probe round against the phone's current default network, and can
 * tell Android when that network failed every check.
 *
 * This is the Android-facing half of the probe code: it finds the default
 * network, pins the probes to it, and reads Android's traffic counters. The
 * requests themselves are made by [ProbeEngine] on background threads; nothing
 * here runs on Android's connectivity callback thread or the UI thread.
 *
 * Requires the INTERNET and ACCESS_NETWORK_STATE permissions.
 */
class HealthProbeRunner(context: Context) {

  private val connectivityManager =
      context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val engine = ProbeEngine()
  private val executor =
      Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "NetPulseProbeRound").apply { isDaemon = true }
      }
  private val busy = AtomicBoolean(false)

  /** The network the latest completed round ran on, and whether it failed every check. */
  private class ProbedNetwork(val network: Network, val failedEveryCheck: Boolean)

  @Volatile private var lastProbed: ProbedNetwork? = null

  /** Thrown when a round is requested while another is still running. */
  class RoundInFlightException : IllegalStateException("A probe round is already running")

  /**
   * Starts a round and delivers its result on a background thread. Only one
   * round runs at a time; a second request fails with [RoundInFlightException].
   */
  fun runRound(
      endpoints: List<ProbeEndpoint>,
      timeouts: ProbeTimeouts,
      onResult: (Result<ProbeRound>) -> Unit,
  ) {
    if (!busy.compareAndSet(false, true)) {
      onResult(Result.failure(RoundInFlightException()))
      return
    }
    try {
      executor.execute {
        val result = runCatching { probe(endpoints, timeouts) }
        busy.set(false)
        onResult(result)
      }
    } catch (e: RejectedExecutionException) {
      // close() has been called: the module is being torn down.
      busy.set(false)
      onResult(Result.failure(e))
    }
  }

  /** Cancels the round in flight, if any. It still delivers a result, marked cancelled. */
  fun cancel() = engine.cancel()

  /**
   * Tells Android that the network the latest round ran on appears to have no
   * connectivity, by calling `ConnectivityManager.reportNetworkConnectivity(network, false)`.
   *
   * This is a hint. Android may re-check the network and may then act on what
   * it finds; it promises neither. It is not a modem reset and does not toggle
   * Airplane Mode, mobile data or any radio.
   *
   * Nothing is reported unless [RecoveryGate] agrees that this device's own
   * latest round, on the network that is still the default, failed every check.
   */
  fun reportLastProbedNetworkBroken(): RecoveryOutcome {
    val probed = lastProbed
    val outcome =
        RecoveryGate.check(
            lastProbedNetworkId = probed?.network?.networkHandle,
            lastRoundFailedEveryCheck = probed?.failedEveryCheck ?: false,
            activeNetworkId = connectivityManager.activeNetwork?.networkHandle,
        )
    if (outcome != RecoveryOutcome.REQUESTED || probed == null) return outcome
    return try {
      connectivityManager.reportNetworkConnectivity(probed.network, false)
      RecoveryOutcome.REQUESTED
    } catch (e: RuntimeException) {
      Log.w(TAG, "Android rejected the connectivity report", e)
      RecoveryOutcome.FAILED
    }
  }

  /** Cancels any round and releases the background thread. The runner cannot be reused. */
  fun close() {
    engine.cancel()
    executor.shutdown()
  }

  private fun probe(endpoints: List<ProbeEndpoint>, timeouts: ProbeTimeouts): ProbeRound {
    val startedAtMs = System.currentTimeMillis()
    // No network: send nothing. The network callback reports when one appears.
    val network =
        connectivityManager.activeNetwork
            ?: return ProbeRound(
                hadNetwork = false,
                networkChanged = false,
                startedAtMs = startedAtMs,
                finishedAtMs = startedAtMs,
                results = emptyList(),
                bytesUsed = null,
            )

    val bytesBefore = appTrafficBytes()
    val results =
        engine.runRound(
            endpoints,
            timeouts,
            // Resolve names and open sockets on this exact network, so a switch
            // to another network mid-round cannot make a dead one look alive.
            dns =
                object : Dns {
                  override fun lookup(hostname: String): List<InetAddress> =
                      network.getAllByName(hostname).toList()
                },
            socketFactory = network.socketFactory,
        )
    val bytesAfter = appTrafficBytes()
    val networkChanged = connectivityManager.activeNetwork != network

    lastProbed =
        ProbedNetwork(
            network,
            failedEveryCheck =
                !networkChanged &&
                    results.isNotEmpty() &&
                    results.none {
                      it.outcome == ProbeOutcome.SUCCESS || it.outcome == ProbeOutcome.CANCELLED
                    },
        )

    return ProbeRound(
        hadNetwork = true,
        networkChanged = networkChanged,
        startedAtMs = startedAtMs,
        finishedAtMs = System.currentTimeMillis(),
        results = results,
        bytesUsed =
            if (bytesBefore != null && bytesAfter != null && bytesAfter >= bytesBefore) {
              bytesAfter - bytesBefore
            } else {
              null
            },
    )
  }

  /** Total bytes Android has counted for this app since boot, or null if it does not say. */
  private fun appTrafficBytes(): Long? {
    val uid = Process.myUid()
    val received = TrafficStats.getUidRxBytes(uid)
    val sent = TrafficStats.getUidTxBytes(uid)
    if (received == TrafficStats.UNSUPPORTED.toLong() || sent == TrafficStats.UNSUPPORTED.toLong()) {
      return null
    }
    return received + sent
  }

  private companion object {
    const val TAG = "NetPulseProbe"
  }
}
