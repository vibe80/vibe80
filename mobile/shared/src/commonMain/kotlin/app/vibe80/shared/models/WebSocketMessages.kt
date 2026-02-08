package app.vibe80.shared.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Messages sent from server to client via WebSocket
 */
@Serializable
sealed class ServerMessage {
    abstract val type: String
}

@Serializable
@SerialName("ready")
data class ReadyMessage(
    override val type: String = "ready",
    val threadId: String,
    val provider: String
) : ServerMessage()

@Serializable
@SerialName("status")
data class StatusMessage(
    override val type: String = "status",
    val message: String,
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("provider_status")
data class ProviderStatusMessage(
    override val type: String = "provider_status",
    val status: String,
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("assistant_delta")
data class AssistantDeltaMessage(
    override val type: String = "assistant_delta",
    val delta: String,
    val itemId: String,
    val turnId: String,
    val worktreeId: String? = null,
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("assistant_message")
data class AssistantMessageComplete(
    override val type: String = "assistant_message",
    val text: String,
    val itemId: String,
    val turnId: String,
    val worktreeId: String? = null,
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("turn_started")
data class TurnStartedMessage(
    override val type: String = "turn_started",
    val threadId: String,
    val turnId: String,
    val status: String,
    val worktreeId: String? = null,
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("turn_completed")
data class TurnCompletedMessage(
    override val type: String = "turn_completed",
    val threadId: String,
    val turnId: String,
    val status: String,
    val error: String? = null,
    val worktreeId: String? = null,
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("turn_error")
data class TurnErrorMessage(
    override val type: String = "turn_error",
    val threadId: String? = null,
    val turnId: String? = null,
    val willRetry: Boolean = false,
    val message: String? = null,
    val error: String? = null,
    val worktreeId: String? = null,
    val provider: String? = null
) : ServerMessage() {
    /** Returns the error message from either 'message' or 'error' field */
    val errorMessage: String?
        get() = message ?: error
}

/**
 * Generic error message sent by server (e.g., when app-server fails to start)
 */
@Serializable
@SerialName("error")
data class ErrorMessage(
    override val type: String = "error",
    val message: String,
    val provider: String? = null,
    val details: String? = null
) : ServerMessage()

@Serializable
@SerialName("provider_switched")
data class ProviderSwitchedMessage(
    override val type: String = "provider_switched",
    val provider: String,
    val messages: List<ChatMessage> = emptyList(),
    val models: List<String>? = null
) : ServerMessage()

@Serializable
@SerialName("worktree_messages_sync")
data class WorktreeMessagesSyncMessage(
    override val type: String = "worktree_messages_sync",
    val worktreeId: String,
    val messages: List<ChatMessage> = emptyList(),
    val status: WorktreeStatus? = null
) : ServerMessage()

@Serializable
@SerialName("worktree_created")
data class WorktreeCreatedMessage(
    override val type: String = "worktree_created",
    val worktree: Worktree
) : ServerMessage()

@Serializable
@SerialName("worktree_updated")
data class WorktreeUpdatedMessage(
    override val type: String = "worktree_updated",
    val worktreeId: String,
    val status: WorktreeStatus? = null,
    val changes: Map<String, JsonElement> = emptyMap()
) : ServerMessage()

@Serializable
@SerialName("worktree_status")
data class WorktreeStatusMessage(
    override val type: String = "worktree_status",
    val worktreeId: String,
    val status: WorktreeStatus? = null,
    val error: String? = null
) : ServerMessage()

@Serializable
@SerialName("worktree_send_message")
data class WorktreeMessageEvent(
    override val type: String = "worktree_send_message",
    val worktreeId: String,
    val message: ChatMessage
) : ServerMessage()

@Serializable
@SerialName("worktree_delta")
data class WorktreeDeltaMessage(
    override val type: String = "worktree_delta",
    val worktreeId: String,
    val delta: String,
    val itemId: String,
    val turnId: String
) : ServerMessage()

@Serializable
@SerialName("worktree_turn_started")
data class WorktreeTurnStartedMessage(
    override val type: String = "worktree_turn_started",
    val worktreeId: String,
    val turnId: String
) : ServerMessage()

@Serializable
@SerialName("worktree_turn_completed")
data class WorktreeTurnCompletedMessage(
    override val type: String = "worktree_turn_completed",
    val worktreeId: String,
    val turnId: String,
    val status: String
) : ServerMessage()

@Serializable
@SerialName("worktree_closed")
data class WorktreeClosedMessage(
    override val type: String = "worktree_closed",
    val worktreeId: String
) : ServerMessage()

@Serializable
@SerialName("worktree_merge_result")
data class WorktreeMergeResultMessage(
    override val type: String = "worktree_merge_result",
    val worktreeId: String,
    val success: Boolean,
    val message: String? = null,
    val hasConflicts: Boolean = false,
    val conflictFiles: List<String> = emptyList()
) : ServerMessage()

@Serializable
@SerialName("worktrees_list")
data class WorktreesListMessage(
    override val type: String = "worktrees_list",
    val worktrees: List<Worktree>
) : ServerMessage()

@Serializable
@SerialName("repo_diff")
data class RepoDiffMessage(
    override val type: String = "repo_diff",
    val status: String,
    val diff: String,
    val worktreeId: String? = null
) : ServerMessage()

@Serializable
@SerialName("pong")
data class PongMessage(
    override val type: String = "pong"
) : ServerMessage()

@Serializable
@SerialName("command_execution_delta")
data class CommandExecutionDeltaMessage(
    override val type: String = "command_execution_delta",
    val delta: String,
    val itemId: String,
    val turnId: String,
    val worktreeId: String? = null
) : ServerMessage()

@Serializable
@SerialName("command_execution_completed")
data class CommandExecutionCompletedMessage(
    override val type: String = "command_execution_completed",
    val item: ChatMessage,
    val itemId: String,
    val turnId: String,
    val worktreeId: String? = null
) : ServerMessage()

/**
 * Messages sent from client to server via WebSocket
 */
@Serializable
sealed class ClientMessage {
    abstract val type: String
}

@Serializable
data class PingMessage(
    override val type: String = "ping"
) : ClientMessage()

@Serializable
data class SendMessageRequest(
    override val type: String = "user_message",
    val text: String,
    val attachments: List<Attachment> = emptyList()
) : ClientMessage()

@Serializable
data class SwitchProviderRequest(
    override val type: String = "switch_provider",
    val provider: String
) : ClientMessage()

@Serializable
data class WorktreeMessageRequest(
    override val type: String = "worktree_send_message",
    val worktreeId: String,
    val text: String,
    val displayText: String? = null,
    val attachments: List<Attachment> = emptyList()
) : ClientMessage()

@Serializable
data class ListWorktreesRequest(
    override val type: String = "list_worktrees"
) : ClientMessage()

@Serializable
data class SyncWorktreeMessagesRequest(
    override val type: String = "worktree_messages_sync",
    val worktreeId: String,
    val lastSeenMessageId: String? = null
) : ClientMessage()
