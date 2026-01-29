package app.vibe80.shared.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

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
    val auth: SessionAuth? = null
)

@Serializable
data class SessionAuth(
    val type: String,
    val key: String? = null,       // for SSH
    val username: String? = null,  // for HTTP
    val password: String? = null   // for HTTP
)

@Serializable
data class SessionCreateResponse(
    val sessionId: String,
    val path: String,
    val repoUrl: String,
    @SerialName("default_provider")
    val defaultProvider: String,
    val providers: List<String>,
    val messages: List<ChatMessage> = emptyList()
)

@Serializable
data class SessionGetResponse(
    val messages: List<ChatMessage> = emptyList(),
    val rpcLogs: List<RpcLogEntry> = emptyList(),
    val repoDiff: RepoDiff? = null,
    @SerialName("default_provider")
    val defaultProvider: String? = null,
    val providers: List<String> = emptyList()
)

@Serializable
data class RpcLogEntry(
    val direction: String,
    val timestamp: Long,
    val payload: JsonElement
)

@Serializable
data class AttachmentUploadResponse(
    val files: List<UploadedFile>
)

@Serializable
data class UploadedFile(
    val name: String,
    val path: String,
    val size: Long
)

@Serializable
data class AttachmentListResponse(
    val files: List<UploadedFile>
)
