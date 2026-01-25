package app.m5chat.android.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.DifferenceOutlined
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.m5chat.android.R
import app.m5chat.android.ui.components.MessageBubble
import app.m5chat.android.viewmodel.ChatViewModel
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.network.ConnectionState
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    sessionId: String,
    onDisconnect: () -> Unit,
    viewModel: ChatViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()

    // Auto-scroll to bottom on new messages
    LaunchedEffect(uiState.messages.size, uiState.currentStreamingMessage) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "M5Chat",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = when (uiState.connectionState) {
                                ConnectionState.CONNECTED -> stringResource(R.string.connected)
                                ConnectionState.CONNECTING -> "Connexion..."
                                ConnectionState.RECONNECTING -> stringResource(R.string.reconnecting)
                                ConnectionState.DISCONNECTED -> stringResource(R.string.disconnected)
                                ConnectionState.ERROR -> stringResource(R.string.error_connection)
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = when (uiState.connectionState) {
                                ConnectionState.CONNECTED -> MaterialTheme.colorScheme.primary
                                ConnectionState.ERROR -> MaterialTheme.colorScheme.error
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                    }
                },
                actions = {
                    // Provider chip
                    AssistChip(
                        onClick = {
                            val newProvider = if (uiState.activeProvider == LLMProvider.CODEX) {
                                LLMProvider.CLAUDE
                            } else {
                                LLMProvider.CODEX
                            }
                            viewModel.switchProvider(newProvider)
                        },
                        label = { Text(uiState.activeProvider.name) },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Default.Code,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    )

                    // Branches button
                    IconButton(onClick = viewModel::showBranchesSheet) {
                        Icon(
                            imageVector = Icons.Default.Code,
                            contentDescription = stringResource(R.string.branches)
                        )
                    }

                    // Diff button
                    IconButton(onClick = viewModel::showDiffSheet) {
                        Icon(
                            imageVector = Icons.Default.DifferenceOutlined,
                            contentDescription = stringResource(R.string.diff)
                        )
                    }

                    // Disconnect button
                    IconButton(onClick = {
                        viewModel.disconnect()
                        onDisconnect()
                    }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Logout,
                            contentDescription = "Déconnexion"
                        )
                    }
                }
            )
        },
        bottomBar = {
            Surface(
                tonalElevation = 3.dp,
                shadowElevation = 8.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                        .imePadding(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = uiState.inputText,
                        onValueChange = viewModel::updateInputText,
                        modifier = Modifier.weight(1f),
                        placeholder = { Text(stringResource(R.string.message_hint)) },
                        maxLines = 4,
                        enabled = uiState.connectionState == ConnectionState.CONNECTED && !uiState.processing
                    )

                    FilledIconButton(
                        onClick = viewModel::sendMessage,
                        enabled = uiState.inputText.isNotBlank() &&
                                uiState.connectionState == ConnectionState.CONNECTED &&
                                !uiState.processing
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Send,
                            contentDescription = stringResource(R.string.send_message)
                        )
                    }
                }
            }
        }
    ) { padding ->
        LazyColumn(
            state = listState,
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(
                items = uiState.messages,
                key = { it.id }
            ) { message ->
                MessageBubble(message = message)
            }

            // Streaming message
            uiState.currentStreamingMessage?.let { streamingText ->
                item(key = "streaming") {
                    MessageBubble(
                        message = null,
                        streamingText = streamingText,
                        isStreaming = true
                    )
                }
            }

            // Processing indicator
            if (uiState.processing && uiState.currentStreamingMessage == null) {
                item(key = "loading") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Start
                    ) {
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surfaceVariant
                            )
                        ) {
                            Row(
                                modifier = Modifier.padding(16.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(16.dp),
                                    strokeWidth = 2.dp
                                )
                                Text(
                                    text = "En train de réfléchir...",
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // Branches Sheet
    if (uiState.showBranchesSheet) {
        ModalBottomSheet(onDismissRequest = viewModel::hideBranchesSheet) {
            BranchesSheetContent(
                branchInfo = uiState.branches,
                onBranchSelect = viewModel::switchBranch
            )
        }
    }

    // Diff Sheet
    if (uiState.showDiffSheet) {
        ModalBottomSheet(onDismissRequest = viewModel::hideDiffSheet) {
            DiffSheetContent(repoDiff = uiState.repoDiff)
        }
    }
}

@Composable
private fun BranchesSheetContent(
    branchInfo: app.m5chat.shared.models.BranchInfo?,
    onBranchSelect: (String) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Text(
            text = stringResource(R.string.branches),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        if (branchInfo == null) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
        } else {
            Text(
                text = "Branche actuelle: ${branchInfo.current}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            branchInfo.branches.forEach { branch ->
                ListItem(
                    headlineContent = { Text(branch) },
                    modifier = Modifier.fillMaxWidth(),
                    trailingContent = if (branch == branchInfo.current) {
                        { Badge { Text("actuelle") } }
                    } else null,
                    colors = ListItemDefaults.colors(
                        containerColor = if (branch == branchInfo.current) {
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                        } else {
                            MaterialTheme.colorScheme.surface
                        }
                    )
                )
                if (branch != branchInfo.current) {
                    TextButton(onClick = { onBranchSelect(branch) }) {
                        Text("Changer")
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun DiffSheetContent(
    repoDiff: app.m5chat.shared.models.RepoDiff?
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Text(
            text = stringResource(R.string.diff),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        if (repoDiff == null) {
            Text(
                text = "Aucune modification",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else {
            Text(
                text = "Status: ${repoDiff.status}",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Text(
                    text = repoDiff.diff.take(2000),
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(12.dp),
                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}
