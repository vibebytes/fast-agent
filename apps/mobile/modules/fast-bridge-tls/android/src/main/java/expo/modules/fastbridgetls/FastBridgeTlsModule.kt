package expo.modules.fastbridgetls

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

class FastBridgeTlsModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private var socket: WebSocket? = null
  private var http: OkHttpClient? = null
  private val generation = AtomicInteger(0)

  override fun definition() = ModuleDefinition {
    Name("FastBridgeTls")
    Events("open", "message", "error", "close")

    AsyncFunction("probe") { url: String, expected: String?, promise: Promise ->
      executor.execute {
        try {
          val fingerprint = probe(url)
          val pin = normalize(expected)
          if (pin != null && fingerprint != pin) {
            promise.reject(
              "ERR_FINGERPRINT_MISMATCH",
              "server fingerprint $fingerprint does not match pinned $pin",
              null
            )
          } else {
            promise.resolve(fingerprint)
          }
        } catch (e: Exception) {
          promise.reject("ERR_PROBE_FAILED", e.message ?: "TLS handshake failed", e)
        }
      }
    }

    AsyncFunction("connect") { url: String, fingerprint: String, promise: Promise ->
      executor.execute {
        try {
          openSocket(url, fingerprint, promise)
        } catch (e: Exception) {
          promise.reject("ERR_CONNECT_FAILED", e.message ?: "无法连接", e)
        }
      }
    }

    Function("send") { text: String ->
      socket?.send(text) == true
    }

    Function("disconnect") {
      generation.incrementAndGet()
      socket?.close(1000, "bye")
      socket = null
      http?.dispatcher?.executorService?.shutdown()
      http = null
    }
  }

  private fun openSocket(url: String, fingerprint: String, promise: Promise) {
    val pin = normalize(fingerprint) ?: throw IllegalArgumentException("invalid fingerprint")
    val gen = generation.incrementAndGet()
    socket?.cancel()
    socket = null
    val trust = pinningTrust(pin)
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf<TrustManager>(trust), SecureRandom())
    val client = OkHttpClient.Builder()
      .sslSocketFactory(context.socketFactory, trust)
      .hostnameVerifier { _, _ -> true }
      .connectTimeout(10, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.SECONDS)
      .build()
    http = client
    val request = Request.Builder().url(url).build()
    var settled = false
    socket = client.newWebSocket(
      request,
      object : WebSocketListener() {
        private fun live() = gen == generation.get()

        override fun onOpen(webSocket: WebSocket, response: Response) {
          if (!live()) return
          if (!settled) {
            settled = true
            promise.resolve(null)
          }
          sendEvent("open", emptyMap<String, Any>())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          if (live()) sendEvent("message", mapOf("data" to text))
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          if (!live()) return
          if (!settled) {
            settled = true
            promise.reject("ERR_CONNECT_FAILED", t.message ?: "无法连接", t)
          }
          sendEvent("error", mapOf("message" to (t.message ?: "无法连接")))
          sendEvent("close", emptyMap<String, Any>())
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          if (live()) sendEvent("close", emptyMap<String, Any>())
        }
      }
    )
  }

  private fun probe(url: String): String {
    val conn = URL(url).openConnection() as HttpsURLConnection
    conn.connectTimeout = 10_000
    conn.readTimeout = 10_000
    conn.sslSocketFactory = trustingSocketFactory()
    conn.hostnameVerifier = HostnameVerifier { _, _ -> true }
    try {
      conn.connect()
      val leaf = conn.serverCertificates.firstOrNull() as? X509Certificate
        ?: throw IllegalStateException("no server certificate")
      return fingerprintOf(leaf)
    } finally {
      conn.disconnect()
    }
  }

  private fun pinningTrust(pin: String): X509TrustManager =
    object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val leaf = chain.firstOrNull() ?: throw CertificateException("no server certificate")
        val got = fingerprintOf(leaf)
        if (got != pin) throw CertificateException("server fingerprint $got does not match pinned $pin")
      }
      override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

  private fun trustingSocketFactory(): SSLSocketFactory {
    val trustManager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
    return context.socketFactory
  }

  private fun fingerprintOf(cert: X509Certificate): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
    return "sha256:" + digest.joinToString("") { "%02x".format(it) }
  }

  private fun normalize(raw: String?): String? {
    if (raw == null) return null
    val hex = raw.lowercase().removePrefix("sha256:").filter { it in '0'..'9' || it in 'a'..'f' }
    return if (hex.isEmpty()) null else "sha256:$hex"
  }
}
