package app.vibe80.shared.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.datetime.Instant

object FlexibleTimestampAsLongSerializer : KSerializer<Long> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("FlexibleTimestampAsLong", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Long {
        val jsonDecoder = decoder as? JsonDecoder ?: return decoder.decodeLong()
        val element = jsonDecoder.decodeJsonElement() as? JsonPrimitive ?: return 0L

        element.longOrNull?.let { return it }

        val raw = element.contentOrNull?.trim().orEmpty()
        if (raw.isEmpty()) return 0L

        raw.toLongOrNull()?.let { return it }

        return try {
            Instant.parse(raw).toEpochMilliseconds()
        } catch (_: Exception) {
            0L
        }
    }

    override fun serialize(encoder: Encoder, value: Long) {
        encoder.encodeLong(value)
    }
}

object FlexibleNullableTimestampAsLongSerializer : KSerializer<Long?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("FlexibleNullableTimestampAsLong", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Long? {
        val jsonDecoder = decoder as? JsonDecoder
        if (jsonDecoder == null) {
            return runCatching { decoder.decodeLong() }.getOrNull()
        }
        val element = jsonDecoder.decodeJsonElement() as? JsonPrimitive ?: return null
        if (element.isString && element.contentOrNull.isNullOrBlank()) return null
        element.longOrNull?.let { return it }
        val raw = element.contentOrNull?.trim().orEmpty()
        if (raw.isEmpty()) return null
        raw.toLongOrNull()?.let { return it }
        return runCatching { Instant.parse(raw).toEpochMilliseconds() }.getOrNull()
    }

    override fun serialize(encoder: Encoder, value: Long?) {
        if (value == null) {
            encoder.encodeNull()
        } else {
            encoder.encodeLong(value)
        }
    }
}

@Serializable
data class Worktree(
    val id: String,
    val name: String,
    val branchName: String,
    val provider: LLMProvider,
    val status: WorktreeStatus,
    val color: String,
    val parentId: String? = null,
    @Serializable(with = FlexibleTimestampAsLongSerializer::class)
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
    @SerialName("idle")
    IDLE,
    @SerialName("stopped")
    STOPPED,
    @SerialName("error")
    ERROR,
    @SerialName("merging")
    MERGING,
    @SerialName("merge_conflict")
    MERGE_CONFLICT;

    companion object {
        fun fromWire(value: String?): WorktreeStatus? =
            when (value?.lowercase()) {
                null -> null
                "creating" -> CREATING
                "ready" -> READY
                "processing" -> PROCESSING
                "completed" -> COMPLETED
                "idle" -> IDLE
                "stopped" -> STOPPED
                "error" -> ERROR
                "merging" -> MERGING
                "merge_conflict" -> MERGE_CONFLICT
                else -> READY
            }
    }
}

@Serializable
data class WorktreeCreateRequest(
    val provider: String,
    val context: String? = null,
    val sourceWorktree: String? = null,
    val parentWorktreeId: String? = null,
    val name: String? = null,
    val startingBranch: String? = null,
    val model: String? = null,
    val reasoningEffort: String? = null,
    val internetAccess: Boolean? = null,
    val denyGitCredentialsAccess: Boolean? = null
)

@Serializable
data class WorktreeCreateApiRequest(
    val session: String,
    val provider: String,
    val context: String? = null,
    val sourceWorktree: String? = null,
    val name: String? = null,
    val parentWorktreeId: String? = null,
    val startingBranch: String? = null,
    val model: String? = null,
    val reasoningEffort: String? = null,
    val internetAccess: Boolean? = null,
    val denyGitCredentialsAccess: Boolean? = null
)

@Serializable
data class WorktreeCreateResponse(
    val worktreeId: String,
    val name: String? = null,
    val branchName: String? = null,
    val provider: String? = null,
    val status: WorktreeStatus? = null,
    val color: String? = null,
    val internetAccess: Boolean? = null,
    val denyGitCredentialsAccess: Boolean? = null
)

@Serializable
data class WorktreeDiffResponse(
    val status: String,
    val diff: String
)

@Serializable
data class WorktreeFileResponse(
    val path: String,
    val content: String,
    val truncated: Boolean = false,
    val binary: Boolean = false
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

@Serializable
data class WorktreesListResponse(
    val worktrees: List<Worktree> = emptyList()
)
