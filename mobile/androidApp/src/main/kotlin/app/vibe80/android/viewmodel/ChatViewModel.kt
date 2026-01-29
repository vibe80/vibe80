package app.vibe80.android.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.vibe80.android.data.AttachmentUploader
import app.vibe80.android.data.SessionPreferences
import app.vibe80.shared.logging.AppLogger
import app.vibe80.shared.logging.LogSource
import app.vibe80.shared.models.AppError
import app.vibe80.shared.models.ChatMessage
import app.vibe80.shared.models.ErrorType
import app.vibe80.shared.models.LLMProvider
import app.vibe80.shared.models.RepoDiff
import app.vibe80.shared.models.BranchInfo
import app.vibe80.shared.models.ProviderModelState
import app.vibe80.shared.models.Worktree
import app.vibe80.shared.models.WorktreeStatus
import app.vibe80.shared.network.ConnectionState
import app.vibe80.shared.repository.SessionRepository
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
    val workspaceToken: String? = null,
    val messages: List<ChatMessage> = emptyList(),
    val currentStreamingMessage: String? = null,
    val activeProvider: LLMProvider = LLMProvider.CODEX,
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val processing: Boolean = false,
    val repoName: String = "",
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
    // Vibe80 forms
    val submittedFormMessageIds: Set<String> = emptySet(),
    val submittedYesNoMessageIds: Set<String> = emptySet(),
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
    val activeWorktreeId: String,
    val worktreeMessages: Map<String, List<ChatMessage>>,
    val worktreeStreaming: Map<String, String>,
    val worktreeProcessing: Map<String, Boolean>
)

private data class PartialSessionSnapshot(
    val messages: List<ChatMessage>,
    val streaming: String?,
    val connection: ConnectionState,
    val processing: Boolean,
    val branches: BranchInfo?,
    val worktrees: Map<String, Worktree> = emptyMap()
)

private data class WorktreeStateSnapshot(
    val snapshot: PartialSessionSnapshot,
    val activeWorktreeId: String,
    val worktreeMessages: Map<String, List<ChatMessage>>,
    val worktreeStreaming: Map<String, String>,
    val worktreeProcessing: Map<String, Boolean>
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
        observeWorkspaceToken()
    }

    private fun observeWorkspaceToken() {
        viewModelScope.launch {
            sessionPreferences.savedWorkspace.collect { workspace ->
                _uiState.update { it.copy(workspaceToken = workspace?.workspaceToken) }
            }
        }
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
                    snapshot to activeWorktreeId
                }
                .combine(sessionRepository.worktreeMessages) { (snapshot, activeWorktreeId), worktreeMessages ->
                    WorktreeStateSnapshot(
                        snapshot = snapshot,
                        activeWorktreeId = activeWorktreeId,
                        worktreeMessages = worktreeMessages,
                        worktreeStreaming = emptyMap(),
                        worktreeProcessing = emptyMap()
                    )
                }
                .combine(sessionRepository.worktreeStreamingMessages) { state, worktreeStreaming ->
                    state.copy(worktreeStreaming = worktreeStreaming)
                }
                .combine(sessionRepository.worktreeProcessing) { state, worktreeProcessing ->
                    SessionSnapshot(
                        messages = state.snapshot.messages,
                        streaming = state.snapshot.streaming,
                        connection = state.snapshot.connection,
                        processing = state.snapshot.processing,
                        branches = state.snapshot.branches,
                        worktrees = state.snapshot.worktrees,
                        activeWorktreeId = state.activeWorktreeId,
                        worktreeMessages = state.worktreeMessages,
                        worktreeStreaming = state.worktreeStreaming,
                        worktreeProcessing = worktreeProcessing
                    )
                }
                .combine(sessionRepository.repoDiff) { snapshot, diff ->
                    snapshot to diff
                }
                .collect { (snapshot, diff) ->
                    val activeWorktreeId = snapshot.activeWorktreeId
                    val activeMessages = if (activeWorktreeId == Worktree.MAIN_WORKTREE_ID) {
                        snapshot.messages
                    } else {
                        snapshot.worktreeMessages[activeWorktreeId] ?: emptyList()
                    }
                    val activeStreaming = if (activeWorktreeId == Worktree.MAIN_WORKTREE_ID) {
                        snapshot.streaming
                    } else {
                        snapshot.worktreeStreaming[activeWorktreeId]
                    }
                    val activeProcessing = if (activeWorktreeId == Worktree.MAIN_WORKTREE_ID) {
                        snapshot.processing
                    } else {
                        snapshot.worktreeProcessing[activeWorktreeId] ?: false
                    }

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
                    val shouldResetForms = it.sessionId.isNotBlank() && it.sessionId != session.sessionId
                    it.copy(
                        sessionId = session.sessionId,
                        activeProvider = session.activeProvider,
                        repoName = repoNameFromUrl(session.repoUrl),
                        submittedFormMessageIds = if (shouldResetForms) emptySet() else it.submittedFormMessageIds,
                        submittedYesNoMessageIds = if (shouldResetForms) emptySet() else it.submittedYesNoMessageIds
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

    fun markFormSubmitted(messageId: String) {
        _uiState.update {
            it.copy(submittedFormMessageIds = it.submittedFormMessageIds + messageId)
        }
    }

    fun markYesNoSubmitted(messageId: String) {
        _uiState.update {
            it.copy(submittedYesNoMessageIds = it.submittedYesNoMessageIds + messageId)
        }
    }

    private fun repoNameFromUrl(url: String): String {
        val trimmed = url.trim().trimEnd('/')
        if (trimmed.isBlank()) return ""
        val separatorIndex = maxOf(trimmed.lastIndexOf('/'), trimmed.lastIndexOf(':'))
        return if (separatorIndex >= 0) {
            trimmed.substring(separatorIndex + 1)
        } else {
            trimmed
        }
    }

    fun sendMessage() {
        val text = _uiState.value.inputText.trim()
        if (text.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(inputText = "") }
            if (_uiState.value.activeWorktreeId == Worktree.MAIN_WORKTREE_ID) {
                sessionRepository.sendMessage(text)
            } else {
                sessionRepository.sendWorktreeMessage(_uiState.value.activeWorktreeId, text)
            }
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
                uris,
                _uiState.value.workspaceToken
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
                val attachmentModels = uploadedAttachments.map {
                    app.vibe80.shared.models.Attachment(
                        name = it.name,
                        path = it.path,
                        size = it.size
                    )
                }
                if (_uiState.value.activeWorktreeId == Worktree.MAIN_WORKTREE_ID) {
                    sessionRepository.sendMessage(
                        text = textWithSuffix,
                        attachments = attachmentModels
                    )
                } else {
                    sessionRepository.sendWorktreeMessage(
                        worktreeId = _uiState.value.activeWorktreeId,
                        text = textWithSuffix,
                        attachments = attachmentModels
                    )
                }
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
        val targetBranch = _uiState.value.worktrees[Worktree.MAIN_WORKTREE_ID]?.branchName
            ?: Worktree.MAIN_WORKTREE_ID
        val mergePrompt = "Merge vers $targetBranch"
        viewModelScope.launch {
            sessionRepository.sendWorktreeMessage(worktreeId, mergePrompt)
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
