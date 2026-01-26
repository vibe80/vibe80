package app.m5chat.shared.models

import kotlinx.serialization.Serializable

/**
 * Types of errors that can occur in the application
 */
@Serializable
enum class ErrorType {
    /** WebSocket connection or communication error */
    WEBSOCKET,
    /** HTTP API call failed */
    NETWORK,
    /** Server returned an error during turn processing */
    TURN_ERROR,
    /** File upload failed */
    UPLOAD,
    /** Message sending failed */
    SEND_MESSAGE,
    /** Provider switch failed */
    PROVIDER_SWITCH,
    /** Branch operation failed */
    BRANCH,
    /** Worktree operation failed */
    WORKTREE,
    /** Unknown or unexpected error */
    UNKNOWN
}

/**
 * Represents an error that occurred in the application
 */
@Serializable
data class AppError(
    /** Type of error for categorization */
    val type: ErrorType,
    /** Human-readable error message */
    val message: String,
    /** Optional detailed message (e.g., stack trace or server response) */
    val details: String? = null,
    /** When the error occurred */
    val timestamp: Long,
    /** Whether the operation can be retried */
    val canRetry: Boolean = false,
    /** Optional context about what operation failed */
    val context: String? = null
) {
    companion object {
        fun websocket(message: String, details: String? = null) = AppError(
            type = ErrorType.WEBSOCKET,
            message = message,
            details = details,
            timestamp = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
        )

        fun network(message: String, details: String? = null, canRetry: Boolean = true) = AppError(
            type = ErrorType.NETWORK,
            message = message,
            details = details,
            timestamp = kotlinx.datetime.Clock.System.now().toEpochMilliseconds(),
            canRetry = canRetry
        )

        fun turnError(message: String, details: String? = null) = AppError(
            type = ErrorType.TURN_ERROR,
            message = message,
            details = details,
            timestamp = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
        )

        fun upload(message: String, details: String? = null, canRetry: Boolean = true) = AppError(
            type = ErrorType.UPLOAD,
            message = message,
            details = details,
            timestamp = kotlinx.datetime.Clock.System.now().toEpochMilliseconds(),
            canRetry = canRetry
        )

        fun sendMessage(message: String, details: String? = null, canRetry: Boolean = true) = AppError(
            type = ErrorType.SEND_MESSAGE,
            message = message,
            details = details,
            timestamp = kotlinx.datetime.Clock.System.now().toEpochMilliseconds(),
            canRetry = canRetry
        )

        fun unknown(message: String, details: String? = null) = AppError(
            type = ErrorType.UNKNOWN,
            message = message,
            details = details,
            timestamp = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
        )
    }
}
