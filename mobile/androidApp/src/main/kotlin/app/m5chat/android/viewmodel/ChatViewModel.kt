package app.m5chat.android.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.m5chat.android.data.SessionPreferences
import app.m5chat.shared.models.ChatMessage
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.models.RepoDiff
import app.m5chat.shared.models.BranchInfo
import app.m5chat.shared.network.ConnectionState
import app.m5chat.shared.repository.SessionRepository
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

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
    val showDiffSheet: Boolean = false
)

class ChatViewModel(
    private val sessionRepository: SessionRepository,
    private val sessionPreferences: SessionPreferences
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    init {
        observeSessionState()
    }

    private fun observeSessionState() {
        viewModelScope.launch {
            combine(
                sessionRepository.messages,
                sessionRepository.currentStreamingMessage,
                sessionRepository.connectionState,
                sessionRepository.processing,
                sessionRepository.branches,
                sessionRepository.repoDiff
            ) { messages, streaming, connection, processing, branches, diff ->
                _uiState.update {
                    it.copy(
                        messages = messages,
                        currentStreamingMessage = streaming,
                        connectionState = connection,
                        processing = processing,
                        branches = branches,
                        repoDiff = diff
                    )
                }
            }.collect()
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

    fun disconnect() {
        viewModelScope.launch {
            sessionPreferences.clearSession()
        }
        sessionRepository.disconnect()
    }
}
