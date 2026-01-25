package app.m5chat.android.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.repository.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SessionUiState(
    val repoUrl: String = "",
    val sshKey: String = "",
    val httpUser: String = "",
    val httpPassword: String = "",
    val selectedProvider: LLMProvider = LLMProvider.CODEX,
    val authMethod: AuthMethod = AuthMethod.NONE,
    val isLoading: Boolean = false,
    val error: String? = null,
    val sessionId: String? = null
)

enum class AuthMethod {
    NONE, SSH, HTTP
}

class SessionViewModel(
    private val sessionRepository: SessionRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SessionUiState())
    val uiState: StateFlow<SessionUiState> = _uiState.asStateFlow()

    fun updateRepoUrl(url: String) {
        _uiState.update { it.copy(repoUrl = url, error = null) }
    }

    fun updateSshKey(key: String) {
        _uiState.update { it.copy(sshKey = key) }
    }

    fun updateHttpUser(user: String) {
        _uiState.update { it.copy(httpUser = user) }
    }

    fun updateHttpPassword(password: String) {
        _uiState.update { it.copy(httpPassword = password) }
    }

    fun updateAuthMethod(method: AuthMethod) {
        _uiState.update { it.copy(authMethod = method) }
    }

    fun updateProvider(provider: LLMProvider) {
        _uiState.update { it.copy(selectedProvider = provider) }
    }

    fun createSession() {
        val state = _uiState.value

        if (state.repoUrl.isBlank()) {
            _uiState.update { it.copy(error = "URL du repository requise") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val result = sessionRepository.createSession(
                repoUrl = state.repoUrl,
                provider = state.selectedProvider,
                sshKey = state.sshKey.takeIf { it.isNotBlank() },
                httpUser = state.httpUser.takeIf { it.isNotBlank() },
                httpPassword = state.httpPassword.takeIf { it.isNotBlank() }
            )

            result.fold(
                onSuccess = { sessionState ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            sessionId = sessionState.sessionId
                        )
                    }
                },
                onFailure = { exception ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = exception.message ?: "Erreur lors de la création de la session"
                        )
                    }
                }
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
