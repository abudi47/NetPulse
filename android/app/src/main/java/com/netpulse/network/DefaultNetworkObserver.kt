package com.netpulse.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log

/**
 * Watches the phone's default network through Android's ConnectivityManager.
 *
 * This is the only class that talks to Android about networks. It registers
 * one callback, hands each event to [DefaultNetworkTracker], and passes any
 * resulting snapshot to [onChange].
 *
 * Threading: everything here runs on one private background thread, so the
 * tracker needs no locks and Android's own callback thread is never held up.
 * No network requests are made in this class.
 *
 * Requires the ACCESS_NETWORK_STATE permission (declared in AndroidManifest.xml).
 */
class DefaultNetworkObserver(
    context: Context,
    private val onChange: (NetworkSnapshot) -> Unit,
) {
  private val connectivityManager =
      context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  private val thread = HandlerThread("NetPulseNetwork").apply { start() }
  private val handler = Handler(thread.looper)
  private val tracker = DefaultNetworkTracker { System.currentTimeMillis() }

  /** Whether our callback is registered with Android. Only touched on [thread]. */
  private var registered = false

  private val callback =
      object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = whileRegistered {
          tracker.onAvailable(network.networkHandle)
          // Android 8+ sends the capabilities right after this, and that message
          // is already queued ahead of the check below. Android 7 sends nothing
          // more, so the check reads them itself. Android's docs warn against
          // reading them *inside* this callback, which this does not do.
          handler.post { if (registered) describeIfAndroidDidNot(network) }
        }

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
          val facts = capabilities.toFacts()
          whileRegistered { report(tracker.onCapabilities(network.networkHandle, facts)) }
        }

        override fun onLost(network: Network) = whileRegistered {
          report(tracker.onLost(network.networkHandle))
        }
      }

  /**
   * Starts observing and delivers the current state. If already observing,
   * nothing is registered a second time and the current state is delivered.
   */
  fun start(onResult: (Result<NetworkSnapshot>) -> Unit) {
    handler.post {
      onResult(
          runCatching {
            if (registered) {
              tracker.snapshot()
            } else {
              // Read first, then register: callbacks only describe what happens
              // from now on, and send nothing at all when there is no network.
              val current = readDefaultNetwork()
              val initial = tracker.start(current?.first, current?.second)
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                connectivityManager.registerDefaultNetworkCallback(callback, handler)
              } else {
                // Android 7 cannot deliver callbacks to a thread of our choosing;
                // whileRegistered() moves each one onto ours.
                connectivityManager.registerDefaultNetworkCallback(callback)
              }
              registered = true
              initial
            }
          })
    }
  }

  /** Stops observing. Does nothing if not observing. */
  fun stop(onDone: () -> Unit) {
    handler.post {
      unregister()
      onDone()
    }
  }

  /** Delivers the current state without starting to observe. */
  fun getSnapshot(onResult: (Result<NetworkSnapshot>) -> Unit) {
    handler.post {
      onResult(
          runCatching {
            if (registered) {
              tracker.snapshot()
            } else {
              val current = readDefaultNetwork()
              DefaultNetworkTracker { System.currentTimeMillis() }
                  .start(current?.first, current?.second)
            }
          })
    }
  }

  /** Stops observing and ends the background thread. The observer cannot be reused. */
  fun close() {
    handler.post { unregister() }
    thread.quitSafely()
  }

  private fun unregister() {
    if (!registered) return
    registered = false
    try {
      connectivityManager.unregisterNetworkCallback(callback)
    } catch (e: IllegalArgumentException) {
      // Android throws this if the callback is not registered. It should not
      // happen given the flag above, and there is nothing further to undo.
      Log.w(TAG, "Network callback was not registered when unregistering", e)
    }
  }

  /** Runs [block] on our thread, and only if we are still observing. */
  private fun whileRegistered(block: () -> Unit) {
    val guarded = { if (registered) block() }
    if (Looper.myLooper() == thread.looper) guarded() else handler.post(guarded)
  }

  private fun describeIfAndroidDidNot(network: Network) {
    if (tracker.awaitingCapabilities != network.networkHandle) return
    report(
        tracker.onCapabilitiesUnreported(
            network.networkHandle,
            connectivityManager.getNetworkCapabilities(network)?.toFacts(),
        ))
  }

  /** The current default network and what Android says about it, or null if there is none. */
  private fun readDefaultNetwork(): Pair<Long, CapabilityFacts?>? {
    val network = connectivityManager.activeNetwork ?: return null
    return network.networkHandle to connectivityManager.getNetworkCapabilities(network)?.toFacts()
  }

  private fun report(snapshot: NetworkSnapshot?) {
    if (snapshot != null) onChange(snapshot)
  }

  private companion object {
    const val TAG = "NetPulseNetwork"
  }
}

private fun NetworkCapabilities.toFacts(): CapabilityFacts {
  val isVpn = hasTransport(NetworkCapabilities.TRANSPORT_VPN)
  return CapabilityFacts(
      // A VPN network also lists the transport underneath it where Android
      // knows it, so prefer that and report the VPN separately.
      transport =
          when {
            hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Transport.WIFI
            hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Transport.CELLULAR
            hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Transport.ETHERNET
            hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> Transport.BLUETOOTH
            isVpn -> Transport.VPN
            else -> Transport.OTHER
          },
      isVpn = isVpn,
      validated = hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
      internetCapable = hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),
      captivePortal = hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL),
      metered = !hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
  )
}
