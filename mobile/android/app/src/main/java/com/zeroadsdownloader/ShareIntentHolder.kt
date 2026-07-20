package com.zeroadsdownloader

object ShareIntentHolder {
  @Volatile
  private var pendingUrl: String? = null

  fun setPendingUrl(url: String) {
    pendingUrl = url
  }

  fun consumePendingUrl(): String? {
    val url = pendingUrl
    pendingUrl = null
    return url
  }

  fun peekPendingUrl(): String? = pendingUrl
}
