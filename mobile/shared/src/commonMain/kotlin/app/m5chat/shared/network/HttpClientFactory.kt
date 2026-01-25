package app.m5chat.shared.network

import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

expect fun createPlatformHttpClient(): HttpClient

object HttpClientFactory {
    val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
        prettyPrint = false
    }

    fun create(): HttpClient {
        return createPlatformHttpClient().config {
            install(ContentNegotiation) {
                json(json)
            }
            install(WebSockets) {
                pingInterval = 25_000
            }
            install(Logging) {
                level = LogLevel.INFO
            }
        }
    }
}
