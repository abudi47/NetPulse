package com.netpulse

import android.content.ActivityNotFoundException
import android.content.Intent
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.netpulse.network.DefaultNetworkObserver
import com.netpulse.network.NetworkSnapshot
import com.netpulse.probe.HealthProbeRunner
import com.netpulse.probe.ProbeConfig
import com.netpulse.probe.ProbeRound

/**
 * The native module TypeScript talks to.
 *
 * `NativeNetPulseSpec` is generated at build time from specs/NativeNetPulse.ts,
 * so the method names and types here are checked against the TypeScript
 * contract by the compiler. This class only translates between React Native
 * types and the classes that do the work ([DefaultNetworkObserver] for network
 * state, [HealthProbeRunner] for health probes); it contains no logic of its own.
 */
class NetPulseModule(reactContext: ReactApplicationContext) : NativeNetPulseSpec(reactContext) {

  // Created on first use, so no background thread exists until TypeScript asks.
  private val observerHolder = lazy {
    DefaultNetworkObserver(reactApplicationContext.applicationContext) { snapshot ->
      emitOnNetworkChanged(snapshot.toWritableMap())
    }
  }
  private val observer by observerHolder

  private val probeRunnerHolder = lazy {
    HealthProbeRunner(reactApplicationContext.applicationContext)
  }
  private val probeRunner by probeRunnerHolder

  override fun getName() = NAME

  override fun getSnapshot(promise: Promise) {
    observer.getSnapshot { settle(promise, it) }
  }

  override fun startObserving(promise: Promise) {
    observer.start { settle(promise, it) }
  }

  override fun stopObserving(promise: Promise) {
    observer.stop { promise.resolve(null) }
  }

  override fun runProbeRound(endpoints: ReadableArray, timeouts: ReadableMap, promise: Promise) {
    val config =
        try {
          ProbeConfig.parse(endpoints.toArrayList(), timeouts.toHashMap())
        } catch (e: IllegalArgumentException) {
          promise.reject(ERROR_PROBE_CONFIG, e.message, e)
          return
        }
    probeRunner.runRound(config.endpoints, config.timeouts) { result ->
      result.fold(
          onSuccess = { promise.resolve(it.toWritableMap()) },
          onFailure = {
            if (it is HealthProbeRunner.RoundInFlightException) {
              promise.reject(ERROR_PROBE_BUSY, it.message, it)
            } else {
              promise.reject(ERROR_PROBE_FAILED, "The probe round could not be run", it)
            }
          },
      )
    }
  }

  override fun cancelProbeRound() {
    if (probeRunnerHolder.isInitialized()) probeRunner.cancel()
  }

  override fun requestNetworkReevaluation(promise: Promise) {
    val outcome = probeRunner.reportLastProbedNetworkBroken()
    promise.resolve(Arguments.createMap().apply { putString("outcome", outcome.wireName) })
  }

  /**
   * Opens Android's own network settings, where the user can toggle mobile
   * data or Airplane Mode themselves. NetPulse never changes those settings.
   */
  override fun openNetworkSettings(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    // Not every device has the first screen, so fall back to the main settings page.
    for (action in listOf(Settings.ACTION_WIRELESS_SETTINGS, Settings.ACTION_SETTINGS)) {
      try {
        if (activity != null) {
          // Opened on top of NetPulse, so Back returns here. With NEW_TASK it
          // would join the Settings app's own task and Back would walk through
          // whatever Settings pages the user had open before (seen on a device).
          activity.startActivity(Intent(action))
        } else {
          reactApplicationContext.startActivity(
              Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        promise.resolve(true)
        return
      } catch (e: ActivityNotFoundException) {
        // Try the next screen.
      }
    }
    promise.resolve(false)
  }

  /** React Native calls this when the module is torn down, e.g. on a JavaScript reload. */
  override fun invalidate() {
    if (observerHolder.isInitialized()) observer.close()
    if (probeRunnerHolder.isInitialized()) probeRunner.close()
    super.invalidate()
  }

  private fun settle(promise: Promise, result: Result<NetworkSnapshot>) {
    result.fold(
        onSuccess = { promise.resolve(it.toWritableMap()) },
        onFailure = { promise.reject(ERROR_NETWORK_STATE, "Could not read the network state", it) },
    )
  }

  companion object {
    const val NAME = "NativeNetPulse"
    private const val ERROR_NETWORK_STATE = "E_NETWORK_STATE"
    private const val ERROR_PROBE_CONFIG = "E_PROBE_CONFIG"
    private const val ERROR_PROBE_BUSY = "E_PROBE_BUSY"
    private const val ERROR_PROBE_FAILED = "E_PROBE_FAILED"
  }
}

/** Field names must match `NativeNetworkSnapshot` in specs/NativeNetPulse.ts. */
private fun NetworkSnapshot.toWritableMap(): WritableMap =
    Arguments.createMap().apply {
      putBoolean("hasNetwork", hasNetwork)
      val facts = facts
      if (facts == null) {
        putNull("transport")
        putNull("isVpn")
        putNull("validated")
        putNull("internetCapable")
        putNull("captivePortal")
        putNull("metered")
      } else {
        putString("transport", facts.transport.wireName)
        putBoolean("isVpn", facts.isVpn)
        putBoolean("validated", facts.validated)
        putBoolean("internetCapable", facts.internetCapable)
        putBoolean("captivePortal", facts.captivePortal)
        putBoolean("metered", facts.metered)
      }
      putDouble("capturedAtMs", capturedAtMs.toDouble())
      putString("cause", cause.wireName)
    }

/** Field names must match `NativeProbeRound` in specs/NativeNetPulse.ts. */
private fun ProbeRound.toWritableMap(): WritableMap =
    Arguments.createMap().apply {
      putBoolean("hadNetwork", hadNetwork)
      putBoolean("networkChanged", networkChanged)
      putDouble("startedAtMs", startedAtMs.toDouble())
      putDouble("finishedAtMs", finishedAtMs.toDouble())
      putArray(
          "results",
          Arguments.createArray().apply {
            results.forEach { result ->
              pushMap(
                  Arguments.createMap().apply {
                    putString("endpointId", result.endpointId)
                    putString("outcome", result.outcome.wireName)
                    result.httpStatus?.let { putInt("httpStatus", it) } ?: putNull("httpStatus")
                    putDouble("durationMs", result.durationMs.toDouble())
                  })
            }
          },
      )
      bytesUsed?.let { putDouble("bytesUsed", it.toDouble()) } ?: putNull("bytesUsed")
    }
