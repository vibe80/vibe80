package app.vibe80.shared.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val text: String,
    val attachments: List<Attachment> = emptyList(),
    val timestamp: Long = 0L,
    // For command executions
    val command: String? = null,
    val output: String? = null,
    val status: ExecutionStatus? = null,
    // For tool results
    val toolResult: ToolResult? = null
)

@Serializable
enum class MessageRole {
    @SerialName("user")
    USER,
    @SerialName("assistant")
    ASSISTANT,
    @SerialName("tool_result")
    TOOL_RESULT,
    @SerialName("commandExecution")
    COMMAND_EXECUTION
}

@Serializable
enum class ExecutionStatus {
    @SerialName("running")
    RUNNING,
    @SerialName("completed")
    COMPLETED,
    @SerialName("error")
    ERROR
}

@Serializable
data class Attachment(
    val name: String,
    val path: String,
    val size: Long? = null,
    val mimeType: String? = null
)

@Serializable
data class ToolResult(
    val callId: String,
    val name: String,
    val output: String,
    val success: Boolean
)
