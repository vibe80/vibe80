package app.m5chat.shared.network

import app.m5chat.shared.logging.AppLogger
import app.m5chat.shared.models.*
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    ERROR
}

class WebSocketManager(
    private val httpClient: HttpClient,
    private val baseUrl: String,
    private val json: Json = HttpClientFactory.json
) {
    private var session: DefaultClientWebSocketSession? = null
    private var pingJob: Job? = null
    private var reconnectJob: Job? = null
    private var connectionJob: Job? = null
    private var sessionId: String? = null

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _messages = MutableSharedFlow<ServerMessage>(extraBufferCapacity = 64)
    val messages: SharedFlow<ServerMessage> = _messages.asSharedFlow()

    private val _errors = MutableSharedFlow<Throwable>(extraBufferCapacity = 8)
    val errors: SharedFlow<Throwable> = _errors.asSharedFlow()

    private val outgoingMessages = Channel<ClientMessage>(Channel.BUFFERED)

    private var reconnectAttempt = 0
    private val maxReconnectAttempts = 10
    private val initialReconnectDelay = 1000L
    private val maxReconnectDelay = 30000L

    fun connect(sessionId: String) {
        this.sessionId = sessionId
        reconnectAttempt = 0
        // Launch connection in a separate coroutine to avoid blocking the caller
        connectionJob?.cancel()
        connectionJob = CoroutineScope(Dispatchers.Default).launch {
            doConnect()
        }
    }

    private suspend fun doConnect() {
        val currentSessionId = sessionId ?: return

        _connectionState.value = if (reconnectAttempt > 0) {
            ConnectionState.RECONNECTING
        } else {
            ConnectionState.CONNECTING
        }

        try {
            val wsUrl = baseUrl
                .replace("http://", "ws://")
                .replace("https://", "wss://")

            val fullWsUrl = "$wsUrl/ws?session=$currentSessionId"
            AppLogger.wsConnecting(fullWsUrl)
            AppLogger.info(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Starting WebSocket connection", "url=$fullWsUrl")

            httpClient.webSocket(fullWsUrl) {
                session = this
                _connectionState.value = ConnectionState.CONNECTED
                reconnectAttempt = 0
                AppLogger.wsConnected(fullWsUrl)
                AppLogger.info(app.m5chat.shared.logging.LogSource.WEBSOCKET, "WebSocket session established", "session=${this::class.simpleName}")

                // Start ping job
                pingJob = launch {
                    AppLogger.debug(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Ping job started")
                    try {
                        while (isActive) {
                            delay(25_000)
                            send(PingMessage())
                        }
                    } catch (e: Exception) {
                        AppLogger.error(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Ping job error: ${e::class.simpleName}", e.message ?: e.toString())
                    }
                }

                // Start outgoing message handler
                val outgoingJob = launch {
                    AppLogger.debug(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Outgoing message handler started")
                    try {
                        for (message in outgoingMessages) {
                            val jsonString = json.encodeToString(ClientMessage.serializer(), message)
                            val messageType = when (message) {
                                is PingMessage -> "ping"
                                is SendMessageRequest -> "user_message"
                                is SwitchProviderRequest -> "switch_provider"
                                is WorktreeMessageRequest -> "worktree_message"
                                is CreateWorktreeRequest -> "create_worktree"
                                is ListWorktreesRequest -> "list_worktrees"
                                is CloseWorktreeRequest -> "close_worktree"
                                is MergeWorktreeRequest -> "merge_worktree"
                                is SyncMessagesRequest -> "sync_messages"
                                else -> "unknown"
                            }
                            AppLogger.wsSend(messageType, jsonString)
                            send(Frame.Text(jsonString))
                        }
                    } catch (e: Exception) {
                        AppLogger.error(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Outgoing handler error: ${e::class.simpleName}", e.message ?: e.toString())
                    }
                }

                // Handle incoming messages
                AppLogger.info(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Starting incoming message loop")
                try {
                    for (frame in incoming) {
                        try {
                            when (frame) {
                                is Frame.Text -> {
                                    val text = frame.readText()
                                    parseAndEmitMessage(text)
                                }
                                is Frame.Close -> {
                                    val reason = closeReason.await()
                                    AppLogger.info(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Received close frame", "code=${reason?.code}, reason=${reason?.message}")
                                    break
                                }
                                is Frame.Ping -> {
                                    AppLogger.debug(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Received ping frame")
                                }
                                is Frame.Pong -> {
                                    AppLogger.debug(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Received pong frame")
                                }
                                else -> {
                                    AppLogger.warning(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Unknown frame type", frame::class.simpleName ?: "unknown")
                                }
                            }
                        } catch (e: Exception) {
                            AppLogger.error(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Error processing frame: ${e::class.simpleName}", e.message ?: e.toString())
                            // Continue processing other frames
                        }
                    }
                    AppLogger.info(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Incoming message loop ended normally")
                } catch (e: Exception) {
                    AppLogger.error(app.m5chat.shared.logging.LogSource.WEBSOCKET, "WebSocket receive loop error: ${e::class.simpleName}", e.message ?: e.toString())
                } finally {
                    AppLogger.info(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Cleaning up WebSocket jobs")
                    outgoingJob.cancel()
                    pingJob?.cancel()
                }
            }
            // WebSocket closed normally, attempt to reconnect
            AppLogger.info(app.m5chat.shared.logging.LogSource.WEBSOCKET, "WebSocket block exited, scheduling reconnect")
            _connectionState.value = ConnectionState.DISCONNECTED
            scheduleReconnect()
        } catch (e: Exception) {
            AppLogger.error(app.m5chat.shared.logging.LogSource.WEBSOCKET, "WebSocket connection error: ${e::class.simpleName}", e.stackTraceToString())
            _connectionState.value = ConnectionState.ERROR
            _errors.emit(e)
            scheduleReconnect()
        }
    }

    private fun parseAndEmitMessage(text: String) {
        try {
            // First parse to get the type
            val jsonObject = json.decodeFromString<JsonObject>(text)
            val type = jsonObject["type"]?.jsonPrimitive?.content ?: "unknown"

            // Log received message (skip pong to reduce noise)
            if (type != "pong") {
                AppLogger.wsReceive(type, text)
            }

            val message: ServerMessage? = when (type) {
                "ready" -> json.decodeFromString<ReadyMessage>(text)
                "status" -> json.decodeFromString<StatusMessage>(text)
                "assistant_delta" -> json.decodeFromString<AssistantDeltaMessage>(text)
                "assistant_message" -> json.decodeFromString<AssistantMessageComplete>(text)
                "turn_started" -> json.decodeFromString<TurnStartedMessage>(text)
                "turn_completed" -> json.decodeFromString<TurnCompletedMessage>(text)
                "turn_error" -> json.decodeFromString<TurnErrorMessage>(text)
                "error" -> json.decodeFromString<ErrorMessage>(text)
                "provider_switched" -> json.decodeFromString<ProviderSwitchedMessage>(text)
                "messages_sync" -> json.decodeFromString<MessagesSyncMessage>(text)
                "worktree_created" -> json.decodeFromString<WorktreeCreatedMessage>(text)
                "worktree_updated" -> json.decodeFromString<WorktreeUpdatedMessage>(text)
                "worktree_message" -> json.decodeFromString<WorktreeMessageEvent>(text)
                "worktree_delta" -> json.decodeFromString<WorktreeDeltaMessage>(text)
                "worktree_turn_started" -> json.decodeFromString<WorktreeTurnStartedMessage>(text)
                "worktree_turn_completed" -> json.decodeFromString<WorktreeTurnCompletedMessage>(text)
                "worktree_closed" -> json.decodeFromString<WorktreeClosedMessage>(text)
                "worktree_merge_result" -> json.decodeFromString<WorktreeMergeResultMessage>(text)
                "worktrees_list" -> json.decodeFromString<WorktreesListMessage>(text)
                "repo_diff" -> json.decodeFromString<RepoDiffMessage>(text)
                "pong" -> json.decodeFromString<PongMessage>(text)
                "command_execution_delta" -> json.decodeFromString<CommandExecutionDeltaMessage>(text)
                "command_execution_completed" -> json.decodeFromString<CommandExecutionCompletedMessage>(text)
                else -> {
                    AppLogger.warning(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Unknown message type: $type", text)
                    null
                }
            }

            message?.let { _messages.tryEmit(it) }
        } catch (e: Exception) {
            AppLogger.error(app.m5chat.shared.logging.LogSource.WEBSOCKET, "Parse error: ${e.message}", text)
        }
    }

    private fun scheduleReconnect() {
        if (reconnectAttempt >= maxReconnectAttempts) {
            _connectionState.value = ConnectionState.ERROR
            return
        }

        reconnectJob?.cancel()
        reconnectJob = CoroutineScope(Dispatchers.Default).launch {
            val delay = (initialReconnectDelay * (1 shl reconnectAttempt))
                .coerceAtMost(maxReconnectDelay)
            delay(delay)
            reconnectAttempt++
            doConnect()
        }
    }

    suspend fun send(message: ClientMessage) {
        outgoingMessages.send(message)
    }

    suspend fun sendMessage(text: String, attachments: List<Attachment> = emptyList()) {
        send(SendMessageRequest(text = text, attachments = attachments))
    }

    suspend fun switchProvider(provider: String) {
        send(SwitchProviderRequest(provider = provider))
    }

    suspend fun sendWorktreeMessage(
        worktreeId: String,
        text: String,
        displayText: String? = null,
        attachments: List<Attachment> = emptyList()
    ) {
        send(WorktreeMessageRequest(
            worktreeId = worktreeId,
            text = text,
            displayText = displayText,
            attachments = attachments
        ))
    }

    suspend fun createWorktree(
        provider: String,
        name: String,
        parentWorktreeId: String? = null,
        branchName: String? = null
    ) {
        send(CreateWorktreeRequest(
            provider = provider,
            name = name,
            parentWorktreeId = parentWorktreeId,
            branchName = branchName
        ))
    }

    suspend fun closeWorktree(worktreeId: String) {
        send(CloseWorktreeRequest(worktreeId = worktreeId))
    }

    suspend fun mergeWorktree(worktreeId: String) {
        send(MergeWorktreeRequest(worktreeId = worktreeId))
    }

    suspend fun listWorktrees() {
        send(ListWorktreesRequest())
    }

    fun disconnect() {
        AppLogger.wsDisconnected("Client initiated disconnect")
        connectionJob?.cancel()
        reconnectJob?.cancel()
        pingJob?.cancel()
        session?.let {
            CoroutineScope(Dispatchers.Default).launch {
                it.close(CloseReason(CloseReason.Codes.NORMAL, "Client disconnect"))
            }
        }
        session = null
        _connectionState.value = ConnectionState.DISCONNECTED
    }
}
