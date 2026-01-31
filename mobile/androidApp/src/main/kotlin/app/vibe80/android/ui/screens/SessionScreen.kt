package app.vibe80.android.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.FileOpen
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import app.vibe80.android.R
import app.vibe80.android.viewmodel.AuthMethod
import app.vibe80.android.viewmodel.LoadingState
import app.vibe80.android.viewmodel.ProviderAuthType
import app.vibe80.android.viewmodel.SessionViewModel
import app.vibe80.android.viewmodel.WorkspaceMode
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
    val loadingText = when (uiState.loadingState) {
        LoadingState.RESUMING -> stringResource(R.string.resuming_session)
        LoadingState.CLONING -> stringResource(R.string.cloning_repo)
        LoadingState.NONE -> stringResource(R.string.cloning_repo)
    }
    val showWorkspaceStep1 = uiState.workspaceStep == 1
    val showWorkspaceStep2 = uiState.workspaceStep == 2

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
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.session_title)) },
                actions = {
                    IconButton(onClick = onOpenQrScanner) {
                        Icon(
                            imageVector = Icons.Default.CameraAlt,
                            contentDescription = "Scanner un QR code"
                        )
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Show loading while checking for existing session
            if (uiState.isCheckingExistingSession) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    if (showWorkspaceStep1) {
                        Text(
                            text = "Workspace",
                            style = MaterialTheme.typography.titleMedium
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            FilterChip(
                                selected = uiState.workspaceMode == WorkspaceMode.EXISTING,
                                onClick = { viewModel.updateWorkspaceMode(WorkspaceMode.EXISTING) },
                                label = { Text("Existant") },
                                enabled = !uiState.workspaceBusy
                            )
                            FilterChip(
                                selected = uiState.workspaceMode == WorkspaceMode.NEW,
                                onClick = { viewModel.updateWorkspaceMode(WorkspaceMode.NEW) },
                                label = { Text("Nouveau") },
                                enabled = !uiState.workspaceBusy
                            )
                        }

                        AnimatedVisibility(visible = uiState.workspaceMode == WorkspaceMode.EXISTING) {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                OutlinedTextField(
                                    value = uiState.workspaceIdInput,
                                    onValueChange = viewModel::updateWorkspaceIdInput,
                                    label = { Text("workspaceId") },
                                    modifier = Modifier.fillMaxWidth(),
                                    singleLine = true,
                                    enabled = !uiState.workspaceBusy
                                )
                                OutlinedTextField(
                                    value = uiState.workspaceSecretInput,
                                    onValueChange = viewModel::updateWorkspaceSecretInput,
                                    label = { Text("workspaceSecret") },
                                    modifier = Modifier.fillMaxWidth(),
                                    singleLine = true,
                                    visualTransformation = if (showWorkspaceSecret) {
                                        VisualTransformation.None
                                    } else {
                                        PasswordVisualTransformation()
                                    },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                    trailingIcon = {
                                        IconButton(onClick = { showWorkspaceSecret = !showWorkspaceSecret }) {
                                            Icon(
                                                imageVector = if (showWorkspaceSecret) {
                                                    Icons.Default.VisibilityOff
                                                } else {
                                                    Icons.Default.Visibility
                                                },
                                                contentDescription = null
                                            )
                                        }
                                    },
                                    enabled = !uiState.workspaceBusy
                                )
                            }
                        }

                        AnimatedVisibility(visible = uiState.workspaceMode == WorkspaceMode.NEW) {
                            val codexConfig = uiState.workspaceProviders["codex"]
                            val claudeConfig = uiState.workspaceProviders["claude"]

                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("Providers", style = MaterialTheme.typography.titleSmall)

                                // Codex
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(
                                        checked = codexConfig?.enabled == true,
                                        onCheckedChange = { viewModel.toggleProvider("codex", it) },
                                        enabled = !uiState.workspaceBusy
                                    )
                                    Text("Codex")
                                }
                                if (codexConfig?.enabled == true) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        FilterChip(
                                            selected = codexConfig.authType == ProviderAuthType.API_KEY,
                                            onClick = { viewModel.updateProviderAuthType("codex", ProviderAuthType.API_KEY) },
                                            label = { Text("API key") },
                                            enabled = !uiState.workspaceBusy
                                        )
                                        FilterChip(
                                            selected = codexConfig.authType == ProviderAuthType.AUTH_JSON_B64,
                                            onClick = { viewModel.updateProviderAuthType("codex", ProviderAuthType.AUTH_JSON_B64) },
                                            label = { Text("auth_json_b64") },
                                            enabled = !uiState.workspaceBusy
                                        )
                                    }
                                    if (codexConfig.authType == ProviderAuthType.AUTH_JSON_B64) {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            OutlinedButton(
                                                onClick = { codexAuthPicker.launch(arrayOf("application/json", "*/*")) },
                                                modifier = Modifier.weight(1f),
                                                enabled = !uiState.workspaceBusy
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Default.FileOpen,
                                                    contentDescription = null,
                                                    modifier = Modifier.size(18.dp)
                                                )
                                                Spacer(modifier = Modifier.width(8.dp))
                                                Text("Importer auth.json")
                                            }
                                            if (codexConfig.authValue.isNotBlank()) {
                                                Icon(
                                                    imageVector = Icons.Default.CheckCircle,
                                                    contentDescription = "Chargé",
                                                    tint = MaterialTheme.colorScheme.primary
                                                )
                                                IconButton(
                                                    onClick = { viewModel.updateProviderAuthValue("codex", "") },
                                                    enabled = !uiState.workspaceBusy
                                                ) {
                                                    Icon(
                                                        imageVector = Icons.Default.Clear,
                                                        contentDescription = "Supprimer",
                                                        tint = MaterialTheme.colorScheme.error
                                                    )
                                                }
                                            }
                                        }
                                    } else {
                                        OutlinedTextField(
                                            value = codexConfig.authValue,
                                            onValueChange = { viewModel.updateProviderAuthValue("codex", it) },
                                            label = { Text("API key") },
                                            modifier = Modifier.fillMaxWidth(),
                                            singleLine = true,
                                            visualTransformation = if (showProviderSecrets) {
                                                VisualTransformation.None
                                            } else {
                                                PasswordVisualTransformation()
                                            },
                                            enabled = !uiState.workspaceBusy
                                        )
                                    }
                                }

                                // Claude
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Checkbox(
                                        checked = claudeConfig?.enabled == true,
                                        onCheckedChange = { viewModel.toggleProvider("claude", it) },
                                        enabled = !uiState.workspaceBusy
                                    )
                                    Text("Claude")
                                }
                                if (claudeConfig?.enabled == true) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        FilterChip(
                                            selected = claudeConfig.authType == ProviderAuthType.API_KEY,
                                            onClick = { viewModel.updateProviderAuthType("claude", ProviderAuthType.API_KEY) },
                                            label = { Text("API key") },
                                            enabled = !uiState.workspaceBusy
                                        )
                                        FilterChip(
                                            selected = claudeConfig.authType == ProviderAuthType.SETUP_TOKEN,
                                            onClick = { viewModel.updateProviderAuthType("claude", ProviderAuthType.SETUP_TOKEN) },
                                            label = { Text("setup_token") },
                                            enabled = !uiState.workspaceBusy
                                        )
                                    }
                                    OutlinedTextField(
                                        value = claudeConfig.authValue,
                                        onValueChange = { viewModel.updateProviderAuthValue("claude", it) },
                                        label = { Text(if (claudeConfig.authType == ProviderAuthType.SETUP_TOKEN) "Setup token" else "API key") },
                                        modifier = Modifier.fillMaxWidth(),
                                        singleLine = true,
                                        visualTransformation = if (showProviderSecrets) {
                                            VisualTransformation.None
                                        } else {
                                            PasswordVisualTransformation()
                                        },
                                        enabled = !uiState.workspaceBusy
                                    )
                                }

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.End
                                ) {
                                    TextButton(
                                        onClick = { showProviderSecrets = !showProviderSecrets },
                                        enabled = !uiState.workspaceBusy
                                    ) {
                                        Text(if (showProviderSecrets) "Masquer" else "Afficher")
                                    }
                                }
                            }
                        }

                        uiState.workspaceError?.let { error ->
                            Card(
                                colors = CardDefaults.cardColors(
                                    containerColor = MaterialTheme.colorScheme.errorContainer
                                ),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier.padding(16.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text(
                                        text = "Erreur workspace",
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.onErrorContainer
                                    )
                                    SelectionContainer {
                                        Text(
                                            text = error,
                                            color = MaterialTheme.colorScheme.onErrorContainer,
                                            style = MaterialTheme.typography.bodySmall
                                        )
                                    }
                                }
                            }
                        }

                        Button(
                            onClick = viewModel::submitWorkspace,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !uiState.workspaceBusy
                        ) {
                            if (uiState.workspaceBusy) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    strokeWidth = 2.dp
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Validation...")
                            } else {
                                Text("Continuer")
                            }
                        }
                    }

                    if (showWorkspaceStep2) {
                        uiState.workspaceCreatedId?.let { createdId ->
                            Card(
                                colors = CardDefaults.cardColors(
                                    containerColor = MaterialTheme.colorScheme.secondaryContainer
                                ),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier.padding(16.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Text(
                                        text = "Workspace créé",
                                        style = MaterialTheme.typography.titleSmall,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer
                                    )
                                    Text(
                                        text = "ID: $createdId",
                                        color = MaterialTheme.colorScheme.onSecondaryContainer
                                    )
                                    uiState.workspaceCreatedSecret?.let { secret ->
                                        Text(
                                            text = "Secret: $secret",
                                            color = MaterialTheme.colorScheme.onSecondaryContainer
                                        )
                                    }
                                }
                            }
                        }

                        // Resume existing session card
                        AnimatedVisibility(visible = uiState.hasSavedSession) {
                            Card(
                                colors = CardDefaults.cardColors(
                                    containerColor = MaterialTheme.colorScheme.secondaryContainer
                                ),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier.padding(16.dp),
                                    verticalArrangement = Arrangement.spacedBy(12.dp)
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Default.History,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.onSecondaryContainer
                                        )
                                        Text(
                                            text = "Session précédente",
                                            style = MaterialTheme.typography.titleMedium,
                                            color = MaterialTheme.colorScheme.onSecondaryContainer
                                        )
                                    }
                                    Text(
                                        text = uiState.repoUrl,
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer
                                    )
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        Button(
                                            onClick = viewModel::resumeExistingSession,
                                            modifier = Modifier.weight(1f),
                                            enabled = !uiState.isLoading
                                        ) {
                                            Text("Reprendre")
                                        }
                                        OutlinedButton(
                                            onClick = viewModel::clearSavedSession,
                                            enabled = !uiState.isLoading
                                        ) {
                                            Text("Oublier")
                                        }
                                    }
                                }
                            }
                        }

                        if (uiState.hasSavedSession) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(16.dp)
                            ) {
                                HorizontalDivider(modifier = Modifier.weight(1f))
                                Text(
                                    text = "ou créer une nouvelle session",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                HorizontalDivider(modifier = Modifier.weight(1f))
                            }
                        }

                        OutlinedTextField(
                            value = uiState.repoUrl,
                            onValueChange = viewModel::updateRepoUrl,
                            label = { Text(stringResource(R.string.repo_url_hint)) },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            enabled = !uiState.isLoading
                        )

                        Text(
                            text = "Authentification",
                            style = MaterialTheme.typography.titleSmall
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            AuthMethod.entries.forEach { method ->
                                FilterChip(
                                    selected = uiState.authMethod == method,
                                    onClick = { viewModel.updateAuthMethod(method) },
                                    label = {
                                        Text(
                                            when (method) {
                                                AuthMethod.NONE -> "Aucune"
                                                AuthMethod.SSH -> "SSH"
                                                AuthMethod.HTTP -> "HTTP"
                                            }
                                        )
                                    },
                                    enabled = !uiState.isLoading
                                )
                            }
                        }

                        AnimatedVisibility(visible = uiState.authMethod == AuthMethod.SSH) {
                            OutlinedTextField(
                                value = uiState.sshKey,
                                onValueChange = viewModel::updateSshKey,
                                label = { Text(stringResource(R.string.ssh_key_hint)) },
                                modifier = Modifier.fillMaxWidth(),
                                minLines = 3,
                                maxLines = 6,
                                enabled = !uiState.isLoading
                            )
                        }

                        AnimatedVisibility(visible = uiState.authMethod == AuthMethod.HTTP) {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                OutlinedTextField(
                                    value = uiState.httpUser,
                                    onValueChange = viewModel::updateHttpUser,
                                    label = { Text(stringResource(R.string.http_user_hint)) },
                                    modifier = Modifier.fillMaxWidth(),
                                    singleLine = true,
                                    enabled = !uiState.isLoading
                                )

                                OutlinedTextField(
                                    value = uiState.httpPassword,
                                    onValueChange = viewModel::updateHttpPassword,
                                    label = { Text(stringResource(R.string.http_password_hint)) },
                                    modifier = Modifier.fillMaxWidth(),
                                    singleLine = true,
                                    visualTransformation = if (showHttpPassword) {
                                        VisualTransformation.None
                                    } else {
                                        PasswordVisualTransformation()
                                    },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                    trailingIcon = {
                                        IconButton(onClick = { showHttpPassword = !showHttpPassword }) {
                                            Icon(
                                                imageVector = if (showHttpPassword) {
                                                    Icons.Default.VisibilityOff
                                                } else {
                                                    Icons.Default.Visibility
                                                },
                                                contentDescription = null
                                            )
                                        }
                                    },
                                    enabled = !uiState.isLoading
                                )
                            }
                        }

                        uiState.error?.let { error ->
                            Card(
                                colors = CardDefaults.cardColors(
                                    containerColor = MaterialTheme.colorScheme.errorContainer
                                ),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier.padding(16.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text(
                                            text = "Erreur",
                                            style = MaterialTheme.typography.titleSmall,
                                            color = MaterialTheme.colorScheme.onErrorContainer
                                        )
                                        IconButton(
                                            onClick = viewModel::clearError,
                                            modifier = Modifier.size(24.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Clear,
                                                contentDescription = "Fermer",
                                                tint = MaterialTheme.colorScheme.onErrorContainer
                                            )
                                        }
                                    }
                                    SelectionContainer {
                                        Text(
                                            text = error,
                                            color = MaterialTheme.colorScheme.onErrorContainer,
                                            style = MaterialTheme.typography.bodySmall
                                        )
                                    }
                                }
                            }
                        }

                        Spacer(modifier = Modifier.weight(1f))

                        Button(
                            onClick = viewModel::createSession,
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !uiState.isLoading && uiState.repoUrl.isNotBlank()
                        ) {
                            if (uiState.isLoading) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(24.dp),
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    strokeWidth = 2.dp
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(loadingText)
                            } else {
                                Text(stringResource(R.string.create_session))
                            }
                        }
                    }
                }
            }

            // Loading overlay
            if (uiState.isLoading) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.scrim.copy(alpha = 0.3f)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Card {
                            Column(
                                modifier = Modifier.padding(24.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(16.dp)
                            ) {
                                CircularProgressIndicator()
                                Text(loadingText)
                            }
                        }
                    }
                }
            }
        }
    }
}
