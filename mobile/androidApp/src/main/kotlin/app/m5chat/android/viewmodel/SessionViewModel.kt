package app.m5chat.android.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.m5chat.android.M5ChatApplication
import app.m5chat.android.data.AuthConfigUploader
import app.m5chat.android.data.SessionPreferences
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.repository.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
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
    val isCheckingExistingSession: Boolean = true,
    val error: String? = null,
    val sessionId: String? = null,
    val hasSavedSession: Boolean = false,
    val hasClaudeConfig: Boolean = false,
    val hasCodexConfig: Boolean = false
)

enum class AuthMethod {
    NONE, SSH, HTTP
}

class SessionViewModel(
    private val sessionRepository: SessionRepository,
    private val sessionPreferences: SessionPreferences
) : ViewModel() {

    private val _uiState = MutableStateFlow(SessionUiState())
    val uiState: StateFlow<SessionUiState> = _uiState.asStateFlow()

    private val authConfigUploader = AuthConfigUploader(M5ChatApplication.BASE_URL)

    init {
        checkExistingSession()
        loadLLMConfigs()
    }

    private fun loadLLMConfigs() {
        viewModelScope.launch {
            sessionPreferences.llmConfig.collect { config ->
                _uiState.update {
                    it.copy(
                        hasClaudeConfig = config.claudeConfig != null,
                        hasCodexConfig = config.codexConfig != null
                    )
                }
            }
        }
    }

    fun saveClaudeConfig(configJson: String) {
        viewModelScope.launch {
            sessionPreferences.saveClaudeConfig(configJson)
        }
    }

    fun saveCodexConfig(configJson: String) {
        viewModelScope.launch {
            sessionPreferences.saveCodexConfig(configJson)
        }
    }

    fun clearClaudeConfig() {
        viewModelScope.launch {
            sessionPreferences.clearClaudeConfig()
        }
    }

    fun clearCodexConfig() {
        viewModelScope.launch {
            sessionPreferences.clearCodexConfig()
        }
    }

    private fun checkExistingSession() {
        viewModelScope.launch {
            _uiState.update { it.copy(isCheckingExistingSession = true) }

            val savedSession = sessionPreferences.savedSession.first()
            if (savedSession != null) {
                _uiState.update {
                    it.copy(
                        isCheckingExistingSession = false,
                        hasSavedSession = true,
                        repoUrl = savedSession.repoUrl,
                        selectedProvider = try {
                            LLMProvider.valueOf(savedSession.provider.uppercase())
                        } catch (e: Exception) {
                            LLMProvider.CODEX
                        }
                    )
                }
            } else {
                _uiState.update {
                    it.copy(
                        isCheckingExistingSession = false,
                        hasSavedSession = false
                    )
                }
            }
        }
    }

    fun resumeExistingSession() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val savedSession = sessionPreferences.savedSession.first()
            if (savedSession == null) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = "Aucune session sauvegardée",
                        hasSavedSession = false
                    )
                }
                return@launch
            }

            // Try to reconnect to existing session
            val result = sessionRepository.reconnectSession(savedSession.sessionId)

            result.fold(
                onSuccess = {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            sessionId = savedSession.sessionId
                        )
                    }
                },
                onFailure = { exception ->
                    val shouldClear = (exception as? app.m5chat.shared.network.SessionGetException)
                        ?.statusCode == 404
                    if (shouldClear) {
                        sessionPreferences.clearSession()
                    }
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = if (shouldClear) {
                                "Session expirée. Veuillez créer une nouvelle session."
                            } else {
                                "Impossible de reprendre la session. Vérifiez la connexion."
                            },
                            hasSavedSession = if (shouldClear) false else it.hasSavedSession
                        )
                    }
                }
            )
        }
    }

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

            // Upload auth configs to server before creating session
            val authUploadError = uploadAuthConfigsToServer()
            if (authUploadError != null) {
                _uiState.update {
                    it.copy(isLoading = false, error = authUploadError)
                }
                return@launch
            }

            val result = sessionRepository.createSession(
                repoUrl = state.repoUrl,
                provider = state.selectedProvider,
                sshKey = state.sshKey.takeIf { it.isNotBlank() },
                httpUser = state.httpUser.takeIf { it.isNotBlank() },
                httpPassword = state.httpPassword.takeIf { it.isNotBlank() }
            )

            result.fold(
                onSuccess = { sessionState ->
                    // Save session for later
                    sessionPreferences.saveSession(
                        sessionId = sessionState.sessionId,
                        repoUrl = state.repoUrl,
                        provider = state.selectedProvider.name,
                        baseUrl = M5ChatApplication.BASE_URL
                    )

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

    /**
     * Upload stored auth configurations to the server.
     * This must be done before session creation so that the LLM providers can authenticate.
     * @return Error message if upload failed, null if successful
     */
    private suspend fun uploadAuthConfigsToServer(): String? {
        // Upload Codex config if available
        val codexConfig = sessionPreferences.getCodexConfig()
        if (codexConfig != null) {
            val result = authConfigUploader.uploadCodexConfig(codexConfig)
            if (result.isFailure) {
                return "Erreur lors de l'envoi de la configuration Codex: ${result.exceptionOrNull()?.message}"
            }
        }

        // Upload Claude config if available
        val claudeConfig = sessionPreferences.getClaudeConfig()
        if (claudeConfig != null) {
            val result = authConfigUploader.uploadClaudeConfig(claudeConfig)
            if (result.isFailure) {
                return "Erreur lors de l'envoi de la configuration Claude: ${result.exceptionOrNull()?.message}"
            }
        }

        return null
    }

    fun clearSavedSession() {
        viewModelScope.launch {
            sessionPreferences.clearSession()
            _uiState.update { it.copy(hasSavedSession = false) }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
