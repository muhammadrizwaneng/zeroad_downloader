package com.zeroadsdownloader

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class ShareIntentModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ShareIntentModule"

  @ReactMethod
  fun getSharedUrl(promise: Promise) {
    promise.resolve(ShareIntentHolder.consumePendingUrl())
  }

  companion object {
    const val EVENT_NAME = "ShareIntentReceived"

    fun emitSharedUrl(context: ReactApplicationContext, url: String) {
      if (!context.hasActiveReactInstance()) {
        return
      }

      val params = Arguments.createMap().apply {
        putString("url", url)
      }

      context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_NAME, params)
    }
  }
}
