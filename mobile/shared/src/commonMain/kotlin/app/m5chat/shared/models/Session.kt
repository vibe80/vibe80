package app.m5chat.shared.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class SessionState(
    val sessionId: String,
    val repoUrl: String,
    val activeProvider: LLMProvider,
    val providers: List<LLMProvider>,
    val connected: Boolean = false,
    val processing: Boolean = false,
    val appServerReady: Boolean = false
)

@Serializable
enum class LLMProvider {
    @SerialName("codex")
    CODEX,
    @SerialName("claude")
    CLAUDE
}

@Serializable
data class SessionCreateRequest(
    val repoUrl: String,
    val provider: String = "codex",
    val providers: List<String> = listOf("codex", "claude"),
    val sshKey: String? = null,
    val httpUser: String? = null,
    val httpPassword: String? = null
)

@Serializable
data class SessionCreateResponse(
    val sessionId: String,
    val path: String,
    val repoUrl: String,
    val provider: String,
    val providers: List<String>,
    val messages: List<ChatMessage> = emptyList()
)

@Serializable
data class SessionGetResponse(
    val messages: List<ChatMessage> = emptyList(),
    val rpcLogs: List<RpcLogEntry> = emptyList(),
    val repoDiff: RepoDiff? = null
)

@Serializable
data class RpcLogEntry(
    val direction: String,
    val timestamp: Long,
    val payload: String
)
