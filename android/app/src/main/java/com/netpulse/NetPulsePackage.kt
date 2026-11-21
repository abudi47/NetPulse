package com.netpulse

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Tells React Native that [NetPulseModule] exists and how to create it.
 *
 * Modules that live inside the app (rather than in an npm package) are not
 * discovered automatically, so MainApplication.kt adds this package by hand.
 */
class NetPulsePackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == NetPulseModule.NAME) NetPulseModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
        NetPulseModule.NAME to
            ReactModuleInfo(
                name = NetPulseModule.NAME,
                className = NetPulseModule.NAME,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                isCxxModule = false,
                isTurboModule = true,
            ))
  }
}
