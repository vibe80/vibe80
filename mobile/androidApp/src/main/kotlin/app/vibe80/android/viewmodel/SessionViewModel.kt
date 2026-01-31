package app.vibe80.android.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.vibe80.android.Vibe80Application
import app.vibe80.android.data.SessionPreferences
import app.vibe80.shared.models.WorkspaceAuth
import app.vibe80.shared.models.WorkspaceCreateRequest
import app.vibe80.shared.models.WorkspaceLoginRequest
import app.vibe80.shared.models.WorkspaceProviderConfig
import app.vibe80.shared.repository.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Base64

data class SessionUiState(
    val workspaceStep: Int = 1,
    val workspaceMode: WorkspaceMode = WorkspaceMode.EXISTING,
    val workspaceIdInput: String = "",
    val workspaceSecretInput: String = "",
    val workspaceId: String? = null,
    val workspaceToken: String? = null,
    val workspaceCreatedId: String? = null,
    val workspaceCreatedSecret: String? = null,
    val workspaceError: String? = null,
    val workspaceBusy: Boolean = false,
    val workspaceProviders: Map<String, ProviderAuthUi> = mapOf(
        "codex" to ProviderAuthUi(authType = ProviderAuthType.API_KEY),
        "claude" to ProviderAuthUi(authType = ProviderAuthType.SETUP_TOKEN)
    ),
    val repoUrl: String = "",
    val sshKey: String = "",
    val httpUser: String = "",
    val httpPassword: String = "",
    val authMethod: AuthMethod = AuthMethod.NONE,
    val isLoading: Boolean = false,
    val loadingState: LoadingState = LoadingState.NONE,
    val isCheckingExistingSession: Boolean = true,
    val error: String? = null,
    val sessionId: String? = null,
    val hasSavedSession: Boolean = false
)

enum class AuthMethod {
    NONE, SSH, HTTP
}

enum class WorkspaceMode {
    EXISTING, NEW
}

enum class ProviderAuthType {
    API_KEY, AUTH_JSON_B64, SETUP_TOKEN
}

data class ProviderAuthUi(
    val enabled: Boolean = false,
    val authType: ProviderAuthType = ProviderAuthType.API_KEY,
    val authValue: String = ""
)

enum class LoadingState {
    NONE,
    CLONING,
    RESUMING
}

class SessionViewModel(
    private val sessionRepository: SessionRepository,
    private val sessionPreferences: SessionPreferences
) : ViewModel() {

    private val _uiState = MutableStateFlow(SessionUiState())
    val uiState: StateFlow<SessionUiState> = _uiState.asStateFlow()
    init {
        checkExistingSession()
        loadWorkspace()
        observeWorkspaceAuthInvalid()
    }

    private fun observeWorkspaceAuthInvalid() {
        viewModelScope.launch {
            sessionRepository.workspaceAuthInvalid.collect {
                sessionRepository.setWorkspaceToken(null)
                sessionPreferences.clearWorkspace()
                _uiState.update { state ->
                    state.copy(
                        workspaceStep = 1,
                        workspaceMode = WorkspaceMode.EXISTING,
                        workspaceIdInput = "",
                        workspaceSecretInput = "",
                        workspaceId = null,
                        workspaceToken = null,
                        workspaceError = "Token workspace invalide. Merci de vous reconnecter.",
                        workspaceBusy = false
                    )
                }
            }
        }
    }

    private fun loadWorkspace() {
        viewModelScope.launch {
            val saved = sessionPreferences.savedWorkspace.first()
            if (saved == null) {
                _uiState.update {
                    it.copy(
                        workspaceStep = 1,
                        workspaceMode = WorkspaceMode.EXISTING,
                        workspaceIdInput = "",
                        workspaceSecretInput = ""
                    )
                }
                return@launch
            }
            _uiState.update {
                it.copy(
                    workspaceId = saved.workspaceId,
                    workspaceIdInput = saved.workspaceId,
                    workspaceSecretInput = saved.workspaceSecret,
                    workspaceToken = saved.workspaceToken,
                    workspaceStep = 2
                )
            }
            if (!saved.workspaceToken.isNullOrBlank()) {
                sessionRepository.setWorkspaceToken(saved.workspaceToken)
            } else {
                loginWorkspace(saved.workspaceId, saved.workspaceSecret, auto = true)
            }
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
                        repoUrl = savedSession.repoUrl
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
            val token = _uiState.value.workspaceToken
            if (token.isNullOrBlank()) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        loadingState = LoadingState.NONE,
                        error = "Workspace non authentifié"
                    )
                }
                return@launch
            }
            sessionRepository.setWorkspaceToken(token)
            _uiState.update {
                it.copy(
                    isLoading = true,
                    loadingState = LoadingState.RESUMING,
                    error = null
                )
            }

            val savedSession = sessionPreferences.savedSession.first()
            if (savedSession == null) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        loadingState = LoadingState.NONE,
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
                            loadingState = LoadingState.NONE,
                            sessionId = savedSession.sessionId
                        )
                    }
                },
                onFailure = { exception ->
                    val shouldClear = (exception as? app.vibe80.shared.network.SessionGetException)
                        ?.statusCode == 404
                    if (shouldClear) {
                        sessionPreferences.clearSession()
                    }
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loadingState = LoadingState.NONE,
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

    fun updateWorkspaceMode(mode: WorkspaceMode) {
        _uiState.update { it.copy(workspaceMode = mode, workspaceError = null) }
    }

    fun updateWorkspaceIdInput(value: String) {
        _uiState.update { it.copy(workspaceIdInput = value, workspaceError = null) }
    }

    fun updateWorkspaceSecretInput(value: String) {
        _uiState.update { it.copy(workspaceSecretInput = value, workspaceError = null) }
    }

    fun toggleProvider(provider: String, enabled: Boolean) {
        _uiState.update { state ->
            val updated = state.workspaceProviders.toMutableMap()
            val current = updated[provider] ?: ProviderAuthUi()
            updated[provider] = current.copy(enabled = enabled)
            state.copy(workspaceProviders = updated)
        }
    }

    fun updateProviderAuthType(provider: String, authType: ProviderAuthType) {
        _uiState.update { state ->
            val updated = state.workspaceProviders.toMutableMap()
            val current = updated[provider] ?: ProviderAuthUi()
            updated[provider] = current.copy(authType = authType)
            state.copy(workspaceProviders = updated)
        }
    }

    fun updateProviderAuthValue(provider: String, value: String) {
        _uiState.update { state ->
            val updated = state.workspaceProviders.toMutableMap()
            val current = updated[provider] ?: ProviderAuthUi()
            updated[provider] = current.copy(authValue = value)
            state.copy(workspaceProviders = updated)
        }
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

    fun submitWorkspace() {
        viewModelScope.launch {
            val state = _uiState.value
            _uiState.update { it.copy(workspaceBusy = true, workspaceError = null) }
            try {
                when (state.workspaceMode) {
                    WorkspaceMode.EXISTING -> {
                        val workspaceId = state.workspaceIdInput.trim()
                        val workspaceSecret = state.workspaceSecretInput.trim()
                        if (workspaceId.isBlank() || workspaceSecret.isBlank()) {
                            throw IllegalStateException("Workspace ID et secret requis.")
                        }
                        loginWorkspace(workspaceId, workspaceSecret, auto = false)
                    }
                    WorkspaceMode.NEW -> {
                        val providers = buildWorkspaceProviders(state.workspaceProviders)
                        if (providers.isEmpty()) {
                            throw IllegalStateException("Sélectionnez au moins un provider.")
                        }
                        val createResult = sessionRepository.createWorkspace(
                            WorkspaceCreateRequest(providers = providers)
                        )
                        createResult.fold(
                            onSuccess = { created ->
                                _uiState.update {
                                    it.copy(
                                        workspaceCreatedId = created.workspaceId,
                                        workspaceCreatedSecret = created.workspaceSecret,
                                        workspaceIdInput = created.workspaceId,
                                        workspaceSecretInput = created.workspaceSecret
                                    )
                                }
                                loginWorkspace(created.workspaceId, created.workspaceSecret, auto = false)
                            },
                            onFailure = { error ->
                                throw error
                            }
                        )
                    }
                }
            } catch (error: Exception) {
                _uiState.update {
                    it.copy(
                        workspaceError = error.message ?: "Erreur workspace.",
                        workspaceBusy = false
                    )
                }
            }
        }
    }

    private suspend fun loginWorkspace(workspaceId: String, workspaceSecret: String, auto: Boolean) {
        _uiState.update { it.copy(workspaceBusy = true, workspaceError = null) }
        val result = sessionRepository.loginWorkspace(
            WorkspaceLoginRequest(workspaceId = workspaceId, workspaceSecret = workspaceSecret)
        )
        result.fold(
            onSuccess = { response ->
                sessionRepository.setWorkspaceToken(response.workspaceToken)
                sessionPreferences.saveWorkspace(
                    workspaceId = workspaceId,
                    workspaceSecret = workspaceSecret,
                    workspaceToken = response.workspaceToken
                )
                _uiState.update {
                    it.copy(
                        workspaceId = workspaceId,
                        workspaceToken = response.workspaceToken,
                        workspaceStep = 2,
                        workspaceBusy = false,
                        workspaceError = null
                    )
                }
            },
            onFailure = { error ->
                _uiState.update {
                    it.copy(
                        workspaceError = error.message ?: "Erreur d'authentification workspace.",
                        workspaceBusy = false,
                        workspaceStep = if (auto) 1 else it.workspaceStep
                    )
                }
            }
        )
    }

    private fun buildWorkspaceProviders(
        configs: Map<String, ProviderAuthUi>
    ): Map<String, WorkspaceProviderConfig> {
        val result = mutableMapOf<String, WorkspaceProviderConfig>()
        configs.forEach { (provider, config) ->
            if (!config.enabled) return@forEach
            val rawValue = config.authValue.trim()
            if (rawValue.isBlank()) {
                throw IllegalStateException("Clé requise pour $provider.")
            }
            val type = when (config.authType) {
                ProviderAuthType.API_KEY -> "api_key"
                ProviderAuthType.AUTH_JSON_B64 -> "auth_json_b64"
                ProviderAuthType.SETUP_TOKEN -> "setup_token"
            }
            val value = if (config.authType == ProviderAuthType.AUTH_JSON_B64) {
                Base64.getEncoder().encodeToString(rawValue.toByteArray())
            } else {
                rawValue
            }
            result[provider] = WorkspaceProviderConfig(
                enabled = true,
                auth = WorkspaceAuth(type = type, value = value)
            )
        }
        return result
    }


    fun createSession() {
        val state = _uiState.value

        if (state.repoUrl.isBlank()) {
            _uiState.update { it.copy(error = "URL du repository requise") }
            return
        }

        viewModelScope.launch {
            if (state.workspaceToken.isNullOrBlank()) {
                _uiState.update { it.copy(error = "Workspace non authentifié") }
                return@launch
            }
            sessionRepository.setWorkspaceToken(state.workspaceToken)
            _uiState.update {
                it.copy(
                    isLoading = true,
                    loadingState = LoadingState.CLONING,
                    error = null
                )
            }

            val result = sessionRepository.createSession(
                repoUrl = state.repoUrl,
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
                        provider = sessionState.activeProvider.name,
                        baseUrl = Vibe80Application.BASE_URL
                    )

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loadingState = LoadingState.NONE,
                            sessionId = sessionState.sessionId
                        )
                    }
                },
                onFailure = { exception ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loadingState = LoadingState.NONE,
                            error = exception.message ?: "Erreur lors de la création de la session"
                        )
                    }
                }
            )
        }
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
