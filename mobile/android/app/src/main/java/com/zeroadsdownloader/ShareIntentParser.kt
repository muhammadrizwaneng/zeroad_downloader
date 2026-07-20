package com.zeroadsdownloader

import android.content.Intent

object ShareIntentParser {
  fun extractUrl(intent: Intent?): String? {
    if (intent == null) {
      return null
    }

    return when (intent.action) {
      Intent.ACTION_SEND -> extractFromSend(intent)
      Intent.ACTION_VIEW -> intent.dataString?.takeIf(::isHttpUrl)
      else -> null
    }
  }

  private fun extractFromSend(intent: Intent): String? {
    val type = intent.type ?: return null
    if (!type.startsWith("text")) {
      return null
    }

    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
    return extractHttpUrl(text)
  }

  private fun extractHttpUrl(text: String): String? {
    val trimmed = text.trim()
    if (isHttpUrl(trimmed)) {
      return trimmed.split("\\s".toRegex()).firstOrNull()
    }

    val match = Regex("https?://\\S+", RegexOption.IGNORE_CASE).find(trimmed)
    return match?.value
  }

  private fun isHttpUrl(value: String): Boolean {
    return value.startsWith("http://", ignoreCase = true) ||
      value.startsWith("https://", ignoreCase = true)
  }
}
