package app.m5chat.android.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.m5chat.android.data.AttachmentUploader
import app.m5chat.android.data.SessionPreferences
import app.m5chat.shared.logging.AppLogger
import app.m5chat.shared.logging.LogSource
import app.m5chat.shared.models.AppError
import app.m5chat.shared.models.ChatMessage
import app.m5chat.shared.models.ErrorType
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.models.RepoDiff
import app.m5chat.shared.models.BranchInfo
import app.m5chat.shared.models.ProviderModelState
import app.m5chat.shared.models.Worktree
import app.m5chat.shared.models.WorktreeStatus
import app.m5chat.shared.network.ConnectionState
import app.m5chat.shared.repository.SessionRepository
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

data class PendingAttachment(
    val uri: String,
    val name: String,
    val mimeType: String?,
    val size: Long
)

data class UploadedAttachment(
    val name: String,
    val path: String,
    val size: Long
)

data class ChatUiState(
    val sessionId: String = "",
    val messages: List<ChatMessage> = emptyList(),
    val currentStreamingMessage: String? = null,
    val activeProvider: LLMProvider = LLMProvider.CODEX,
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val processing: Boolean = false,
    val branches: BranchInfo? = null,
    val repoDiff: RepoDiff? = null,
    val inputText: String = "",
    val showDiffSheet: Boolean = false,
    val showLogsSheet: Boolean = false,
    val pendingAttachments: List<PendingAttachment> = emptyList(),
    val uploadingAttachments: Boolean = false,
    // Worktrees
    val worktrees: Map<String, Worktree> = emptyMap(),
    val activeWorktreeId: String = Worktree.MAIN_WORKTREE_ID,
    val showCreateWorktreeSheet: Boolean = false,
    val showWorktreeMenuFor: String? = null,
    val showCloseWorktreeConfirm: String? = null,
    // Provider models
    val providerModelState: Map<String, ProviderModelState> = emptyMap(),
    // Error handling
    val error: AppError? = null
) {
    /** Number of modified files based on diff status */
    val modifiedFilesCount: Int
        get() = repoDiff?.status?.lines()?.count {
            it.startsWith(" M ") || it.startsWith("?? ") || it.startsWith(" A ") || it.startsWith(" D ")
        } ?: 0

    /** Whether there are uncommitted changes */
    val hasUncommittedChanges: Boolean
        get() = modifiedFilesCount > 0 || repoDiff?.diff?.isNotBlank() == true

    /** Get active worktree */
    val activeWorktree: Worktree?
        get() = worktrees[activeWorktreeId]

    /** Sorted list of worktrees (main first, then by creation) */
    val sortedWorktrees: List<Worktree>
        get() = worktrees.values.sortedWith(
            compareBy({ it.id != Worktree.MAIN_WORKTREE_ID }, { it.createdAt })
        )
}

private data class SessionSnapshot(
    val messages: List<ChatMessage>,
    val streaming: String?,
    val connection: ConnectionState,
    val processing: Boolean,
    val branches: BranchInfo?,
    val worktrees: Map<String, Worktree>,
    val activeWorktreeId: String
)

private data class PartialSessionSnapshot(
    val messages: List<ChatMessage>,
    val streaming: String?,
    val connection: ConnectionState,
    val processing: Boolean,
    val branches: BranchInfo?,
    val worktrees: Map<String, Worktree> = emptyMap()
)

class ChatViewModel(
    private val sessionRepository: SessionRepository,
    private val sessionPreferences: SessionPreferences,
    private val attachmentUploader: AttachmentUploader
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    init {
        observeSessionState()
    }

    private fun observeSessionState() {
        viewModelScope.launch {
            // Combine main state flows
            combine(
                sessionRepository.messages,
                sessionRepository.currentStreamingMessage,
                sessionRepository.connectionState,
                sessionRepository.processing,
                sessionRepository.branches
            ) { messages, streaming, connection, processing, branches ->
                PartialSessionSnapshot(
                    messages = messages,
                    streaming = streaming,
                    connection = connection,
                    processing = processing,
                    branches = branches
                )
            }
                .combine(sessionRepository.worktrees) { snapshot, worktrees ->
                    snapshot.copy(worktrees = worktrees)
                }
                .combine(sessionRepository.activeWorktreeId) { snapshot, activeWorktreeId ->
                    SessionSnapshot(
                        messages = snapshot.messages,
                        streaming = snapshot.streaming,
                        connection = snapshot.connection,
                        processing = snapshot.processing,
                        branches = snapshot.branches,
                        worktrees = snapshot.worktrees,
                        activeWorktreeId = activeWorktreeId
                    )
                }
                .combine(sessionRepository.repoDiff) { snapshot, diff ->
                    snapshot to diff
                }
                .collect { (snapshot, diff) ->
                    // Get messages for active worktree
                    val activeMessages = sessionRepository.getWorktreeMessages(snapshot.activeWorktreeId)
                    val activeStreaming = sessionRepository.getWorktreeStreamingMessage(snapshot.activeWorktreeId)
                    val activeProcessing = sessionRepository.isWorktreeProcessing(snapshot.activeWorktreeId)

                    _uiState.update {
                        it.copy(
                            messages = activeMessages,
                            currentStreamingMessage = activeStreaming,
                            connectionState = snapshot.connection,
                            processing = activeProcessing,
                            branches = snapshot.branches,
                            repoDiff = diff,
                            worktrees = snapshot.worktrees,
                            activeWorktreeId = snapshot.activeWorktreeId
                        )
                    }
                }
        }

        viewModelScope.launch {
            sessionRepository.sessionState.filterNotNull().collect { session ->
                _uiState.update {
                    it.copy(
                        sessionId = session.sessionId,
                        activeProvider = session.activeProvider
                    )
                }
            }
        }

        // Observe errors from repository
        viewModelScope.launch {
            sessionRepository.lastError.collect { error ->
                _uiState.update { it.copy(error = error) }
            }
        }
    }

    /** Dismiss the current error */
    fun dismissError() {
        sessionRepository.clearError()
    }

    fun updateInputText(text: String) {
        _uiState.update { it.copy(inputText = text) }
    }

    fun sendMessage() {
        val text = _uiState.value.inputText.trim()
        if (text.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(inputText = "") }
            sessionRepository.sendMessage(text)
        }
    }

    fun loadBranches() {
        viewModelScope.launch {
            sessionRepository.loadBranches()
        }
    }

    fun loadDiff() {
        viewModelScope.launch {
            sessionRepository.loadDiff()
        }
    }

    fun showDiffSheet() {
        _uiState.update { it.copy(showDiffSheet = true) }
    }

    fun hideDiffSheet() {
        _uiState.update { it.copy(showDiffSheet = false) }
    }

    fun showLogsSheet() {
        _uiState.update { it.copy(showLogsSheet = true) }
    }

    fun hideLogsSheet() {
        _uiState.update { it.copy(showLogsSheet = false) }
    }

    fun addPendingAttachment(attachment: PendingAttachment) {
        _uiState.update {
            it.copy(pendingAttachments = it.pendingAttachments + attachment)
        }
    }

    fun removePendingAttachment(attachment: PendingAttachment) {
        _uiState.update {
            it.copy(pendingAttachments = it.pendingAttachments.filter { a -> a.uri != attachment.uri })
        }
    }

    fun clearPendingAttachments() {
        _uiState.update { it.copy(pendingAttachments = emptyList()) }
    }

    private suspend fun uploadAttachments(): List<UploadedAttachment> {
        _uiState.update { it.copy(uploadingAttachments = true) }
        try {
            val uris = _uiState.value.pendingAttachments.map { Uri.parse(it.uri) }
            val uploaded = attachmentUploader.uploadFiles(
                _uiState.value.sessionId,
                uris
            )
            return uploaded.map { UploadedAttachment(it.name, it.path, it.size ?: 0) }
        } finally {
            _uiState.update { it.copy(uploadingAttachments = false) }
        }
    }

    fun sendMessageWithAttachments() {
        val text = _uiState.value.inputText.trim()
        val attachments = _uiState.value.pendingAttachments

        AppLogger.info(LogSource.APP, "sendMessageWithAttachments called", "text='$text', attachments=${attachments.size}")

        viewModelScope.launch {
            _uiState.update { it.copy(inputText = "", uploadingAttachments = attachments.isNotEmpty()) }

            val uploadedAttachments = if (attachments.isNotEmpty()) {
                try {
                    uploadAttachments()
                } catch (e: Exception) {
                    AppLogger.error(LogSource.APP, "Failed to upload attachments", e.message)
                    _uiState.update { it.copy(uploadingAttachments = false) }
                    // Report error to user
                    sessionRepository.reportError(
                        AppError.upload(
                            message = "Failed to upload attachments",
                            details = e.message,
                            canRetry = true
                        )
                    )
                    emptyList()
                }
            } else {
                emptyList()
            }

            clearPendingAttachments()

            if (text.isNotBlank() || uploadedAttachments.isNotEmpty()) {
                AppLogger.info(LogSource.APP, "Calling sessionRepository.sendMessage...")
                val paths = uploadedAttachments.map { it.path }.filter { it.isNotBlank() }
                val suffix = buildAttachmentsSuffix(paths)
                val textWithSuffix = "${text}${suffix}"
                sessionRepository.sendMessage(
                    text = textWithSuffix,
                    attachments = uploadedAttachments.map {
                        app.m5chat.shared.models.Attachment(
                            name = it.name,
                            path = it.path,
                            size = it.size
                        )
                    }
                )
                AppLogger.info(LogSource.APP, "sessionRepository.sendMessage completed")
            } else {
                AppLogger.warning(LogSource.APP, "Nothing to send - text is blank and no attachments")
            }
        }
    }

    private fun buildAttachmentsSuffix(paths: List<String>): String {
        if (paths.isEmpty()) return ""
        val json = paths.joinToString(
            prefix = ";; attachments: [",
            postfix = "]"
        ) { "\"${escapeJson(it)}\"" }
        return json
    }

    private fun escapeJson(value: String): String {
        return buildString {
            value.forEach { ch ->
                when (ch) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> append(ch)
                }
            }
        }
    }

    fun disconnect() {
        viewModelScope.launch {
            sessionPreferences.clearSession()
        }
        sessionRepository.disconnect()
    }

    // ========== Worktree Management ==========

    fun selectWorktree(worktreeId: String) {
        sessionRepository.setActiveWorktree(worktreeId)
    }

    fun showCreateWorktreeSheet() {
        _uiState.update { it.copy(showCreateWorktreeSheet = true) }
    }

    fun hideCreateWorktreeSheet() {
        _uiState.update { it.copy(showCreateWorktreeSheet = false) }
    }

    fun createWorktree(
        name: String?,
        provider: LLMProvider,
        branchName: String? = null,
        model: String? = null,
        reasoningEffort: String? = null
    ) {
        viewModelScope.launch {
            sessionRepository.createWorktree(name, provider, branchName, model, reasoningEffort)
            _uiState.update { it.copy(showCreateWorktreeSheet = false) }
        }
    }

    fun loadProviderModels(provider: String) {
        viewModelScope.launch {
            // Set loading state
            _uiState.update { state ->
                val currentState = state.providerModelState[provider] ?: ProviderModelState()
                state.copy(
                    providerModelState = state.providerModelState + (provider to currentState.copy(loading = true, error = null))
                )
            }

            sessionRepository.loadProviderModels(provider)
                .onSuccess { models ->
                    _uiState.update { state ->
                        state.copy(
                            providerModelState = state.providerModelState + (provider to ProviderModelState(
                                models = models,
                                loading = false,
                                error = null
                            ))
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update { state ->
                        state.copy(
                            providerModelState = state.providerModelState + (provider to ProviderModelState(
                                models = emptyList(),
                                loading = false,
                                error = error.message ?: "Impossible de charger les modèles"
                            ))
                        )
                    }
                }
        }
    }

    fun showWorktreeMenu(worktreeId: String) {
        _uiState.update { it.copy(showWorktreeMenuFor = worktreeId) }
    }

    fun hideWorktreeMenu() {
        _uiState.update { it.copy(showWorktreeMenuFor = null) }
    }

    fun requestCloseWorktree(worktreeId: String) {
        _uiState.update { it.copy(showCloseWorktreeConfirm = worktreeId, showWorktreeMenuFor = null) }
    }

    fun confirmCloseWorktree() {
        val worktreeId = _uiState.value.showCloseWorktreeConfirm ?: return
        viewModelScope.launch {
            sessionRepository.closeWorktree(worktreeId)
            _uiState.update { it.copy(showCloseWorktreeConfirm = null) }
        }
    }

    fun cancelCloseWorktree() {
        _uiState.update { it.copy(showCloseWorktreeConfirm = null) }
    }

    fun mergeWorktree(worktreeId: String) {
        viewModelScope.launch {
            sessionRepository.mergeWorktree(worktreeId)
            _uiState.update { it.copy(showWorktreeMenuFor = null) }
        }
    }

    fun sendWorktreeMessage() {
        val text = _uiState.value.inputText.trim()
        val worktreeId = _uiState.value.activeWorktreeId
        if (text.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(inputText = "") }
            if (worktreeId == Worktree.MAIN_WORKTREE_ID) {
                sessionRepository.sendMessage(text)
            } else {
                sessionRepository.sendWorktreeMessage(worktreeId, text)
            }
        }
    }
}
