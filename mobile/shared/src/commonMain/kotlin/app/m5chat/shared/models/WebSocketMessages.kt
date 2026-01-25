package app.m5chat.shared.models

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
@SerialName("assistant_delta")
data class AssistantDeltaMessage(
    override val type: String = "assistant_delta",
    val delta: String,
    val itemId: String,
    val turnId: String,
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("assistant_message")
data class AssistantMessageComplete(
    override val type: String = "assistant_message",
    val text: String,
    val itemId: String,
    val turnId: String,
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("turn_started")
data class TurnStartedMessage(
    override val type: String = "turn_started",
    val threadId: String,
    val turnId: String,
    val status: String,
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
    val provider: String? = null
) : ServerMessage()

@Serializable
@SerialName("turn_error")
data class TurnErrorMessage(
    override val type: String = "turn_error",
    val threadId: String,
    val turnId: String,
    val willRetry: Boolean,
    val message: String,
    val provider: String? = null
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
@SerialName("messages_sync")
data class MessagesSyncMessage(
    override val type: String = "messages_sync",
    val provider: String,
    val messages: List<ChatMessage> = emptyList()
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
    val changes: Map<String, JsonElement> = emptyMap()
) : ServerMessage()

@Serializable
@SerialName("repo_diff")
data class RepoDiffMessage(
    override val type: String = "repo_diff",
    val status: String,
    val diff: String
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
    val turnId: String
) : ServerMessage()

@Serializable
@SerialName("command_execution_completed")
data class CommandExecutionCompletedMessage(
    override val type: String = "command_execution_completed",
    val item: ChatMessage,
    val itemId: String,
    val turnId: String
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
    override val type: String = "send_message",
    val text: String,
    val attachments: List<String> = emptyList()
) : ClientMessage()

@Serializable
data class SwitchProviderRequest(
    override val type: String = "switch_provider",
    val provider: String
) : ClientMessage()

@Serializable
data class CreateWorktreeRequest(
    override val type: String = "create_parallel_request",
    val provider: String,
    val parentWorktreeId: String? = null,
    val name: String,
    val branchName: String? = null
) : ClientMessage()

@Serializable
data class WorktreeMessageRequest(
    override val type: String = "worktree_message",
    val worktreeId: String,
    val text: String,
    val displayText: String? = null,
    val attachments: List<String> = emptyList()
) : ClientMessage()

@Serializable
data class ListWorktreesRequest(
    override val type: String = "list_worktrees"
) : ClientMessage()

@Serializable
data class SyncMessagesRequest(
    override val type: String = "sync_messages",
    val provider: String,
    val lastSeenMessageId: String? = null
) : ClientMessage()
