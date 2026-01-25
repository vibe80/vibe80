package app.m5chat.shared.logging

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.datetime.Clock

enum class LogLevel {
    DEBUG,
    INFO,
    WARNING,
    ERROR
}

enum class LogSource {
    API,
    WEBSOCKET,
    APP
}

data class LogEntry(
    val id: Long,
    val timestamp: Long,
    val level: LogLevel,
    val source: LogSource,
    val message: String,
    val details: String? = null
)

/**
 * Centralized logger for debugging API and WebSocket calls
 */
object AppLogger {
    private var nextId = 0L
    private const val MAX_LOGS = 500

    private val _logs = MutableStateFlow<List<LogEntry>>(emptyList())
    val logs: StateFlow<List<LogEntry>> = _logs.asStateFlow()

    fun log(level: LogLevel, source: LogSource, message: String, details: String? = null) {
        val entry = LogEntry(
            id = nextId++,
            timestamp = Clock.System.now().toEpochMilliseconds(),
            level = level,
            source = source,
            message = message,
            details = details
        )

        _logs.update { currentLogs ->
            (listOf(entry) + currentLogs).take(MAX_LOGS)
        }

        // Also print to console for development
        println("[${source.name}] ${level.name}: $message")
        details?.let { println("  Details: ${it.take(500)}") }
    }

    fun debug(source: LogSource, message: String, details: String? = null) {
        log(LogLevel.DEBUG, source, message, details)
    }

    fun info(source: LogSource, message: String, details: String? = null) {
        log(LogLevel.INFO, source, message, details)
    }

    fun warning(source: LogSource, message: String, details: String? = null) {
        log(LogLevel.WARNING, source, message, details)
    }

    fun error(source: LogSource, message: String, details: String? = null) {
        log(LogLevel.ERROR, source, message, details)
    }

    fun clear() {
        _logs.value = emptyList()
    }

    // Convenience methods for API logging
    fun apiRequest(method: String, url: String, body: String? = null) {
        info(LogSource.API, "$method $url", body)
    }

    fun apiResponse(method: String, url: String, status: Int, body: String? = null) {
        val level = if (status in 200..299) LogLevel.INFO else LogLevel.ERROR
        log(level, LogSource.API, "$method $url → $status", body?.take(1000))
    }

    fun apiError(method: String, url: String, error: Throwable) {
        error(LogSource.API, "$method $url → ERROR: ${error::class.simpleName}", error.message)
    }

    // Convenience methods for WebSocket logging
    fun wsConnecting(url: String) {
        info(LogSource.WEBSOCKET, "Connecting to $url")
    }

    fun wsConnected(url: String) {
        info(LogSource.WEBSOCKET, "Connected to $url")
    }

    fun wsDisconnected(reason: String? = null) {
        info(LogSource.WEBSOCKET, "Disconnected", reason)
    }

    fun wsSend(messageType: String, payload: String? = null) {
        debug(LogSource.WEBSOCKET, "→ SEND: $messageType", payload?.take(500))
    }

    fun wsReceive(messageType: String, payload: String? = null) {
        debug(LogSource.WEBSOCKET, "← RECV: $messageType", payload?.take(500))
    }

    fun wsError(error: Throwable) {
        error(LogSource.WEBSOCKET, "WebSocket error: ${error::class.simpleName}", error.message)
    }
}
