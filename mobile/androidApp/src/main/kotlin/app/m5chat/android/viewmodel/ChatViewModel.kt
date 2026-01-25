package app.m5chat.android.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.m5chat.android.data.AttachmentUploader
import app.m5chat.android.data.SessionPreferences
import app.m5chat.shared.models.ChatMessage
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.models.RepoDiff
import app.m5chat.shared.models.BranchInfo
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
    val showBranchesSheet: Boolean = false,
    val showDiffSheet: Boolean = false,
    val showProviderDialog: Boolean = false,
    val pendingAttachments: List<PendingAttachment> = emptyList(),
    val uploadingAttachments: Boolean = false
)

private data class SessionSnapshot(
    val messages: List<ChatMessage>,
    val streaming: String?,
    val connection: ConnectionState,
    val processing: Boolean,
    val branches: BranchInfo?
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
            val baseStateFlow = combine(
                sessionRepository.messages,
                sessionRepository.currentStreamingMessage,
                sessionRepository.connectionState,
                sessionRepository.processing,
                sessionRepository.branches
            ) { messages, streaming, connection, processing, branches ->
                SessionSnapshot(
                    messages = messages,
                    streaming = streaming,
                    connection = connection,
                    processing = processing,
                    branches = branches
                )
            }

            baseStateFlow
                .combine(sessionRepository.repoDiff) { snapshot, diff ->
                    snapshot to diff
                }
                .collect { (snapshot, diff) ->
                    _uiState.update {
                        it.copy(
                            messages = snapshot.messages,
                            currentStreamingMessage = snapshot.streaming,
                            connectionState = snapshot.connection,
                            processing = snapshot.processing,
                            branches = snapshot.branches,
                            repoDiff = diff
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

    fun switchProvider(provider: LLMProvider) {
        viewModelScope.launch {
            sessionRepository.switchProvider(provider)
        }
    }

    fun loadBranches() {
        viewModelScope.launch {
            sessionRepository.loadBranches()
        }
    }

    fun switchBranch(branch: String) {
        viewModelScope.launch {
            sessionRepository.switchBranch(branch)
            _uiState.update { it.copy(showBranchesSheet = false) }
        }
    }

    fun showBranchesSheet() {
        loadBranches()
        _uiState.update { it.copy(showBranchesSheet = true) }
    }

    fun hideBranchesSheet() {
        _uiState.update { it.copy(showBranchesSheet = false) }
    }

    fun showDiffSheet() {
        _uiState.update { it.copy(showDiffSheet = true) }
    }

    fun hideDiffSheet() {
        _uiState.update { it.copy(showDiffSheet = false) }
    }

    fun showProviderDialog() {
        _uiState.update { it.copy(showProviderDialog = true) }
    }

    fun hideProviderDialog() {
        _uiState.update { it.copy(showProviderDialog = false) }
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

        viewModelScope.launch {
            _uiState.update { it.copy(inputText = "", uploadingAttachments = attachments.isNotEmpty()) }

            val uploadedAttachments = if (attachments.isNotEmpty()) {
                try {
                    uploadAttachments()
                } catch (e: Exception) {
                    _uiState.update { it.copy(uploadingAttachments = false) }
                    emptyList()
                }
            } else {
                emptyList()
            }

            clearPendingAttachments()

            if (text.isNotBlank() || uploadedAttachments.isNotEmpty()) {
                sessionRepository.sendMessage(
                    text = text,
                    attachments = uploadedAttachments.map {
                        app.m5chat.shared.models.Attachment(
                            name = it.name,
                            path = it.path,
                            size = it.size
                        )
                    }
                )
            }
        }
    }

    fun disconnect() {
        viewModelScope.launch {
            sessionPreferences.clearSession()
        }
        sessionRepository.disconnect()
    }
}
