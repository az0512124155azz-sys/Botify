package expo.modules.bothubtdlib

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.drinkless.tdlib.JsonClient
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

// td_receive is process-wide: there must be exactly one consumer, including during reconnect.
private object TdPump {
  private val listeners = ConcurrentHashMap<Int, (String) -> Unit>()
  private val closing = ConcurrentHashMap<Int, CompletableFuture<Unit>>()
  private var started = false
  @Synchronized fun create(listener: (String) -> Unit): Int {
    System.loadLibrary("tdjsonjava") // Fail immediately if packaging is broken.
    JsonClient.execute("""{"@type":"setLogVerbosityLevel","new_verbosity_level":0}""")
    val id = JsonClient.createClientId()
    listeners[id] = listener
    if (!started) {
      started = true
      Thread({
        while (true) {
          val json = JsonClient.receive(0.3) ?: continue
          val value = JSONObject(json)
          val client = value.optInt("@client_id")
          try { listeners[client]?.invoke(json) } catch (_: Exception) { /* UI may be destroyed. */ }
          if (value.optString("@type") == "updateAuthorizationState" &&
              value.optJSONObject("authorization_state")?.optString("@type") == "authorizationStateClosed") {
            synchronized(this) {
              listeners.remove(client)
              closing.remove(client)?.complete(Unit)
            }
          }
        }
      }, "BotHub-TDLib").apply { isDaemon = true; start() }
    }
    return id
  }
  @Synchronized fun close(id: Int): CompletableFuture<Unit> {
    if (!listeners.containsKey(id)) return CompletableFuture.completedFuture(Unit)
    closing[id]?.let { return it }
    val complete = CompletableFuture<Unit>()
    closing[id] = complete
    listeners[id] = {} // Drain until Closed, but never deliver stale events to a reconnected UI.
    JsonClient.send(id, """{"@type":"close"}""")
    return complete
  }
}
class BotHubTdlibModule : Module() {
  private var client: Int? = null
  override fun definition() = ModuleDefinition {
    Name("BotHubTdlib")
    Events("onUpdate")
    AsyncFunction("start") {
      check(client == null) { "TDLib is already running" }
      val context = appContext.reactContext ?: error("Application context unavailable")
      val root = File(context.noBackupFilesDir, "bothub").apply { mkdirs() }
      val database = File(root, "database").apply { mkdirs() }
      val files = File(root, "files").apply { mkdirs() }
      client = TdPump.create { json -> sendEvent("onUpdate", mapOf("json" to json)) }
      mapOf("database" to database.absolutePath, "files" to files.absolutePath)
    }
    Function("send") { request: String ->
      val id = client ?: error("TDLib is not started")
      JsonClient.send(id, request)
    }
    AsyncFunction("close") { val id = client; client = null; id?.let { TdPump.close(it).get(15, TimeUnit.SECONDS) }; Unit }
    OnDestroy { client?.let { TdPump.close(it) }; client = null }
  }
}
