package app.m5chat.android.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.CompareArrows
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.m5chat.android.R
import app.m5chat.android.ui.components.CreateWorktreeSheet
import app.m5chat.android.ui.components.DiffSheetContent
import app.m5chat.android.ui.components.LogsSheetContent
import app.m5chat.android.ui.components.MessageBubble
import app.m5chat.android.ui.components.ProviderSelectionDialog
import app.m5chat.android.ui.components.WorktreeMenuSheet
import app.m5chat.android.ui.components.WorktreeTabs
import app.m5chat.android.viewmodel.ChatViewModel
import app.m5chat.android.viewmodel.PendingAttachment
import app.m5chat.shared.models.ErrorType
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.models.Worktree
import app.m5chat.shared.network.ConnectionState
import org.koin.androidx.compose.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    sessionId: String,
    onDisconnect: () -> Unit,
    viewModel: ChatViewModel = koinViewModel()
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }

    // Show error snackbar when error occurs
    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            val message = when (error.type) {
                ErrorType.WEBSOCKET -> context.getString(R.string.error_websocket)
                ErrorType.NETWORK -> context.getString(R.string.error_network)
                ErrorType.TURN_ERROR -> context.getString(R.string.error_turn)
                ErrorType.UPLOAD -> context.getString(R.string.error_upload_attachment)
                ErrorType.SEND_MESSAGE -> context.getString(R.string.error_send_message)
                ErrorType.PROVIDER_SWITCH -> context.getString(R.string.error_switch_provider)
                ErrorType.BRANCH -> context.getString(R.string.error_load_branches)
                ErrorType.WORKTREE -> context.getString(R.string.error_create_worktree)
                ErrorType.UNKNOWN -> context.getString(R.string.error_unknown)
            }
            val result = snackbarHostState.showSnackbar(
                message = message,
                actionLabel = context.getString(R.string.error_dismiss),
                duration = SnackbarDuration.Long
            )
            if (result == SnackbarResult.ActionPerformed || result == SnackbarResult.Dismissed) {
                viewModel.dismissError()
            }
        }
    }

    // File picker launcher
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris: List<Uri> ->
        uris.forEach { uri ->
            val name = getFileName(context, uri) ?: "attachment"
            val size = getFileSize(context, uri)
            val mimeType = context.contentResolver.getType(uri)
            viewModel.addPendingAttachment(
                PendingAttachment(
                    uri = uri.toString(),
                    name = name,
                    mimeType = mimeType,
                    size = size
                )
            )
        }
    }

    // Auto-scroll to bottom on new messages
    LaunchedEffect(uiState.messages.size, uiState.currentStreamingMessage) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    // Connection status indicator color
    val connectionColor by animateColorAsState(
        targetValue = when (uiState.connectionState) {
            ConnectionState.CONNECTED -> MaterialTheme.colorScheme.primary
            ConnectionState.CONNECTING, ConnectionState.RECONNECTING -> MaterialTheme.colorScheme.tertiary
            ConnectionState.ERROR -> MaterialTheme.colorScheme.error
            ConnectionState.DISCONNECTED -> MaterialTheme.colorScheme.outline
        },
        label = "connectionColor"
    )

    Scaffold(
        snackbarHost = {
            SnackbarHost(hostState = snackbarHostState) { data ->
                Snackbar(
                    snackbarData = data,
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    actionColor = MaterialTheme.colorScheme.error
                )
            }
        },
        topBar = {
            TopAppBar(
                title = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Connection status indicator
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(connectionColor)
                        )
                        Column {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(
                                    text = "M5Chat",
                                    style = MaterialTheme.typography.titleMedium
                                )
                                // Current branch badge
                                uiState.branches?.current?.let { branch ->
                                    Surface(
                                        color = MaterialTheme.colorScheme.secondaryContainer,
                                        shape = MaterialTheme.shapes.small
                                    ) {
                                        Text(
                                            text = branch,
                                            style = MaterialTheme.typography.labelSmall,
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
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
                    }
                },
                actions = {
                    // Provider chip - opens dialog on click
                    AssistChip(
                        onClick = viewModel::showProviderDialog,
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

                    // Diff button with badge for modified files
                    BadgedBox(
                        badge = {
                            if (uiState.hasUncommittedChanges) {
                                Badge {
                                    Text(
                                        text = if (uiState.modifiedFilesCount > 0)
                                            uiState.modifiedFilesCount.toString()
                                        else "!"
                                    )
                                }
                            }
                        }
                    ) {
                        IconButton(onClick = {
                            viewModel.loadDiff()
                            viewModel.showDiffSheet()
                        }) {
                            Icon(
                                imageVector = Icons.Default.CompareArrows,
                                contentDescription = stringResource(R.string.diff),
                                tint = if (uiState.hasUncommittedChanges)
                                    MaterialTheme.colorScheme.primary
                                else
                                    LocalContentColor.current
                            )
                        }
                    }

                    // Logs button (debug)
                    IconButton(onClick = viewModel::showLogsSheet) {
                        Icon(
                            imageVector = Icons.Default.BugReport,
                            contentDescription = "Logs"
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
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .imePadding()
                ) {
                    // Pending attachments preview
                    AnimatedVisibility(
                        visible = uiState.pendingAttachments.isNotEmpty(),
                        enter = slideInVertically { it } + fadeIn(),
                        exit = slideOutVertically { it } + fadeOut()
                    ) {
                        LazyRow(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(uiState.pendingAttachments) { attachment ->
                                AttachmentChip(
                                    attachment = attachment,
                                    onRemove = { viewModel.removePendingAttachment(attachment) }
                                )
                            }
                        }
                    }

                    // Upload progress
                    if (uiState.uploadingAttachments) {
                        LinearProgressIndicator(
                            modifier = Modifier.fillMaxWidth()
                        )
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Attach button
                        IconButton(
                            onClick = {
                                filePickerLauncher.launch(arrayOf("*/*"))
                            },
                            enabled = uiState.connectionState == ConnectionState.CONNECTED && !uiState.processing
                        ) {
                            Icon(
                                imageVector = Icons.Default.AttachFile,
                                contentDescription = "Joindre un fichier"
                            )
                        }

                        OutlinedTextField(
                            value = uiState.inputText,
                            onValueChange = viewModel::updateInputText,
                            modifier = Modifier.weight(1f),
                            placeholder = { Text(stringResource(R.string.message_hint)) },
                            maxLines = 4,
                            enabled = uiState.connectionState == ConnectionState.CONNECTED && !uiState.processing && !uiState.uploadingAttachments
                        )

                        FilledIconButton(
                            onClick = viewModel::sendMessageWithAttachments,
                            enabled = (uiState.inputText.isNotBlank() || uiState.pendingAttachments.isNotEmpty()) &&
                                    uiState.connectionState == ConnectionState.CONNECTED &&
                                    !uiState.processing &&
                                    !uiState.uploadingAttachments
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Send,
                                contentDescription = stringResource(R.string.send_message)
                            )
                        }
                    }
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Worktree tabs
            if (uiState.worktrees.isNotEmpty() || uiState.sortedWorktrees.isNotEmpty()) {
                WorktreeTabs(
                    worktrees = uiState.sortedWorktrees.ifEmpty {
                        // Show at least main worktree
                        listOf(Worktree.createMain(uiState.activeProvider))
                    },
                    activeWorktreeId = uiState.activeWorktreeId,
                    onSelectWorktree = viewModel::selectWorktree,
                    onCreateWorktree = {
                        viewModel.loadBranches()
                        viewModel.showCreateWorktreeSheet()
                    },
                    onWorktreeMenu = viewModel::showWorktreeMenu
                )
            }

            // Messages list
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .weight(1f),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
            items(
                items = uiState.messages,
                key = { it.id }
            ) { message ->
                MessageBubble(
                    message = message,
                    onChoiceSelected = { choice ->
                        viewModel.updateInputText(choice)
                        viewModel.sendMessage()
                    }
                )
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
    }

    // Branches Sheet
    if (uiState.showBranchesSheet) {
        ModalBottomSheet(onDismissRequest = viewModel::hideBranchesSheet) {
            BranchesSheetContent(
                branchInfo = uiState.branches,
                onBranchSelect = viewModel::requestSwitchBranch,
                onFetch = viewModel::fetchBranches,
                isFetching = uiState.fetchingBranches
            )
        }
    }

    // Branch Switch Confirmation Dialog
    if (uiState.showBranchConfirmDialog) {
        AlertDialog(
            onDismissRequest = viewModel::cancelSwitchBranch,
            title = { Text("Changer de branche") },
            text = {
                Text("Voulez-vous changer vers la branche \"${uiState.pendingBranchSwitch}\" ? Les modifications non commit\u00e9es pourraient \u00eatre perdues.")
            },
            confirmButton = {
                Button(onClick = viewModel::confirmSwitchBranch) {
                    Text("Confirmer")
                }
            },
            dismissButton = {
                TextButton(onClick = viewModel::cancelSwitchBranch) {
                    Text("Annuler")
                }
            }
        )
    }

    // Diff Sheet
    if (uiState.showDiffSheet) {
        ModalBottomSheet(
            onDismissRequest = viewModel::hideDiffSheet,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ) {
            DiffSheetContent(repoDiff = uiState.repoDiff)
        }
    }

    // Provider Selection Dialog
    if (uiState.showProviderDialog) {
        ProviderSelectionDialog(
            currentProvider = uiState.activeProvider,
            onProviderSelected = { provider ->
                viewModel.switchProvider(provider)
            },
            onDismiss = viewModel::hideProviderDialog
        )
    }

    // Logs Sheet
    if (uiState.showLogsSheet) {
        ModalBottomSheet(
            onDismissRequest = viewModel::hideLogsSheet,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ) {
            LogsSheetContent()
        }
    }

    // Create Worktree Sheet
    if (uiState.showCreateWorktreeSheet) {
        CreateWorktreeSheet(
            branches = uiState.branches,
            currentProvider = uiState.activeProvider,
            onDismiss = viewModel::hideCreateWorktreeSheet,
            onCreate = { name, provider, branchName ->
                viewModel.createWorktree(name, provider, branchName)
            }
        )
    }

    // Worktree Menu Sheet
    uiState.showWorktreeMenuFor?.let { worktreeId ->
        uiState.worktrees[worktreeId]?.let { worktree ->
            WorktreeMenuSheet(
                worktree = worktree,
                onDismiss = viewModel::hideWorktreeMenu,
                onMerge = { viewModel.mergeWorktree(worktreeId) },
                onClose = { viewModel.requestCloseWorktree(worktreeId) }
            )
        }
    }

    // Close Worktree Confirmation Dialog
    uiState.showCloseWorktreeConfirm?.let { worktreeId ->
        uiState.worktrees[worktreeId]?.let { worktree ->
            AlertDialog(
                onDismissRequest = viewModel::cancelCloseWorktree,
                title = { Text("Fermer le worktree") },
                text = {
                    Text("Voulez-vous fermer le worktree \"${worktree.name}\" ? Les modifications non mergées seront perdues.")
                },
                confirmButton = {
                    Button(
                        onClick = viewModel::confirmCloseWorktree,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Text("Fermer")
                    }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::cancelCloseWorktree) {
                        Text("Annuler")
                    }
                }
            )
        }
    }
}

@Composable
private fun AttachmentChip(
    attachment: PendingAttachment,
    onRemove: () -> Unit
) {
    InputChip(
        selected = false,
        onClick = { },
        label = {
            Text(
                text = attachment.name,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 120.dp)
            )
        },
        leadingIcon = {
            Icon(
                imageVector = if (attachment.mimeType?.startsWith("image/") == true) {
                    Icons.Default.Image
                } else {
                    Icons.Default.InsertDriveFile
                },
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
        },
        trailingIcon = {
            IconButton(
                onClick = onRemove,
                modifier = Modifier.size(18.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Retirer",
                    modifier = Modifier.size(14.dp)
                )
            }
        }
    )
}

private fun getFileName(context: android.content.Context, uri: Uri): String? {
    return context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
        if (cursor.moveToFirst() && nameIndex >= 0) {
            cursor.getString(nameIndex)
        } else null
    }
}

private fun getFileSize(context: android.content.Context, uri: Uri): Long {
    return context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        val sizeIndex = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
        if (cursor.moveToFirst() && sizeIndex >= 0) {
            cursor.getLong(sizeIndex)
        } else 0L
    } ?: 0L
}

@Composable
private fun BranchesSheetContent(
    branchInfo: app.m5chat.shared.models.BranchInfo?,
    onBranchSelect: (String) -> Unit,
    onFetch: () -> Unit,
    isFetching: Boolean
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = stringResource(R.string.branches),
                style = MaterialTheme.typography.titleLarge
            )
            // Fetch button
            FilledTonalButton(
                onClick = onFetch,
                enabled = !isFetching
            ) {
                if (isFetching) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    Icon(
                        imageVector = Icons.Default.Sync,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Text("Fetch")
            }
        }

        if (branchInfo == null) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
        } else {
            Surface(
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = MaterialTheme.shapes.medium,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp)
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Code,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Column {
                        Text(
                            text = "Branche actuelle",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
                        )
                        Text(
                            text = branchInfo.current,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
            }

            Text(
                text = "Branches disponibles",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            branchInfo.branches.forEach { branch ->
                val isCurrent = branch == branchInfo.current
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isCurrent)
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
                        else
                            MaterialTheme.colorScheme.surfaceVariant
                    ),
                    onClick = { if (!isCurrent) onBranchSelect(branch) }
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = branch,
                            style = MaterialTheme.typography.bodyLarge
                        )
                        if (isCurrent) {
                            Badge { Text("actuelle") }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

