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
import app.vibe80.android.viewmodel.SessionViewModel
import app.vibe80.shared.models.LLMProvider
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionScreen(
    onSessionCreated: (String) -> Unit,
    viewModel: SessionViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showPassword by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val loadingText = when (uiState.loadingState) {
        LoadingState.RESUMING -> stringResource(R.string.resuming_session)
        LoadingState.CLONING -> stringResource(R.string.cloning_repo)
        LoadingState.NONE -> stringResource(R.string.cloning_repo)
    }

    // File picker for Claude config (~/.claude/config.json)
    val claudeConfigPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        uri?.let {
            try {
                val inputStream = context.contentResolver.openInputStream(it)
                val configJson = inputStream?.bufferedReader()?.readText()
                inputStream?.close()
                if (configJson != null) {
                    viewModel.saveClaudeConfig(configJson)
                }
            } catch (e: Exception) {
                // Error reading file - could add error handling here
            }
        }
    }

    // File picker for Codex config (~/.codex/auth.json)
    val codexConfigPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        uri?.let {
            try {
                val inputStream = context.contentResolver.openInputStream(it)
                val configJson = inputStream?.bufferedReader()?.readText()
                inputStream?.close()
                if (configJson != null) {
                    viewModel.saveCodexConfig(configJson)
                }
            } catch (e: Exception) {
                // Error reading file - could add error handling here
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
                title = { Text(stringResource(R.string.session_title)) }
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

                    // Divider if has saved session
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

                    // Repository URL
                    OutlinedTextField(
                        value = uiState.repoUrl,
                        onValueChange = viewModel::updateRepoUrl,
                        label = { Text(stringResource(R.string.repo_url_hint)) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        enabled = !uiState.isLoading
                    )

                    // Auth Method Selection
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

                    // SSH Key input
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

                    // HTTP credentials
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
                                visualTransformation = if (showPassword) {
                                    VisualTransformation.None
                                } else {
                                    PasswordVisualTransformation()
                                },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                                trailingIcon = {
                                    IconButton(onClick = { showPassword = !showPassword }) {
                                        Icon(
                                            imageVector = if (showPassword) {
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

                    // Provider Selection
                    Text(
                        text = stringResource(R.string.provider_label),
                        style = MaterialTheme.typography.titleSmall
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        LLMProvider.entries.forEach { provider ->
                            FilterChip(
                                selected = uiState.selectedProvider == provider,
                                onClick = { viewModel.updateProvider(provider) },
                                label = { Text(provider.name) },
                                enabled = !uiState.isLoading
                            )
                        }
                    }

                    // LLM Configuration Files
                    Text(
                        text = "Configuration LLM",
                        style = MaterialTheme.typography.titleSmall
                    )

                    // Claude config
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = { claudeConfigPicker.launch(arrayOf("application/json", "*/*")) },
                            modifier = Modifier.weight(1f),
                            enabled = !uiState.isLoading
                        ) {
                            Icon(
                                imageVector = Icons.Default.FileOpen,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Claude config.json")
                        }
                        if (uiState.hasClaudeConfig) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = "Configuré",
                                tint = MaterialTheme.colorScheme.primary
                            )
                            IconButton(
                                onClick = viewModel::clearClaudeConfig,
                                enabled = !uiState.isLoading
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Clear,
                                    contentDescription = "Supprimer",
                                    tint = MaterialTheme.colorScheme.error
                                )
                            }
                        }
                    }

                    // Codex config
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = { codexConfigPicker.launch(arrayOf("application/json", "*/*")) },
                            modifier = Modifier.weight(1f),
                            enabled = !uiState.isLoading
                        ) {
                            Icon(
                                imageVector = Icons.Default.FileOpen,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Codex auth.json")
                        }
                        if (uiState.hasCodexConfig) {
                            Icon(
                                imageVector = Icons.Default.CheckCircle,
                                contentDescription = "Configuré",
                                tint = MaterialTheme.colorScheme.primary
                            )
                            IconButton(
                                onClick = viewModel::clearCodexConfig,
                                enabled = !uiState.isLoading
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Clear,
                                    contentDescription = "Supprimer",
                                    tint = MaterialTheme.colorScheme.error
                                )
                            }
                        }
                    }

                    // Error message with debug details
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

                    // Create Session Button
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
