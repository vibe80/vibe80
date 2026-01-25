package app.m5chat.shared.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Worktree(
    val id: String,
    val name: String,
    val branchName: String,
    val provider: LLMProvider,
    val status: WorktreeStatus,
    val color: String,
    val parentId: String? = null,
    val createdAt: Long = 0L
)

@Serializable
enum class WorktreeStatus {
    @SerialName("creating")
    CREATING,
    @SerialName("ready")
    READY,
    @SerialName("processing")
    PROCESSING,
    @SerialName("completed")
    COMPLETED,
    @SerialName("error")
    ERROR
}

@Serializable
data class WorktreeCreateRequest(
    val provider: String,
    val parentWorktreeId: String? = null,
    val name: String,
    val branchName: String? = null
)

@Serializable
data class WorktreeDiffResponse(
    val status: String,
    val diff: String
)
