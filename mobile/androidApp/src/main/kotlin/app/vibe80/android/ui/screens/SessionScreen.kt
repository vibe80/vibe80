package app.vibe80.android.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.FileOpen
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import app.vibe80.android.viewmodel.AuthMethod
import app.vibe80.android.viewmodel.EntryScreen
import app.vibe80.android.viewmodel.LoadingState
import app.vibe80.android.viewmodel.ProviderAuthType
import app.vibe80.android.viewmodel.ProviderConfigMode
import app.vibe80.android.viewmodel.SessionViewModel
import app.vibe80.android.viewmodel.WorkspaceMode
import coil.compose.AsyncImage
import coil.decode.SvgDecoder
import coil.request.ImageRequest
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionScreen(
    onSessionCreated: (String) -> Unit,
    onOpenQrScanner: () -> Unit,
    viewModel: SessionViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showHttpPassword by remember { mutableStateOf(false) }
    var showWorkspaceSecret by remember { mutableStateOf(false) }
    var showProviderSecrets by remember { mutableStateOf(false) }
    val context = LocalContext.current

    val codexAuthPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        uri?.let {
            try {
                val inputStream = context.contentResolver.openInputStream(it)
                val configJson = inputStream?.bufferedReader()?.readText()
                inputStream?.close()
                if (!configJson.isNullOrBlank()) {
                    viewModel.updateProviderAuthValue("codex", configJson)
                }
            } catch (_: Exception) {
                // Ignore file read errors
            }
        }
    }

    LaunchedEffect(uiState.sessionId) {
        uiState.sessionId?.let { sessionId ->
            onSessionCreated(sessionId)
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (uiState.isCheckingExistingSession) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else {
                when (uiState.entryScreen) {
                    EntryScreen.WORKSPACE_MODE -> WorkspaceModeSelection(
                        onCreateWorkspace = { viewModel.selectWorkspaceMode(WorkspaceMode.NEW) },
                        onJoinWorkspace = { viewModel.selectWorkspaceMode(WorkspaceMode.EXISTING) },
                        onResumeDesktop = onOpenQrScanner
                    )

                    EntryScreen.WORKSPACE_CREDENTIALS -> WorkspaceCredentialsScreen(
                        workspaceId = uiState.workspaceIdInput,
                        workspaceSecret = uiState.workspaceSecretInput,
                        workspaceError = uiState.workspaceError,
                        workspaceBusy = uiState.workspaceBusy,
                        showSecret = showWorkspaceSecret,
                        onToggleSecret = { showWorkspaceSecret = !showWorkspaceSecret },
                        onWorkspaceIdChange = viewModel::updateWorkspaceIdInput,
                        onWorkspaceSecretChange = viewModel::updateWorkspaceSecretInput,
                        onContinue = viewModel::submitWorkspaceCredentials,
                        onBack = viewModel::openWorkspaceModeSelection
                    )

                    EntryScreen.PROVIDER_CONFIG -> ProviderConfigScreen(
                        providerMode = uiState.providerConfigMode,
                        providerConfigs = uiState.workspaceProviders,
                        workspaceError = uiState.workspaceError,
                        workspaceBusy = uiState.workspaceBusy,
                        showProviderSecrets = showProviderSecrets,
                        onToggleSecrets = { showProviderSecrets = !showProviderSecrets },
                        onToggleProvider = viewModel::toggleProvider,
                        onUpdateAuthType = viewModel::updateProviderAuthType,
                        onUpdateAuthValue = viewModel::updateProviderAuthValue,
                        onPickAuthJson = { codexAuthPicker.launch(arrayOf("application/json", "*/*")) },
                        onContinue = viewModel::submitProviderConfig,
                        onBack = {
                            if (uiState.providerConfigMode == ProviderConfigMode.UPDATE) {
                                viewModel.backToJoinSession()
                            } else {
                                viewModel.openWorkspaceModeSelection()
                            }
                        }
                    )

                    EntryScreen.WORKSPACE_CREATED -> WorkspaceCreatedScreen(
                        workspaceId = uiState.workspaceCreatedId,
                        workspaceSecret = uiState.workspaceCreatedSecret,
                        onContinue = viewModel::continueFromWorkspaceCreated
                    )

                    EntryScreen.JOIN_SESSION -> JoinSessionScreen(
                        hasSavedSession = uiState.hasSavedSession,
                        repoUrl = uiState.repoUrl,
                        error = uiState.error,
                        loadingState = uiState.loadingState,
                        isLoading = uiState.isLoading,
                        workspaceSessions = uiState.workspaceSessions,
                        sessionsLoading = uiState.sessionsLoading,
                        sessionsError = uiState.sessionsError,
                        onStartSession = viewModel::openStartSession,
                        onReconfigureProviders = viewModel::openProviderConfigForUpdate,
                        onResumeSession = viewModel::resumeExistingSession,
                        onDeleteSession = viewModel::clearSavedSession,
                        onResumeWorkspaceSession = viewModel::resumeWorkspaceSession,
                        onRefreshSessions = viewModel::loadWorkspaceSessions,
                        onLeaveWorkspace = viewModel::leaveWorkspace
                    )

                    EntryScreen.START_SESSION -> StartSessionScreen(
                        repoUrl = uiState.repoUrl,
                        authMethod = uiState.authMethod,
                        sshKey = uiState.sshKey,
                        httpUser = uiState.httpUser,
                        httpPassword = uiState.httpPassword,
                        showHttpPassword = showHttpPassword,
                        onToggleHttpPassword = { showHttpPassword = !showHttpPassword },
                        onRepoUrlChange = viewModel::updateRepoUrl,
                        onAuthMethodChange = viewModel::updateAuthMethod,
                        onSshKeyChange = viewModel::updateSshKey,
                        onHttpUserChange = viewModel::updateHttpUser,
                        onHttpPasswordChange = viewModel::updateHttpPassword,
                        onContinue = viewModel::createSession,
                        onBack = viewModel::backToJoinSession,
                        isLoading = uiState.isLoading,
                        loadingState = uiState.loadingState,
                        error = uiState.error
                    )
                }
            }
        }
    }
}

@Composable
private fun ScreenContainer(
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        content = content
    )
}

@Composable
private fun BrandHeader(title: String, subtitle: String? = null) {
    val context = LocalContext.current
    val isDark = isSystemInDarkTheme()
    val logoHeight = with(LocalDensity.current) {
        (MaterialTheme.typography.headlineMedium.fontSize * 2).toDp()
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(
            modifier = Modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center
        ) {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data("file:///android_asset/" + if (isDark) "vibe80_dark.svg" else "vibe80_light.svg")
                    .decoderFactory(SvgDecoder.Factory())
                    .build(),
                contentDescription = "Vibe80",
                modifier = Modifier.height(logoHeight)
            )
        }
        Text(text = title, style = MaterialTheme.typography.titleMedium)
        subtitle?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun WorkspaceModeSelection(
    onCreateWorkspace: () -> Unit,
    onJoinWorkspace: () -> Unit,
    onResumeDesktop: () -> Unit
) {
    ScreenContainer {
        BrandHeader(
            title = "Bienvenue dans Vibe80",
            subtitle = "Choisissez comment démarrer votre session."
        )

        Button(
            onClick = onCreateWorkspace,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Créer un nouveau workspace")
        }

        Button(
            onClick = onJoinWorkspace,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Rejoindre un workspace existant")
        }

        OutlinedButton(
            onClick = onResumeDesktop,
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(imageVector = Icons.Default.CameraAlt, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Reprendre une session desktop")
        }
    }
}

@Composable
private fun WorkspaceCredentialsScreen(
    workspaceId: String,
    workspaceSecret: String,
    workspaceError: String?,
    workspaceBusy: Boolean,
    showSecret: Boolean,
    onToggleSecret: () -> Unit,
    onWorkspaceIdChange: (String) -> Unit,
    onWorkspaceSecretChange: (String) -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit
) {
    ScreenContainer {
        TextButton(onClick = onBack) {
            Icon(imageVector = Icons.Default.ArrowBack, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Retour")
        }

        BrandHeader(title = "Identifiants workspace")

        OutlinedTextField(
            value = workspaceId,
            onValueChange = onWorkspaceIdChange,
            label = { Text("Workspace ID") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !workspaceBusy
        )

        OutlinedTextField(
            value = workspaceSecret,
            onValueChange = onWorkspaceSecretChange,
            label = { Text("Workspace secret") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = if (showSecret) {
                VisualTransformation.None
            } else {
                PasswordVisualTransformation()
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            trailingIcon = {
                IconButton(onClick = onToggleSecret) {
                    Icon(
                        imageVector = if (showSecret) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = null
                    )
                }
            },
            enabled = !workspaceBusy
        )

        workspaceError?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }

        Button(
            onClick = onContinue,
            modifier = Modifier.fillMaxWidth(),
            enabled = !workspaceBusy
        ) {
            if (workspaceBusy) {
                CircularProgressIndicator(
                    color = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.height(18.dp)
                )
            } else {
                Text("Continuer")
            }
        }
    }
}

@Composable
private fun ProviderConfigScreen(
    providerMode: ProviderConfigMode,
    providerConfigs: Map<String, app.vibe80.android.viewmodel.ProviderAuthUi>,
    workspaceError: String?,
    workspaceBusy: Boolean,
    showProviderSecrets: Boolean,
    onToggleSecrets: () -> Unit,
    onToggleProvider: (String, Boolean) -> Unit,
    onUpdateAuthType: (String, ProviderAuthType) -> Unit,
    onUpdateAuthValue: (String, String) -> Unit,
    onPickAuthJson: () -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit
) {
    val codexConfig = providerConfigs["codex"]
    val claudeConfig = providerConfigs["claude"]

    ScreenContainer {
        TextButton(onClick = onBack) {
            Icon(imageVector = Icons.Default.ArrowBack, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Retour")
        }

        BrandHeader(title = "Configuration des providers IA")

        Text(
            text = if (providerMode == ProviderConfigMode.UPDATE) {
                "Mettez à jour vos providers pour ce workspace."
            } else {
                "Sélectionnez au moins un provider."
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        ProviderSection(
            title = "Codex",
            enabled = codexConfig?.enabled == true,
            authType = codexConfig?.authType ?: ProviderAuthType.API_KEY,
            authValue = codexConfig?.authValue.orEmpty(),
            workspaceBusy = workspaceBusy,
            showProviderSecrets = showProviderSecrets,
            onToggleSecrets = onToggleSecrets,
            onToggleProvider = { onToggleProvider("codex", it) },
            onUpdateAuthType = { onUpdateAuthType("codex", it) },
            onUpdateAuthValue = { onUpdateAuthValue("codex", it) },
            onPickAuthJson = onPickAuthJson
        )

        ProviderSection(
            title = "Claude",
            enabled = claudeConfig?.enabled == true,
            authType = claudeConfig?.authType ?: ProviderAuthType.SETUP_TOKEN,
            authValue = claudeConfig?.authValue.orEmpty(),
            workspaceBusy = workspaceBusy,
            showProviderSecrets = showProviderSecrets,
            onToggleSecrets = onToggleSecrets,
            onToggleProvider = { onToggleProvider("claude", it) },
            onUpdateAuthType = { onUpdateAuthType("claude", it) },
            onUpdateAuthValue = { onUpdateAuthValue("claude", it) },
            onPickAuthJson = null
        )

        workspaceError?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }

        Button(
            onClick = onContinue,
            modifier = Modifier.fillMaxWidth(),
            enabled = !workspaceBusy
        ) {
            if (workspaceBusy) {
                CircularProgressIndicator(
                    color = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.height(18.dp)
                )
            } else {
                Text("Continuer")
            }
        }
    }
}

@Composable
private fun ProviderSection(
    title: String,
    enabled: Boolean,
    authType: ProviderAuthType,
    authValue: String,
    workspaceBusy: Boolean,
    showProviderSecrets: Boolean,
    onToggleSecrets: () -> Unit,
    onToggleProvider: (Boolean) -> Unit,
    onUpdateAuthType: (ProviderAuthType) -> Unit,
    onUpdateAuthValue: (String) -> Unit,
    onPickAuthJson: (() -> Unit)?
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(
                    checked = enabled,
                    onCheckedChange = onToggleProvider,
                    enabled = !workspaceBusy
                )
                Text(title, style = MaterialTheme.typography.titleMedium)
            }

            if (enabled) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = authType == ProviderAuthType.API_KEY,
                        onClick = { onUpdateAuthType(ProviderAuthType.API_KEY) },
                        label = { Text("API key") },
                        enabled = !workspaceBusy
                    )
                    FilterChip(
                        selected = authType == ProviderAuthType.AUTH_JSON_B64,
                        onClick = { onUpdateAuthType(ProviderAuthType.AUTH_JSON_B64) },
                        label = { Text("auth_json_b64") },
                        enabled = !workspaceBusy
                    )
                    if (title.lowercase() == "claude") {
                        FilterChip(
                            selected = authType == ProviderAuthType.SETUP_TOKEN,
                            onClick = { onUpdateAuthType(ProviderAuthType.SETUP_TOKEN) },
                            label = { Text("setup_token") },
                            enabled = !workspaceBusy
                        )
                    }
                }

                if (authType == ProviderAuthType.AUTH_JSON_B64) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedButton(
                            onClick = { onPickAuthJson?.invoke() },
                            modifier = Modifier.weight(1f),
                            enabled = !workspaceBusy && onPickAuthJson != null
                        ) {
                            Icon(
                                imageVector = Icons.Default.FileOpen,
                                contentDescription = null,
                                modifier = Modifier.width(18.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Importer auth.json")
                        }
                        if (authValue.isNotBlank()) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = "Chargé",
                                tint = MaterialTheme.colorScheme.primary
                            )
                            IconButton(
                                onClick = { onUpdateAuthValue("") },
                                enabled = !workspaceBusy
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Clear,
                                    contentDescription = "Supprimer",
                                    tint = MaterialTheme.colorScheme.error
                                )
                            }
                        }
                    }

                    OutlinedTextField(
                        value = authValue,
                        onValueChange = onUpdateAuthValue,
                        label = { Text("auth.json") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 4,
                        maxLines = 6,
                        singleLine = false,
                        visualTransformation = VisualTransformation.None,
                        enabled = !workspaceBusy
                    )
                } else {
                    OutlinedTextField(
                        value = authValue,
                        onValueChange = onUpdateAuthValue,
                        label = {
                            Text(
                                when (authType) {
                                    ProviderAuthType.API_KEY -> "Clé API"
                                    ProviderAuthType.SETUP_TOKEN -> "Setup token"
                                    ProviderAuthType.AUTH_JSON_B64 -> "auth.json"
                                }
                            )
                        },
                        modifier = Modifier.fillMaxWidth(),
                        visualTransformation = if (showProviderSecrets) {
                            VisualTransformation.None
                        } else {
                            PasswordVisualTransformation()
                        },
                        trailingIcon = {
                            IconButton(onClick = onToggleSecrets) {
                                Icon(
                                    imageVector = if (showProviderSecrets) {
                                        Icons.Default.VisibilityOff
                                    } else {
                                        Icons.Default.Visibility
                                    },
                                    contentDescription = null
                                )
                            }
                        },
                        enabled = !workspaceBusy
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkspaceCreatedScreen(
    workspaceId: String?,
    workspaceSecret: String?,
    onContinue: () -> Unit
) {
    ScreenContainer {
        BrandHeader(
            title = "Workspace créé",
            subtitle = "Conservez ces identifiants pour vos prochaines connexions."
        )

        Card(
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            shape = MaterialTheme.shapes.large,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("Workspace ID", style = MaterialTheme.typography.labelMedium)
                SelectionContainer {
                    Text(workspaceId ?: "-", style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text("Workspace secret", style = MaterialTheme.typography.labelMedium)
                SelectionContainer {
                    Text(workspaceSecret ?: "-", style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        Button(
            onClick = onContinue,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Continuer")
        }
    }
}

@Composable
private fun JoinSessionScreen(
    hasSavedSession: Boolean,
    repoUrl: String,
    error: String?,
    loadingState: LoadingState,
    isLoading: Boolean,
    workspaceSessions: List<app.vibe80.shared.models.SessionSummary>,
    sessionsLoading: Boolean,
    sessionsError: String?,
    onStartSession: () -> Unit,
    onReconfigureProviders: () -> Unit,
    onResumeSession: () -> Unit,
    onDeleteSession: () -> Unit,
    onResumeWorkspaceSession: (String, String?) -> Unit,
    onRefreshSessions: () -> Unit,
    onLeaveWorkspace: () -> Unit
) {
    ScreenContainer {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            BrandHeader(title = "Rejoindre une session")
            IconButton(onClick = onLeaveWorkspace) {
                Icon(
                    imageVector = Icons.Default.Logout,
                    contentDescription = "Quitter le workspace"
                )
            }
        }

        Button(
            onClick = onStartSession,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Démarrer une nouvelle session")
        }

        OutlinedButton(
            onClick = onReconfigureProviders,
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(imageVector = Icons.Default.Refresh, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Reconfigurer les providers IA")
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Sessions récentes", style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = onRefreshSessions, enabled = !sessionsLoading) {
                Text(if (sessionsLoading) "Chargement..." else "Rafraîchir")
            }
        }

        if (hasSavedSession) {
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = MaterialTheme.shapes.large,
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(repoUrl.ifBlank { "Session sauvegardée" })
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(
                            onClick = onResumeSession,
                            enabled = !isLoading
                        ) {
                            Text(
                                if (loadingState == LoadingState.RESUMING) "Reprise..." else "Reprendre"
                            )
                        }
                        OutlinedButton(onClick = onDeleteSession) {
                            Text("Supprimer")
                        }
                    }
                }
            }
        } else {
            Text(
                text = "Aucune session sauvegardée pour le moment.",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (workspaceSessions.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                workspaceSessions.forEach { session ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        shape = MaterialTheme.shapes.large,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = session.name?.takeIf { it.isNotBlank() }
                                    ?: session.repoUrl?.takeIf { it.isNotBlank() }
                                    ?: "Session ${session.sessionId}"
                            )
                            Text(
                                text = session.sessionId,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Button(
                                onClick = { onResumeWorkspaceSession(session.sessionId, session.repoUrl) },
                                enabled = !isLoading
                            ) {
                                Text("Reprendre")
                            }
                        }
                    }
                }
            }
        } else if (!sessionsLoading) {
            Text(
                text = "Aucune session trouvée dans le workspace.",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        sessionsError?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun StartSessionScreen(
    repoUrl: String,
    authMethod: AuthMethod,
    sshKey: String,
    httpUser: String,
    httpPassword: String,
    showHttpPassword: Boolean,
    onToggleHttpPassword: () -> Unit,
    onRepoUrlChange: (String) -> Unit,
    onAuthMethodChange: (AuthMethod) -> Unit,
    onSshKeyChange: (String) -> Unit,
    onHttpUserChange: (String) -> Unit,
    onHttpPasswordChange: (String) -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit,
    isLoading: Boolean,
    loadingState: LoadingState,
    error: String?
) {
    ScreenContainer {
        TextButton(onClick = onBack) {
            Icon(imageVector = Icons.Default.ArrowBack, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Retour")
        }

        BrandHeader(title = "Démarrer une session")

        OutlinedTextField(
            value = repoUrl,
            onValueChange = onRepoUrlChange,
            label = { Text("Repository URL") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri)
        )

        Text("Authentification", style = MaterialTheme.typography.titleSmall)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(
                selected = authMethod == AuthMethod.NONE,
                onClick = { onAuthMethodChange(AuthMethod.NONE) },
                label = { Text("Aucune") }
            )
            FilterChip(
                selected = authMethod == AuthMethod.HTTP,
                onClick = { onAuthMethodChange(AuthMethod.HTTP) },
                label = { Text("HTTP") }
            )
            FilterChip(
                selected = authMethod == AuthMethod.SSH,
                onClick = { onAuthMethodChange(AuthMethod.SSH) },
                label = { Text("SSH") }
            )
        }

        if (authMethod == AuthMethod.SSH) {
            OutlinedTextField(
                value = sshKey,
                onValueChange = onSshKeyChange,
                label = { Text("Clé SSH privée") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 4,
                maxLines = 6
            )
        }

        if (authMethod == AuthMethod.HTTP) {
            OutlinedTextField(
                value = httpUser,
                onValueChange = onHttpUserChange,
                label = { Text("Nom d'utilisateur") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            OutlinedTextField(
                value = httpPassword,
                onValueChange = onHttpPasswordChange,
                label = { Text("Mot de passe / Token") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                visualTransformation = if (showHttpPassword) {
                    VisualTransformation.None
                } else {
                    PasswordVisualTransformation()
                },
                trailingIcon = {
                    IconButton(onClick = onToggleHttpPassword) {
                        Icon(
                            imageVector = if (showHttpPassword) {
                                Icons.Default.VisibilityOff
                            } else {
                                Icons.Default.Visibility
                            },
                            contentDescription = null
                        )
                    }
                }
            )
        }

        error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }

        Button(
            onClick = onContinue,
            modifier = Modifier.fillMaxWidth(),
            enabled = !isLoading
        ) {
            if (isLoading) {
                Text(
                    when (loadingState) {
                        LoadingState.CLONING -> "Clonage..."
                        LoadingState.RESUMING -> "Reprise..."
                        LoadingState.NONE -> "Chargement..."
                    }
                )
            } else {
                Text("Continuer")
            }
        }
    }
}
