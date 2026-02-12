package app.vibe80.shared.network

import app.vibe80.shared.logging.AppLogger
import app.vibe80.shared.models.*
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

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
    @Volatile private var workspaceToken: String? = null

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

    fun setWorkspaceToken(token: String?) {
        workspaceToken = token?.takeIf { it.isNotBlank() }
    }

    fun connect(sessionId: String) {
        if (this.sessionId == sessionId &&
            (connectionState.value == ConnectionState.CONNECTED ||
                connectionState.value == ConnectionState.CONNECTING ||
                connectionState.value == ConnectionState.RECONNECTING)
        ) {
            return
        }
        reconnectJob?.cancel()
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
        val token = workspaceToken
        if (token.isNullOrBlank()) {
            _connectionState.value = ConnectionState.ERROR
            _errors.tryEmit(IllegalStateException("Missing workspace token for WebSocket connection"))
            return
        }

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
            AppLogger.info(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Starting WebSocket connection", "url=$fullWsUrl")

            httpClient.webSocket(fullWsUrl) {
                session = this
                _connectionState.value = ConnectionState.CONNECTED
                reconnectAttempt = 0
                AppLogger.wsConnected(fullWsUrl)
                AppLogger.info(app.vibe80.shared.logging.LogSource.WEBSOCKET, "WebSocket session established", "session=${this::class.simpleName}")

                // Send auth message expected by server
                try {
                    val authPayload = json.encodeToString(AuthMessage.serializer(), AuthMessage(token = token))
                    AppLogger.wsSend("auth", authPayload)
                    send(Frame.Text(authPayload))
                } catch (e: Exception) {
                    AppLogger.error(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Auth send error: ${e::class.simpleName}", e.message ?: e.toString())
                    throw e
                }

                // Start ping job
                pingJob = launch {
                    AppLogger.debug(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Ping job started")
                    try {
                        while (isActive) {
                            delay(25_000)
                            send(PingMessage())
                        }
                    } catch (e: Exception) {
                        AppLogger.error(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Ping job error: ${e::class.simpleName}", e.message ?: e.toString())
                    }
                }

                // Start outgoing message handler
                val outgoingJob = launch {
                    AppLogger.debug(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Outgoing message handler started")
                    try {
                        for (message in outgoingMessages) {
                            // Encode each message type with its specific serializer to avoid sealed class issues
                            val (messageType, jsonString) = when (message) {
                                is PingMessage -> "ping" to json.encodeToString(PingMessage.serializer(), message)
                                is AuthMessage -> "auth" to json.encodeToString(AuthMessage.serializer(), message)
                                is WakeUpRequest -> "wake_up" to json.encodeToString(WakeUpRequest.serializer(), message)
                                is SwitchProviderRequest -> "switch_provider" to json.encodeToString(SwitchProviderRequest.serializer(), message)
                                is TurnInterruptRequest -> "turn_interrupt" to json.encodeToString(TurnInterruptRequest.serializer(), message)
                                is ModelListRequest -> "model_list" to json.encodeToString(ModelListRequest.serializer(), message)
                                is ModelSetRequest -> "model_set" to json.encodeToString(ModelSetRequest.serializer(), message)
                                is AccountLoginStartRequest -> "account_login_start" to json.encodeToString(AccountLoginStartRequest.serializer(), message)
                                is ActionRequestClientMessage -> "action_request" to json.encodeToString(ActionRequestClientMessage.serializer(), message)
                                is WorktreeMessageRequest -> "worktree_send_message" to json.encodeToString(WorktreeMessageRequest.serializer(), message)
                                is SyncWorktreeMessagesRequest -> "worktree_messages_sync" to json.encodeToString(SyncWorktreeMessagesRequest.serializer(), message)
                            }
                            AppLogger.wsSend(messageType, jsonString)
                            send(Frame.Text(jsonString))
                        }
                    } catch (e: Exception) {
                        AppLogger.error(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Outgoing handler error: ${e::class.simpleName}", e.message ?: e.toString())
                    }
                }

                // Handle incoming messages
                AppLogger.info(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Starting incoming message loop")
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
                                    AppLogger.info(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Received close frame", "code=${reason?.code}, reason=${reason?.message}")
                                    break
                                }
                                is Frame.Ping -> {
                                    AppLogger.debug(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Received ping frame")
                                }
                                is Frame.Pong -> {
                                    AppLogger.debug(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Received pong frame")
                                }
                                else -> {
                                    AppLogger.warning(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Unknown frame type", frame::class.simpleName ?: "unknown")
                                }
                            }
                        } catch (e: Exception) {
                            AppLogger.error(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Error processing frame: ${e::class.simpleName}", e.message ?: e.toString())
                            // Continue processing other frames
                        }
                    }
                    AppLogger.info(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Incoming message loop ended normally")
                } catch (e: Exception) {
                    AppLogger.error(app.vibe80.shared.logging.LogSource.WEBSOCKET, "WebSocket receive loop error: ${e::class.simpleName}", e.message ?: e.toString())
                } finally {
                    AppLogger.info(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Cleaning up WebSocket jobs")
                    outgoingJob.cancel()
                    pingJob?.cancel()
                }
            }
            // WebSocket closed normally, attempt to reconnect
            AppLogger.info(app.vibe80.shared.logging.LogSource.WEBSOCKET, "WebSocket block exited, scheduling reconnect")
            _connectionState.value = ConnectionState.DISCONNECTED
            scheduleReconnect()
        } catch (e: Exception) {
            AppLogger.error(app.vibe80.shared.logging.LogSource.WEBSOCKET, "WebSocket connection error: ${e::class.simpleName}", e.stackTraceToString())
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
                "auth_ok" -> json.decodeFromString<AuthOkMessage>(text)
                "ready" -> json.decodeFromString<ReadyMessage>(text)
                "status" -> json.decodeFromString<StatusMessage>(text)
                "provider_status" -> json.decodeFromString<ProviderStatusMessage>(text)
                "assistant_delta" -> json.decodeFromString<AssistantDeltaMessage>(text)
                "assistant_message" -> json.decodeFromString<AssistantMessageComplete>(text)
                "turn_started" -> json.decodeFromString<TurnStartedMessage>(text)
                "turn_completed" -> json.decodeFromString<TurnCompletedMessage>(text)
                "turn_error" -> json.decodeFromString<TurnErrorMessage>(text)
                "error" -> json.decodeFromString<ErrorMessage>(text)
                "provider_switched" -> json.decodeFromString<ProviderSwitchedMessage>(text)
                "worktree_ready" -> json.decodeFromString<WorktreeReadyMessage>(text)
                "worktree_removed" -> json.decodeFromString<WorktreeRemovedMessage>(text)
                "worktree_renamed" -> json.decodeFromString<WorktreeRenamedMessage>(text)
                "worktree_messages_sync" -> json.decodeFromString<WorktreeMessagesSyncMessage>(text)
                "worktree_created" -> parseWorktreeCreated(jsonObject, text)
                "worktree_updated" -> json.decodeFromString<WorktreeUpdatedMessage>(text)
                "worktree_status" -> json.decodeFromString<WorktreeStatusMessage>(text)
                "worktree_send_message" -> json.decodeFromString<WorktreeMessageEvent>(text)
                "worktree_delta" -> json.decodeFromString<WorktreeDeltaMessage>(text)
                "worktree_turn_completed" -> json.decodeFromString<WorktreeTurnCompletedMessage>(text)
                "worktree_closed" -> json.decodeFromString<WorktreeClosedMessage>(text)
                "worktree_merge_result" -> json.decodeFromString<WorktreeMergeResultMessage>(text)
                "worktrees_list" -> json.decodeFromString<WorktreesListMessage>(text)
                "repo_diff" -> json.decodeFromString<RepoDiffMessage>(text)
                "worktree_diff" -> json.decodeFromString<WorktreeDiffMessage>(text)
                "pong" -> json.decodeFromString<PongMessage>(text)
                "command_execution_delta" -> json.decodeFromString<CommandExecutionDeltaMessage>(text)
                "command_execution_completed" -> json.decodeFromString<CommandExecutionCompletedMessage>(text)
                "rpc_log" -> json.decodeFromString<RpcLogMessage>(text)
                "agent_reasoning" -> json.decodeFromString<AgentReasoningMessage>(text)
                "item_started" -> json.decodeFromString<ItemStartedMessage>(text)
                "action_request" -> json.decodeFromString<ActionRequestMessage>(text)
                "action_result" -> json.decodeFromString<ActionResultMessage>(text)
                "model_list" -> json.decodeFromString<ModelListMessage>(text)
                "model_set" -> json.decodeFromString<ModelSetMessage>(text)
                "turn_interrupt_sent" -> json.decodeFromString<TurnInterruptSentMessage>(text)
                "account_login_started" -> json.decodeFromString<AccountLoginStartedMessage>(text)
                "account_login_error" -> json.decodeFromString<AccountLoginErrorMessage>(text)
                "account_login_completed" -> json.decodeFromString<AccountLoginCompletedMessage>(text)
                else -> {
                    AppLogger.warning(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Unknown message type: $type", text)
                    null
                }
            }

            message?.let { _messages.tryEmit(it) }
        } catch (e: Exception) {
            AppLogger.error(app.vibe80.shared.logging.LogSource.WEBSOCKET, "Parse error: ${e.message}", text)
        }
    }

    private fun parseWorktreeCreated(jsonObject: JsonObject, raw: String): ServerMessage? {
        return try {
            if (jsonObject.containsKey("worktree")) {
                json.decodeFromJsonElement<WorktreeCreatedMessage>(jsonObject)
            } else {
                val id = jsonObject["worktreeId"]?.jsonPrimitive?.contentOrNull
                    ?: return null
                val name = jsonObject["name"]?.jsonPrimitive?.contentOrNull ?: id
                val branchName = jsonObject["branchName"]?.jsonPrimitive?.contentOrNull ?: name
                val providerValue = jsonObject["provider"]?.jsonPrimitive?.contentOrNull ?: "codex"
                val provider = runCatching {
                    LLMProvider.valueOf(providerValue.uppercase())
                }.getOrElse { LLMProvider.CODEX }
                val statusValue = jsonObject["status"]?.jsonPrimitive?.contentOrNull ?: "ready"
                val status = WorktreeStatus.fromWire(statusValue) ?: WorktreeStatus.READY
                val color = jsonObject["color"]?.jsonPrimitive?.contentOrNull
                    ?: Worktree.COLORS.first()

                WorktreeCreatedMessage(
                    worktree = Worktree(
                        id = id,
                        name = name,
                        branchName = branchName,
                        provider = provider,
                        status = status,
                        color = color,
                        parentId = null,
                        createdAt = 0L
                    )
                )
            }
        } catch (e: Exception) {
            AppLogger.error(
                app.vibe80.shared.logging.LogSource.WEBSOCKET,
                "Failed to parse worktree_created: ${e.message}",
                raw
            )
            null
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
        send(WorktreeMessageRequest(
            worktreeId = "main",
            text = text,
            attachments = attachments
        ))
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

    suspend fun syncWorktreeMessages(worktreeId: String, lastSeenMessageId: String? = null) {
        send(SyncWorktreeMessagesRequest(worktreeId = worktreeId, lastSeenMessageId = lastSeenMessageId))
    }

    suspend fun wakeUpWorktree(worktreeId: String) {
        send(WakeUpRequest(worktreeId = worktreeId))
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
