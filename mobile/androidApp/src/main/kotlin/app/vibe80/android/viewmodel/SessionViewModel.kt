package app.vibe80.android.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.vibe80.android.data.SessionPreferences
import app.vibe80.shared.models.FlexibleNullableTimestampAsLongSerializer
import app.vibe80.shared.models.WorkspaceAuth
import app.vibe80.shared.models.WorkspaceCreateRequest
import app.vibe80.shared.models.WorkspaceLoginRequest
import app.vibe80.shared.models.WorkspaceProviderConfig
import app.vibe80.shared.models.WorkspaceUpdateRequest
import app.vibe80.shared.repository.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Base64
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

data class SessionUiState(
    val entryScreen: EntryScreen = EntryScreen.WORKSPACE_MODE,
    val workspaceMode: WorkspaceMode = WorkspaceMode.EXISTING,
    val providerConfigMode: ProviderConfigMode = ProviderConfigMode.CREATE,
    val workspaceIdInput: String = "",
    val workspaceSecretInput: String = "",
    val workspaceId: String? = null,
    val workspaceToken: String? = null,
    val workspaceRefreshToken: String? = null,
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
    val workspaceSessions: List<app.vibe80.shared.models.SessionSummary> = emptyList(),
    val sessionsLoading: Boolean = false,
    val sessionsError: String? = null,
    val handoffBusy: Boolean = false,
    val handoffError: String? = null
)

enum class EntryScreen {
    WORKSPACE_MODE,
    WORKSPACE_CREDENTIALS,
    PROVIDER_CONFIG,
    WORKSPACE_CREATED,
    JOIN_SESSION,
    START_SESSION
}

enum class AuthMethod {
    NONE, SSH, HTTP
}

enum class WorkspaceMode {
    EXISTING, NEW
}

enum class ProviderConfigMode {
    CREATE, UPDATE
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
    private val handoffJson = Json { ignoreUnknownKeys = true; isLenient = true }

    init {
        _uiState.update { it.copy(isCheckingExistingSession = false) }
        loadWorkspace()
        observeWorkspaceAuthInvalid()
        observeWorkspaceTokenUpdates()
    }

    private fun observeWorkspaceTokenUpdates() {
        viewModelScope.launch {
            sessionRepository.workspaceTokenUpdates.collect { update ->
                sessionPreferences.saveWorkspaceToken(
                    workspaceToken = update.workspaceToken,
                    refreshToken = update.refreshToken
                )
                _uiState.update { state ->
                    state.copy(
                        workspaceToken = update.workspaceToken,
                        workspaceRefreshToken = update.refreshToken
                    )
                }
            }
        }
    }

    private fun observeWorkspaceAuthInvalid() {
        viewModelScope.launch {
            sessionRepository.workspaceAuthInvalid.collect {
                sessionRepository.setWorkspaceToken(null)
                sessionRepository.setRefreshToken(null)
                sessionPreferences.clearWorkspace()
                _uiState.update { state ->
                    state.copy(
                        entryScreen = EntryScreen.WORKSPACE_MODE,
                        workspaceMode = WorkspaceMode.EXISTING,
                        providerConfigMode = ProviderConfigMode.CREATE,
                        workspaceIdInput = "",
                        workspaceSecretInput = "",
                        workspaceId = null,
                        workspaceToken = null,
                        workspaceRefreshToken = null,
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
                        entryScreen = EntryScreen.WORKSPACE_MODE,
                        workspaceMode = WorkspaceMode.EXISTING,
                        providerConfigMode = ProviderConfigMode.CREATE,
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
                    workspaceRefreshToken = saved.workspaceRefreshToken,
                    entryScreen = EntryScreen.JOIN_SESSION
                )
            }
            if (!saved.workspaceToken.isNullOrBlank()) {
                sessionRepository.setWorkspaceToken(saved.workspaceToken)
                if (!saved.workspaceRefreshToken.isNullOrBlank()) {
                    sessionRepository.setRefreshToken(saved.workspaceRefreshToken)
                }
                loadWorkspaceSessions()
            } else {
                loginWorkspace(saved.workspaceId, saved.workspaceSecret, auto = true)
            }
        }
    }

    fun resumeWorkspaceSession(sessionId: String, repoUrl: String?) {
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
            sessionRepository.setRefreshToken(_uiState.value.workspaceRefreshToken)
            _uiState.update {
                it.copy(
                    isLoading = true,
                    loadingState = LoadingState.RESUMING,
                    error = null
                )
            }

            val result = sessionRepository.reconnectSession(sessionId, repoUrl)
            result.fold(
                onSuccess = {
                    sessionRepository.listWorktrees()
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loadingState = LoadingState.NONE,
                            sessionId = sessionId
                        )
                    }
                },
                onFailure = { exception ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loadingState = LoadingState.NONE,
                            error = exception.message ?: "Impossible de reprendre la session."
                        )
                    }
                }
            )
        }
    }

    fun loadWorkspaceSessions() {
        val token = _uiState.value.workspaceToken
        if (token.isNullOrBlank()) {
            _uiState.update { it.copy(workspaceSessions = emptyList(), sessionsError = null) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(sessionsLoading = true, sessionsError = null) }
            sessionRepository.listSessions()
                .onSuccess { response ->
                    _uiState.update {
                        it.copy(
                            workspaceSessions = response.sessions,
                            sessionsLoading = false,
                            sessionsError = null
                        )
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            sessionsLoading = false,
                            sessionsError = error.message ?: "Impossible de charger les sessions."
                        )
                    }
                }
        }
    }

    fun updateRepoUrl(url: String) {
        _uiState.update { it.copy(repoUrl = url, error = null) }
    }

    fun selectWorkspaceMode(mode: WorkspaceMode) {
        _uiState.update {
            it.copy(
                workspaceMode = mode,
                providerConfigMode = ProviderConfigMode.CREATE,
                workspaceError = null,
                entryScreen = if (mode == WorkspaceMode.EXISTING) {
                    EntryScreen.WORKSPACE_CREDENTIALS
                } else {
                    EntryScreen.PROVIDER_CONFIG
                }
            )
        }
    }

    fun openWorkspaceModeSelection() {
        _uiState.update {
            it.copy(
                entryScreen = EntryScreen.WORKSPACE_MODE,
                providerConfigMode = ProviderConfigMode.CREATE,
                workspaceError = null
            )
        }
    }

    fun openProviderConfigForUpdate() {
        _uiState.update {
            it.copy(
                entryScreen = EntryScreen.PROVIDER_CONFIG,
                providerConfigMode = ProviderConfigMode.UPDATE,
                workspaceError = null
            )
        }
    }

    fun openStartSession() {
        _uiState.update { it.copy(entryScreen = EntryScreen.START_SESSION, error = null) }
    }

    fun backToJoinSession() {
        _uiState.update {
            it.copy(
                entryScreen = EntryScreen.JOIN_SESSION,
                providerConfigMode = ProviderConfigMode.CREATE,
                error = null
            )
        }
        loadWorkspaceSessions()
    }

    fun continueFromWorkspaceCreated() {
        _uiState.update { it.copy(entryScreen = EntryScreen.JOIN_SESSION) }
        loadWorkspaceSessions()
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

    fun submitWorkspaceCredentials() {
        viewModelScope.launch {
            val state = _uiState.value
            _uiState.update { it.copy(workspaceBusy = true, workspaceError = null) }
            try {
                val workspaceId = state.workspaceIdInput.trim()
                val workspaceSecret = state.workspaceSecretInput.trim()
                if (workspaceId.isBlank() || workspaceSecret.isBlank()) {
                    throw IllegalStateException("Workspace ID et secret requis.")
                }
                loginWorkspace(workspaceId, workspaceSecret, auto = false)
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

    fun submitProviderConfig() {
        viewModelScope.launch {
            val state = _uiState.value
            _uiState.update { it.copy(workspaceBusy = true, workspaceError = null) }
            try {
                val providers = buildWorkspaceProviders(state.workspaceProviders)
                if (providers.isEmpty()) {
                    throw IllegalStateException("Sélectionnez au moins un provider.")
                }
                when (state.providerConfigMode) {
                    ProviderConfigMode.CREATE -> {
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
                                _uiState.update {
                                    it.copy(
                                        workspaceBusy = false,
                                        entryScreen = EntryScreen.WORKSPACE_CREATED
                                    )
                                }
                            },
                            onFailure = { error ->
                                throw error
                            }
                        )
                    }
                    ProviderConfigMode.UPDATE -> {
                        val workspaceId = state.workspaceId
                            ?: throw IllegalStateException("Workspace introuvable.")
                        val result = sessionRepository.updateWorkspace(
                            workspaceId,
                            WorkspaceUpdateRequest(providers = providers)
                        )
                        result.fold(
                            onSuccess = {
                                _uiState.update {
                                    it.copy(
                                        workspaceBusy = false,
                                        entryScreen = EntryScreen.JOIN_SESSION
                                    )
                                }
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
                sessionRepository.setRefreshToken(response.refreshToken)
                sessionPreferences.saveWorkspace(
                    workspaceId = workspaceId,
                    workspaceSecret = workspaceSecret,
                    workspaceToken = response.workspaceToken,
                    workspaceRefreshToken = response.refreshToken
                )
                sessionPreferences.saveWorkspaceToken(
                    workspaceToken = response.workspaceToken,
                    refreshToken = response.refreshToken
                )
                _uiState.update {
                    it.copy(
                        workspaceId = workspaceId,
                        workspaceToken = response.workspaceToken,
                        workspaceRefreshToken = response.refreshToken,
                        entryScreen = EntryScreen.JOIN_SESSION,
                        workspaceBusy = false,
                        workspaceError = null
                    )
                }
                loadWorkspaceSessions()
            },
            onFailure = { error ->
                _uiState.update {
                    it.copy(
                        workspaceError = error.message ?: "Erreur d'authentification workspace.",
                        workspaceBusy = false,
                        entryScreen = if (auto) EntryScreen.WORKSPACE_MODE else it.entryScreen
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
            sessionRepository.setRefreshToken(state.workspaceRefreshToken)
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
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loadingState = LoadingState.NONE,
                            sessionId = sessionState.sessionId
                        )
                    }
                },
                onFailure = { exception ->
                    val friendlyMessage = when (exception) {
                        is app.vibe80.shared.network.SessionCreationException -> {
                            if (exception.statusCode == 403 && !exception.errorMessage.isNullOrBlank()) {
                                exception.errorMessage
                            } else {
                                null
                            }
                        }
                        else -> null
                    }
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            loadingState = LoadingState.NONE,
                            error = friendlyMessage
                                ?: exception.message
                                ?: "Erreur lors de la création de la session"
                        )
                    }
                }
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearHandoffError() {
        _uiState.update { it.copy(handoffError = null) }
    }

    fun leaveWorkspace() {
        viewModelScope.launch {
            sessionRepository.setWorkspaceToken(null)
            sessionRepository.setRefreshToken(null)
            sessionPreferences.clearWorkspace()
            _uiState.update { state ->
                state.copy(
                    entryScreen = EntryScreen.WORKSPACE_MODE,
                    workspaceMode = WorkspaceMode.EXISTING,
                    providerConfigMode = ProviderConfigMode.CREATE,
                    workspaceIdInput = "",
                    workspaceSecretInput = "",
                    workspaceId = null,
                    workspaceToken = null,
                    workspaceRefreshToken = null,
                    workspaceError = null,
                    workspaceBusy = false,
                    repoUrl = "",
                    sessionId = null,
                    workspaceSessions = emptyList(),
                    sessionsLoading = false,
                    sessionsError = null
                )
            }
        }
    }

    fun consumeHandoffPayload(payload: String, onSuccess: (String) -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(handoffBusy = true, handoffError = null) }

            val parsed = runCatching {
                handoffJson.decodeFromString<HandoffQrPayload>(payload)
            }.getOrNull()

            val token = parsed?.handoffToken?.trim()
            if (token.isNullOrBlank()) {
                _uiState.update {
                    it.copy(
                        handoffBusy = false,
                        handoffError = "QR code invalide."
                    )
                }
                return@launch
            }

            val result = sessionRepository.consumeHandoffToken(token)
            result.fold(
                onSuccess = { response ->
                    sessionRepository.setWorkspaceToken(response.workspaceToken)
                    sessionRepository.setRefreshToken(response.refreshToken)
                    sessionPreferences.saveWorkspace(
                        workspaceId = response.workspaceId,
                        workspaceSecret = "",
                        workspaceToken = response.workspaceToken,
                        workspaceRefreshToken = response.refreshToken
                    )
                    val sessionState = sessionRepository
                        .reconnectSession(response.sessionId)
                        .getOrNull()
                    sessionRepository.listWorktrees()
                    _uiState.update {
                        it.copy(
                            workspaceId = response.workspaceId,
                            workspaceIdInput = response.workspaceId,
                            workspaceSecretInput = "",
                            workspaceToken = response.workspaceToken,
                            workspaceRefreshToken = response.refreshToken,
                            entryScreen = EntryScreen.JOIN_SESSION,
                            handoffBusy = false,
                            handoffError = null,
                            sessionId = response.sessionId
                        )
                    }
                    onSuccess(response.sessionId)
                },
                onFailure = { error ->
                    _uiState.update {
                        it.copy(
                            handoffBusy = false,
                            handoffError = error.message
                                ?: "Impossible de reprendre la session."
                        )
                    }
                }
            )
        }
    }
}

@Serializable
private data class HandoffQrPayload(
    val handoffToken: String,
    val baseUrl: String? = null,
    @Serializable(with = FlexibleNullableTimestampAsLongSerializer::class)
    val expiresAt: Long? = null,
    val type: String? = null
)
