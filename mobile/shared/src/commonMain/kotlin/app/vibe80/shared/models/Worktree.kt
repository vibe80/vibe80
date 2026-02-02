package app.vibe80.shared.models

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
) {
    companion object {
        /** Default "main" worktree ID */
        const val MAIN_WORKTREE_ID = "main"

        /** Available worktree colors */
        val COLORS = listOf(
            "#4CAF50", // Green
            "#2196F3", // Blue
            "#FF9800", // Orange
            "#9C27B0", // Purple
            "#F44336", // Red
            "#00BCD4", // Cyan
            "#FFEB3B", // Yellow
            "#795548"  // Brown
        )

        /** Create the default main worktree */
        fun createMain(provider: LLMProvider): Worktree = Worktree(
            id = MAIN_WORKTREE_ID,
            name = "main",
            branchName = "main",
            provider = provider,
            status = WorktreeStatus.READY,
            color = "#4CAF50"
        )
    }
}

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
    ERROR,
    @SerialName("merging")
    MERGING,
    @SerialName("merge_conflict")
    MERGE_CONFLICT
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

@Serializable
data class WorktreeMergeResponse(
    val success: Boolean,
    val message: String? = null,
    val hasConflicts: Boolean = false,
    val conflictFiles: List<String> = emptyList()
)

@Serializable
data class WorktreeCloseResponse(
    val success: Boolean,
    val message: String? = null
)

@Serializable
data class WorktreeGetResponse(
    val id: String,
    val name: String? = null,
    val branchName: String? = null,
    val provider: LLMProvider? = null,
    val status: WorktreeStatus? = null,
    val messages: List<ChatMessage> = emptyList()
)
