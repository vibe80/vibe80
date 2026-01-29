package app.m5chat.shared.repository

import app.m5chat.shared.logging.AppLogger
import app.m5chat.shared.logging.LogSource
import app.m5chat.shared.models.*
import app.m5chat.shared.network.ApiClient
import app.m5chat.shared.network.ConnectionState
import app.m5chat.shared.network.WebSocketManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class SessionRepository(
    private val apiClient: ApiClient,
    private val webSocketManager: WebSocketManager
) {
    private val scope = CoroutineScope(Dispatchers.Default)
    private var syncOnConnectJob: Job? = null

    private val _sessionState = MutableStateFlow<SessionState?>(null)
    val sessionState: StateFlow<SessionState?> = _sessionState.asStateFlow()

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _worktrees = MutableStateFlow<Map<String, Worktree>>(emptyMap())
    val worktrees: StateFlow<Map<String, Worktree>> = _worktrees.asStateFlow()

    private val _activeWorktreeId = MutableStateFlow(Worktree.MAIN_WORKTREE_ID)
    val activeWorktreeId: StateFlow<String> = _activeWorktreeId.asStateFlow()

    /** Messages organized by worktree ID */
    private val _worktreeMessages = MutableStateFlow<Map<String, List<ChatMessage>>>(emptyMap())
    val worktreeMessages: StateFlow<Map<String, List<ChatMessage>>> = _worktreeMessages.asStateFlow()

    /** Streaming message per worktree */
    private val _worktreeStreamingMessages = MutableStateFlow<Map<String, String>>(emptyMap())
    val worktreeStreamingMessages: StateFlow<Map<String, String>> = _worktreeStreamingMessages.asStateFlow()

    /** Processing state per worktree */
    private val _worktreeProcessing = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val worktreeProcessing: StateFlow<Map<String, Boolean>> = _worktreeProcessing.asStateFlow()

    private val _branches = MutableStateFlow<BranchInfo?>(null)
    val branches: StateFlow<BranchInfo?> = _branches.asStateFlow()

    private val _repoDiff = MutableStateFlow<RepoDiff?>(null)
    val repoDiff: StateFlow<RepoDiff?> = _repoDiff.asStateFlow()

    private val _processing = MutableStateFlow(false)
    val processing: StateFlow<Boolean> = _processing.asStateFlow()

    private val _currentStreamingMessage = MutableStateFlow<String?>(null)
    val currentStreamingMessage: StateFlow<String?> = _currentStreamingMessage.asStateFlow()

    /** Last error that occurred - null if no error or cleared */
    private val _lastError = MutableStateFlow<AppError?>(null)
    val lastError: StateFlow<AppError?> = _lastError.asStateFlow()

    val connectionState: StateFlow<ConnectionState> = webSocketManager.connectionState

    init {
        observeWebSocketMessages()
        observeWebSocketErrors()
    }

    private fun observeWebSocketErrors() {
        scope.launch {
            webSocketManager.errors.collect { throwable ->
                AppLogger.error(LogSource.WEBSOCKET, "WebSocket error received", throwable.message)
                _lastError.value = AppError.websocket(
                    message = throwable.message ?: "Unknown WebSocket error",
                    details = throwable.toString()
                )
            }
        }
    }

    /** Clear the current error */
    fun clearError() {
        _lastError.value = null
    }

    /** Report an error */
    fun reportError(error: AppError) {
        AppLogger.error(LogSource.APP, "Error reported: ${error.type}", error.message)
        _lastError.value = error
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
                val worktreeId = message.worktreeId
                if (worktreeId != null && worktreeId != Worktree.MAIN_WORKTREE_ID) {
                    _worktreeStreamingMessages.update { current ->
                        val existing = current[worktreeId] ?: ""
                        current + (worktreeId to (existing + message.delta))
                    }
                } else {
                    _currentStreamingMessage.update { current ->
                        (current ?: "") + message.delta
                    }
                }
            }

            is AssistantMessageComplete -> {
                val newMessage = ChatMessage(
                    id = message.itemId,
                    role = MessageRole.ASSISTANT,
                    text = message.text,
                    timestamp = System.currentTimeMillis()
                )
                val worktreeId = message.worktreeId
                if (worktreeId != null && worktreeId != Worktree.MAIN_WORKTREE_ID) {
                    _worktreeMessages.update { current ->
                        val messages = current[worktreeId] ?: emptyList()
                        current + (worktreeId to messages + newMessage)
                    }
                    _worktreeStreamingMessages.update { current ->
                        current - worktreeId
                    }
                } else {
                    _messages.update { it + newMessage }
                    _currentStreamingMessage.value = null
                }
            }

            is TurnStartedMessage -> {
                val worktreeId = message.worktreeId
                if (worktreeId != null && worktreeId != Worktree.MAIN_WORKTREE_ID) {
                    _worktreeProcessing.update { it + (worktreeId to true) }
                } else {
                    _processing.value = true
                }
            }

            is TurnCompletedMessage -> {
                val worktreeId = message.worktreeId
                if (worktreeId != null && worktreeId != Worktree.MAIN_WORKTREE_ID) {
                    _worktreeProcessing.update { it + (worktreeId to false) }
                    _worktreeStreamingMessages.update { it - worktreeId }
                    if (_activeWorktreeId.value == worktreeId) {
                        scope.launch {
                            loadDiff()
                        }
                    }
                } else {
                    _processing.value = false
                    _currentStreamingMessage.value = null
                    // Refresh diff after LLM action
                    scope.launch {
                        loadDiff()
                    }
                }
            }

            is TurnErrorMessage -> {
                val worktreeId = message.worktreeId
                if (worktreeId != null && worktreeId != Worktree.MAIN_WORKTREE_ID) {
                    _worktreeProcessing.update { it + (worktreeId to false) }
                    _worktreeStreamingMessages.update { it - worktreeId }
                } else {
                    _processing.value = false
                    _currentStreamingMessage.value = null
                }
                // Report the error to the UI
                _lastError.value = AppError.turnError(
                    message = message.errorMessage ?: "An error occurred during processing",
                    details = null
                )
            }

            is ErrorMessage -> {
                // Generic error from server (e.g., provider failed to start, authentication error)
                _processing.value = false
                _currentStreamingMessage.value = null
                _lastError.value = AppError.turnError(
                    message = message.message,
                    details = message.details
                )
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
                if (message.messages.isNotEmpty()) {
                    _messages.value = message.messages
                }
            }

            is WorktreeCreatedMessage -> {
                _worktrees.update { it + (message.worktree.id to message.worktree) }
                // Initialize empty message list for new worktree
                _worktreeMessages.update { it + (message.worktree.id to emptyList()) }
                // Switch to the newly created worktree
                _activeWorktreeId.value = message.worktree.id
            }

            is WorktreeUpdatedMessage -> {
                _worktrees.update { current ->
                    current[message.worktreeId]?.let { worktree ->
                        val updated = if (message.status != null) {
                            worktree.copy(status = message.status)
                        } else {
                            worktree
                        }
                        current + (message.worktreeId to updated)
                    } ?: current
                }
            }

            is WorktreeMessageEvent -> {
                _worktreeMessages.update { current ->
                    val messages = current[message.worktreeId] ?: emptyList()
                    current + (message.worktreeId to messages + message.message)
                }
            }

            is WorktreeDeltaMessage -> {
                _worktreeStreamingMessages.update { current ->
                    val existing = current[message.worktreeId] ?: ""
                    current + (message.worktreeId to existing + message.delta)
                }
            }

            is WorktreeTurnStartedMessage -> {
                _worktreeProcessing.update { it + (message.worktreeId to true) }
            }

            is WorktreeTurnCompletedMessage -> {
                _worktreeProcessing.update { it + (message.worktreeId to false) }
                _worktreeStreamingMessages.update { it - message.worktreeId }
            }

            is WorktreeClosedMessage -> {
                _worktrees.update { it - message.worktreeId }
                _worktreeMessages.update { it - message.worktreeId }
                _worktreeStreamingMessages.update { it - message.worktreeId }
                _worktreeProcessing.update { it - message.worktreeId }
                // Switch to main if active worktree was closed
                if (_activeWorktreeId.value == message.worktreeId) {
                    _activeWorktreeId.value = Worktree.MAIN_WORKTREE_ID
                }
            }

            is WorktreeMergeResultMessage -> {
                // Update worktree status based on merge result
                if (message.hasConflicts) {
                    _worktrees.update { current ->
                        current[message.worktreeId]?.let { worktree ->
                            current + (message.worktreeId to worktree.copy(status = WorktreeStatus.MERGE_CONFLICT))
                        } ?: current
                    }
                }
            }

            is WorktreesListMessage -> {
                _worktrees.value = message.worktrees.associateBy { it.id }
            }

            is RepoDiffMessage -> {
                val worktreeId = message.worktreeId
                val activeWorktreeId = _activeWorktreeId.value
                if (worktreeId == null || worktreeId == activeWorktreeId) {
                    _repoDiff.value = RepoDiff(
                        status = message.status,
                        diff = message.diff
                    )
                }
            }

            is CommandExecutionDeltaMessage -> {
                // Handle command execution streaming
            }

            is CommandExecutionCompletedMessage -> {
                val worktreeId = message.worktreeId
                if (worktreeId != null && worktreeId != Worktree.MAIN_WORKTREE_ID) {
                    _worktreeMessages.update { current ->
                        val messages = current[worktreeId] ?: emptyList()
                        current + (worktreeId to messages + message.item)
                    }
                } else {
                    _messages.update { it + message.item }
                }
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
        // Build auth object based on provided credentials
        val auth = when {
            sshKey != null -> SessionAuth(type = "ssh", key = sshKey)
            httpUser != null && httpPassword != null -> SessionAuth(
                type = "http",
                username = httpUser,
                password = httpPassword
            )
            else -> null
        }

        val request = SessionCreateRequest(
            repoUrl = repoUrl,
            provider = provider.name.lowercase(),
            providers = listOf("codex", "claude"),
            auth = auth
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
        AppLogger.info(LogSource.APP, "SessionRepository.sendMessage called", "text='$text', attachments=${attachments.size}, connectionState=${connectionState.value}")

        // Add user message locally
        val userMessage = ChatMessage(
            id = generateMessageId(),
            role = MessageRole.USER,
            text = text,
            attachments = attachments,
            timestamp = System.currentTimeMillis()
        )
        _messages.update { it + userMessage }
        AppLogger.debug(LogSource.APP, "User message added locally", "id=${userMessage.id}")

        // Send via WebSocket
        AppLogger.info(LogSource.APP, "Calling webSocketManager.sendMessage...")
        webSocketManager.sendMessage(text, attachments)
        AppLogger.info(LogSource.APP, "webSocketManager.sendMessage returned")
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

    suspend fun fetchBranches(): Result<BranchInfo> {
        val sessionId = _sessionState.value?.sessionId
            ?: return Result.failure(IllegalStateException("No active session"))
        return apiClient.fetchBranches(sessionId).onSuccess { branchInfo ->
            _branches.value = branchInfo
        }
    }

    suspend fun switchBranch(branch: String): Result<BranchSwitchResponse> {
        val sessionId = _sessionState.value?.sessionId
            ?: return Result.failure(IllegalStateException("No active session"))
        return apiClient.switchBranch(sessionId, branch).onSuccess {
            // Reload branches after switch to update current
            loadBranches()
            // Reload diff after branch switch
            loadDiff()
        }
    }

    suspend fun loadDiff() {
        val sessionId = _sessionState.value?.sessionId ?: return
        val worktreeId = _activeWorktreeId.value
        apiClient.getWorktreeDiff(sessionId, worktreeId).onSuccess { response ->
            _repoDiff.value = RepoDiff(
                status = response.status,
                diff = response.diff
            )
        }
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
            ensureWebSocketConnected(sessionId)

            state
        }
    }

    // ========== Worktree Management ==========

    fun setActiveWorktree(worktreeId: String) {
        _activeWorktreeId.value = worktreeId
    }

    suspend fun createWorktree(
        name: String?,
        provider: LLMProvider,
        branchName: String? = null,
        model: String? = null,
        reasoningEffort: String? = null
    ) {
        webSocketManager.createWorktree(
            provider = provider.name.lowercase(),
            name = name,
            parentWorktreeId = _activeWorktreeId.value,
            branchName = branchName,
            model = model,
            reasoningEffort = reasoningEffort
        )
    }

    suspend fun loadProviderModels(provider: String): Result<List<ProviderModel>> {
        val sessionId = _sessionState.value?.sessionId
            ?: return Result.failure(IllegalStateException("No active session"))
        return apiClient.getModels(sessionId, provider).map { response ->
            response.models
        }
    }

    suspend fun sendWorktreeMessage(
        worktreeId: String,
        text: String,
        attachments: List<Attachment> = emptyList()
    ) {
        // Add user message locally
        val userMessage = ChatMessage(
            id = generateMessageId(),
            role = MessageRole.USER,
            text = text,
            attachments = attachments,
            timestamp = System.currentTimeMillis()
        )
        _worktreeMessages.update { current ->
            val messages = current[worktreeId] ?: emptyList()
            current + (worktreeId to messages + userMessage)
        }

        // Send via WebSocket
        webSocketManager.sendWorktreeMessage(worktreeId, text, attachments = attachments)
    }

    suspend fun closeWorktree(worktreeId: String) {
        if (worktreeId == Worktree.MAIN_WORKTREE_ID) return // Cannot close main
        webSocketManager.closeWorktree(worktreeId)
    }

    suspend fun mergeWorktree(worktreeId: String) {
        if (worktreeId == Worktree.MAIN_WORKTREE_ID) return // Cannot merge main
        _worktrees.update { current ->
            current[worktreeId]?.let { worktree ->
                current + (worktreeId to worktree.copy(status = WorktreeStatus.MERGING))
            } ?: current
        }
        webSocketManager.mergeWorktree(worktreeId)
    }

    suspend fun listWorktrees() {
        webSocketManager.listWorktrees()
    }

    /** Get messages for a specific worktree */
    fun getWorktreeMessages(worktreeId: String): List<ChatMessage> {
        return if (worktreeId == Worktree.MAIN_WORKTREE_ID) {
            _messages.value
        } else {
            _worktreeMessages.value[worktreeId] ?: emptyList()
        }
    }

    /** Get streaming message for a specific worktree */
    fun getWorktreeStreamingMessage(worktreeId: String): String? {
        return if (worktreeId == Worktree.MAIN_WORKTREE_ID) {
            _currentStreamingMessage.value
        } else {
            _worktreeStreamingMessages.value[worktreeId]
        }
    }

    /** Check if a worktree is processing */
    fun isWorktreeProcessing(worktreeId: String): Boolean {
        return if (worktreeId == Worktree.MAIN_WORKTREE_ID) {
            _processing.value
        } else {
            _worktreeProcessing.value[worktreeId] ?: false
        }
    }

    fun disconnect() {
        webSocketManager.disconnect()
        _sessionState.value = null
        _messages.value = emptyList()
        _worktrees.value = emptyMap()
        _worktreeMessages.value = emptyMap()
        _worktreeStreamingMessages.value = emptyMap()
        _worktreeProcessing.value = emptyMap()
        _activeWorktreeId.value = Worktree.MAIN_WORKTREE_ID
        syncOnConnectJob?.cancel()
    }

    fun ensureWebSocketConnected(sessionId: String, provider: LLMProvider? = null) {
        when (connectionState.value) {
            ConnectionState.CONNECTED,
            ConnectionState.CONNECTING,
            ConnectionState.RECONNECTING -> {
                scheduleSyncOnConnected(provider)
                return
            }
            ConnectionState.DISCONNECTED,
            ConnectionState.ERROR -> {
                webSocketManager.connect(sessionId)
                scheduleSyncOnConnected(provider)
            }
        }
    }

    private fun scheduleSyncOnConnected(provider: LLMProvider?) {
        syncOnConnectJob?.cancel()
        syncOnConnectJob = scope.launch {
            connectionState.filter { it == ConnectionState.CONNECTED }.first()
            syncMessages(provider)
        }
    }

    fun syncMessages(providerOverride: LLMProvider? = null) {
        val provider = providerOverride ?: _sessionState.value?.activeProvider ?: LLMProvider.CODEX
        val lastSeenMessageId = _messages.value.lastOrNull()?.id
        scope.launch {
            webSocketManager.send(SyncMessagesRequest(
                provider = provider.name.lowercase(),
                lastSeenMessageId = lastSeenMessageId
            ))
        }
    }

    private fun generateMessageId(): String {
        return "msg_${System.currentTimeMillis()}_${(0..9999).random()}"
    }

    // Platform-specific currentTimeMillis
    private object System {
        fun currentTimeMillis(): Long = kotlinx.datetime.Clock.System.now().toEpochMilliseconds()
    }
}
