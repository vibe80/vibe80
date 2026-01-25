package app.m5chat.android.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import app.m5chat.android.R
import app.m5chat.android.viewmodel.AuthMethod
import app.m5chat.android.viewmodel.SessionViewModel
import app.m5chat.shared.models.LLMProvider
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionScreen(
    onSessionCreated: (String) -> Unit,
    viewModel: SessionViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var showPassword by remember { mutableStateOf(false) }

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

                    // Error message
                    uiState.error?.let { error ->
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.errorContainer
                            )
                        ) {
                            Text(
                                text = error,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                modifier = Modifier.padding(16.dp)
                            )
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
                            Text(stringResource(R.string.cloning_repo))
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
                                Text(stringResource(R.string.cloning_repo))
                            }
                        }
                    }
                }
            }
        }
    }
}
