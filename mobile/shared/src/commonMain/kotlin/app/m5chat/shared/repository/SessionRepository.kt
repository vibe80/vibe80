package app.m5chat.shared.repository

import app.m5chat.shared.models.*
import app.m5chat.shared.network.ApiClient
import app.m5chat.shared.network.ConnectionState
import app.m5chat.shared.network.WebSocketManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class SessionRepository(
    private val apiClient: ApiClient,
    private val webSocketManager: WebSocketManager
) {
    private val scope = CoroutineScope(Dispatchers.Default)

    private val _sessionState = MutableStateFlow<SessionState?>(null)
    val sessionState: StateFlow<SessionState?> = _sessionState.asStateFlow()

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _worktrees = MutableStateFlow<Map<String, Worktree>>(emptyMap())
    val worktrees: StateFlow<Map<String, Worktree>> = _worktrees.asStateFlow()

    private val _branches = MutableStateFlow<BranchInfo?>(null)
    val branches: StateFlow<BranchInfo?> = _branches.asStateFlow()

    private val _repoDiff = MutableStateFlow<RepoDiff?>(null)
    val repoDiff: StateFlow<RepoDiff?> = _repoDiff.asStateFlow()

    private val _processing = MutableStateFlow(false)
    val processing: StateFlow<Boolean> = _processing.asStateFlow()

    private val _currentStreamingMessage = MutableStateFlow<String?>(null)
    val currentStreamingMessage: StateFlow<String?> = _currentStreamingMessage.asStateFlow()

    val connectionState: StateFlow<ConnectionState> = webSocketManager.connectionState

    init {
        observeWebSocketMessages()
    }

    private fun observeWebSocketMessages() {
        scope.launch {
            webSocketManager.messages.collect { message ->
                handleServerMessage(message)
            }
        }
    }

    private fun handleServerMessage(message: ServerMessage) {
        when (message) {
            is ReadyMessage -> {
                _sessionState.update { it?.copy(appServerReady = true) }
            }

            is StatusMessage -> {
                // Status updates can be shown in UI
            }

            is AssistantDeltaMessage -> {
                _currentStreamingMessage.update { current ->
                    (current ?: "") + message.delta
                }
            }

            is AssistantMessageComplete -> {
                val newMessage = ChatMessage(
                    id = message.itemId,
                    role = MessageRole.ASSISTANT,
                    text = message.text,
                    timestamp = System.currentTimeMillis()
                )
                _messages.update { it + newMessage }
                _currentStreamingMessage.value = null
            }

            is TurnStartedMessage -> {
                _processing.value = true
            }

            is TurnCompletedMessage -> {
                _processing.value = false
                _currentStreamingMessage.value = null
            }

            is TurnErrorMessage -> {
                _processing.value = false
                _currentStreamingMessage.value = null
            }

            is ProviderSwitchedMessage -> {
                _sessionState.update { state ->
                    state?.copy(
                        activeProvider = LLMProvider.valueOf(message.provider.uppercase())
                    )
                }
                _messages.value = message.messages
            }

            is MessagesSyncMessage -> {
                _messages.value = message.messages
            }

            is WorktreeCreatedMessage -> {
                _worktrees.update { it + (message.worktree.id to message.worktree) }
            }

            is WorktreeUpdatedMessage -> {
                // Handle worktree updates
            }

            is RepoDiffMessage -> {
                _repoDiff.value = RepoDiff(
                    status = message.status,
                    diff = message.diff
                )
            }

            is CommandExecutionDeltaMessage -> {
                // Handle command execution streaming
            }

            is CommandExecutionCompletedMessage -> {
                _messages.update { it + message.item }
            }

            is PongMessage -> {
                // Pong received, connection is alive
            }
        }
    }

    suspend fun createSession(
        repoUrl: String,
        provider: LLMProvider = LLMProvider.CODEX,
        sshKey: String? = null,
        httpUser: String? = null,
        httpPassword: String? = null
    ): Result<SessionState> {
        val request = SessionCreateRequest(
            repoUrl = repoUrl,
            provider = provider.name.lowercase(),
            providers = listOf("codex", "claude"),
            sshKey = sshKey,
            httpUser = httpUser,
            httpPassword = httpPassword
        )

        return apiClient.createSession(request).map { response ->
            val state = SessionState(
                sessionId = response.sessionId,
                repoUrl = response.repoUrl,
                activeProvider = LLMProvider.valueOf(response.provider.uppercase()),
                providers = response.providers.map { LLMProvider.valueOf(it.uppercase()) }
            )
            _sessionState.value = state
            _messages.value = response.messages

            // Connect WebSocket
            webSocketManager.connect(response.sessionId)

            state
        }
    }

    suspend fun sendMessage(text: String, attachments: List<Attachment> = emptyList()) {
        // Add user message locally
        val userMessage = ChatMessage(
            id = generateMessageId(),
            role = MessageRole.USER,
            text = text,
            attachments = attachments,
            timestamp = System.currentTimeMillis()
        )
        _messages.update { it + userMessage }

        // Send via WebSocket
        webSocketManager.sendMessage(text, attachments)
    }

    /**
     * Upload attachments to the server
     * Returns list of uploaded file info
     */
    suspend fun uploadAttachments(
        sessionId: String,
        files: List<Pair<String, String>> // uri to name
    ): List<Attachment> {
        return apiClient.uploadAttachments(sessionId, files).getOrDefault(emptyList())
    }

    suspend fun switchProvider(provider: LLMProvider) {
        webSocketManager.switchProvider(provider.name.lowercase())
    }

    suspend fun loadBranches() {
        val sessionId = _sessionState.value?.sessionId ?: return
        apiClient.getBranches(sessionId).onSuccess { branchInfo ->
            _branches.value = branchInfo
        }
    }

    suspend fun switchBranch(branch: String): Result<BranchSwitchResponse> {
        val sessionId = _sessionState.value?.sessionId
            ?: return Result.failure(IllegalStateException("No active session"))
        return apiClient.switchBranch(sessionId, branch)
    }

    /**
     * Reconnect to an existing session
     */
    suspend fun reconnectSession(sessionId: String): Result<SessionState> {
        return apiClient.getSession(sessionId).map { response ->
            val state = SessionState(
                sessionId = sessionId,
                repoUrl = "", // Not returned by getSession
                activeProvider = LLMProvider.CODEX, // Default, will be updated by WebSocket
                providers = listOf(LLMProvider.CODEX, LLMProvider.CLAUDE)
            )
            _sessionState.value = state
            _messages.value = response.messages

            // Connect WebSocket
            webSocketManager.connect(sessionId)

            state
        }
    }

    fun disconnect() {
        webSocketManager.disconnect()
        _sessionState.value = null
        _messages.value = emptyList()
        _worktrees.value = emptyMap()
    }

    private fun generateMessageId(): String {
        return "msg_${System.currentTimeMillis()}_${(0..9999).random()}"
    }

    // Platform-specific currentTimeMillis
    private object System {
        fun currentTimeMillis(): Long = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
    }
}
