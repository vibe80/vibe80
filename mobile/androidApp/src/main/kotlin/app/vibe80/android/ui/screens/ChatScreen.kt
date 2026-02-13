package app.vibe80.android.ui.screens

import android.Manifest
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.CompareArrows
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import app.vibe80.android.R
import app.vibe80.android.ui.components.CreateWorktreeSheet
import app.vibe80.android.ui.components.DiffSheetContent
import app.vibe80.android.ui.components.FileSheetContent
import app.vibe80.android.ui.components.LogsSheetContent
import app.vibe80.android.ui.components.MessageBubble
import app.vibe80.android.ui.components.Vibe80FormField
import app.vibe80.android.ui.components.WorktreeMenuSheet
import app.vibe80.android.ui.components.WorktreeTabs
import app.vibe80.android.ui.components.formatFormResponse
import app.vibe80.android.viewmodel.ChatViewModel
import app.vibe80.android.viewmodel.PendingAttachment
import app.vibe80.shared.models.ErrorType
import app.vibe80.shared.models.LLMProvider
import app.vibe80.shared.models.WorktreeStatus
import app.vibe80.shared.models.Worktree
import app.vibe80.shared.network.ConnectionState
import org.koin.androidx.compose.koinViewModel
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    sessionId: String,
    initialWorktreeId: String? = null,
    onDisconnect: () -> Unit,
    viewModel: ChatViewModel = koinViewModel()
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }
    var pendingCameraPhoto by remember { mutableStateOf<CameraPhoto?>(null) }

    LaunchedEffect(Unit) {
        viewModel.workspaceAuthInvalidEvent.collect {
            onDisconnect()
        }
    }

    LaunchedEffect(sessionId, initialWorktreeId) {
        viewModel.ensureSession(sessionId, initialWorktreeId)
    }

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
            val name = getFileName(context, uri) ?: context.getString(R.string.attachment_default_name)
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

    // Camera launcher
    val cameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success ->
        val photo = pendingCameraPhoto
        if (success && photo != null) {
            viewModel.addPendingAttachment(
                PendingAttachment(
                    uri = photo.uri.toString(),
                    name = photo.name,
                    mimeType = "image/jpeg",
                    size = photo.file.length()
                )
            )
        } else {
            photo?.file?.delete()
        }
        pendingCameraPhoto = null
    }

    var showAttachmentMenu by remember { mutableStateOf(false) }
    var pendingCameraLaunch by remember { mutableStateOf(false) }

    val activeWorktree = uiState.activeWorktree
    val effectiveProvider = activeWorktree?.provider ?: uiState.activeProvider
    val codexReady =
        if (effectiveProvider != LLMProvider.CODEX) {
            true
        } else if (activeWorktree == null) {
            uiState.appServerReady
        } else {
            activeWorktree.status == WorktreeStatus.READY
        }

    val cameraPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted && pendingCameraLaunch) {
            pendingCameraLaunch = false
            val photoFile = createTempImageFile(context)
            val photoUri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                photoFile
            )
            pendingCameraPhoto = CameraPhoto(
                uri = photoUri,
                name = photoFile.name,
                file = photoFile
            )
            cameraLauncher.launch(photoUri)
        }
    }

    fun launchCameraWithPermission() {
        val hasPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.CAMERA
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (hasPermission) {
            val photoFile = createTempImageFile(context)
            val photoUri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                photoFile
            )
            pendingCameraPhoto = CameraPhoto(
                uri = photoUri,
                name = photoFile.name,
                file = photoFile
            )
            cameraLauncher.launch(photoUri)
        } else {
            pendingCameraLaunch = true
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
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
            ConnectionState.CONNECTED -> Color(0xFF22C55E)
            else -> Color(0xFFEF4444)
        },
        label = "connectionColor"
    )

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
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
                    val baseWorktrees = uiState.sortedWorktrees
                    val worktreesForTabs = if (baseWorktrees.none { it.id == Worktree.MAIN_WORKTREE_ID }) {
                        listOf(Worktree.createMain(uiState.activeProvider)) + baseWorktrees
                    } else {
                        baseWorktrees
                    }
                    val activeWorktreeName = worktreesForTabs.firstOrNull { it.id == uiState.activeWorktreeId }?.name
                        ?: Worktree.MAIN_WORKTREE_ID
                    val showWorktreeTabs = worktreesForTabs.size > 1
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
                                    text = stringResource(R.string.app_name),
                                    style = MaterialTheme.typography.titleMedium
                                )
                                if (!showWorktreeTabs) {
                                    Surface(
                                        color = MaterialTheme.colorScheme.secondaryContainer,
                                        shape = MaterialTheme.shapes.small
                                    ) {
                                        Text(
                                            text = activeWorktreeName,
                                            style = MaterialTheme.typography.labelSmall,
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
                            Text(
                                text = uiState.repoName.ifBlank { stringResource(R.string.repo_name_placeholder) },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.showCreateWorktreeSheet() }) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = stringResource(R.string.worktree_add)
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
                                contentDescription = stringResource(R.string.diff_title),
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
                            contentDescription = stringResource(R.string.logs_title_simple)
                        )
                    }

                    // Refresh worktrees
                    IconButton(onClick = viewModel::refreshWorktrees) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = stringResource(R.string.worktree_refresh)
                        )
                    }

                    // Disconnect button
                    IconButton(onClick = {
                        viewModel.disconnect()
                        onDisconnect()
                    }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Logout,
                            contentDescription = stringResource(R.string.action_disconnect)
                        )
                    }
                }
            )
        },
    ) { padding ->
        var inputBarSize by remember { mutableStateOf(IntSize.Zero) }
        val density = LocalDensity.current
        val inputBarHeight = with(density) { inputBarSize.height.toDp() }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                // Worktree tabs
                val worktreesForTabs = run {
                    val baseList = uiState.sortedWorktrees
                    if (baseList.none { it.id == Worktree.MAIN_WORKTREE_ID }) {
                        listOf(Worktree.createMain(uiState.activeProvider)) + baseList
                    } else {
                        baseList
                    }
                }
                if (worktreesForTabs.size > 1) {
                    WorktreeTabs(
                        worktrees = worktreesForTabs,
                        activeWorktreeId = uiState.activeWorktreeId,
                        onSelectWorktree = viewModel::selectWorktree,
                        onWorktreeMenu = viewModel::showWorktreeMenu
                    )
                }

                // Messages list
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxSize()
                        .weight(1f),
                    contentPadding = PaddingValues(
                        start = 16.dp,
                        top = 16.dp,
                        end = 16.dp,
                        bottom = 16.dp + inputBarHeight
                    ),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                items(
                    items = uiState.messages,
                    key = { it.id }
                ) { message ->
                    MessageBubble(
                        message = message,
                        sessionId = uiState.sessionId,
                        workspaceToken = uiState.workspaceToken,
                        formsSubmitted = uiState.submittedFormMessageIds.contains(message.id),
                        yesNoSubmitted = uiState.submittedYesNoMessageIds.contains(message.id),
                        onToolResultSelected = { name, output ->
                            viewModel.openToolResult(name, output)
                        },
                        onFileRefSelected = { path ->
                            viewModel.openFileRef(path)
                        },
                        onChoiceSelected = { choice ->
                            viewModel.updateInputText(choice)
                            viewModel.sendMessage()
                        },
                        onYesNoSubmit = {
                            viewModel.markYesNoSubmitted(message.id)
                        },
                        onFormSubmit = { formData, fields ->
                            val formattedResponse = formatFormResponse(formData, fields)
                            if (formattedResponse.isNotBlank()) {
                                viewModel.updateInputText(formattedResponse)
                                viewModel.sendMessage()
                            }
                            viewModel.markFormSubmitted(message.id)
                        }
                    )
                }

                // Streaming message
                uiState.currentStreamingMessage?.let { streamingText ->
                    item(key = "streaming") {
                        MessageBubble(
                            message = null,
                            streamingText = streamingText,
                            isStreaming = true,
                            sessionId = uiState.sessionId,
                            workspaceToken = uiState.workspaceToken
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
                                        text = stringResource(R.string.chat_thinking),
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                }
                            }
                        }
                    }
                }
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .imePadding()
                    .onSizeChanged { inputBarSize = it }
            ) {
                Surface(
                    tonalElevation = 3.dp,
                    shadowElevation = 8.dp
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
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
                            IconButton(
                                onClick = { showAttachmentMenu = true },
                                enabled = uiState.connectionState == ConnectionState.CONNECTED && !uiState.processing && codexReady
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Add,
                                    contentDescription = stringResource(R.string.action_add)
                                )
                            }

                            OutlinedTextField(
                                value = uiState.inputText,
                                onValueChange = viewModel::updateInputText,
                                modifier = Modifier.weight(1f),
                                placeholder = { Text(stringResource(R.string.composer_message_placeholder)) },
                                maxLines = 4,
                                enabled = uiState.connectionState == ConnectionState.CONNECTED &&
                                        !uiState.processing &&
                                        !uiState.uploadingAttachments &&
                                        codexReady
                            )

                            FilledIconButton(
                                onClick = viewModel::sendMessageWithAttachments,
                                enabled = (uiState.inputText.isNotBlank() || uiState.pendingAttachments.isNotEmpty()) &&
                                        uiState.connectionState == ConnectionState.CONNECTED &&
                                        !uiState.processing &&
                                        !uiState.uploadingAttachments &&
                                        codexReady
                            ) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Filled.Send,
                                    contentDescription = stringResource(R.string.action_send)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (showAttachmentMenu) {
        ModalBottomSheet(
            onDismissRequest = { showAttachmentMenu = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = stringResource(R.string.action_add),
                    style = MaterialTheme.typography.titleMedium
                )

                    ListItem(
                        headlineContent = { Text(stringResource(R.string.composer_camera)) },
                        leadingContent = {
                            Icon(imageVector = Icons.Default.PhotoCamera, contentDescription = null)
                        },
                        modifier = Modifier.clickable(
                            enabled = uiState.connectionState == ConnectionState.CONNECTED && !uiState.processing && codexReady
                        ) {
                            showAttachmentMenu = false
                            launchCameraWithPermission()
                        }
                    )

                    ListItem(
                        headlineContent = { Text(stringResource(R.string.composer_photos)) },
                        leadingContent = {
                            Icon(imageVector = Icons.Default.Image, contentDescription = null)
                        },
                        modifier = Modifier.clickable(
                            enabled = uiState.connectionState == ConnectionState.CONNECTED && !uiState.processing && codexReady
                        ) {
                            showAttachmentMenu = false
                            filePickerLauncher.launch(arrayOf("image/*"))
                        }
                    )

                    ListItem(
                        headlineContent = { Text(stringResource(R.string.composer_files)) },
                        leadingContent = {
                            Icon(imageVector = Icons.Default.AttachFile, contentDescription = null)
                        },
                        modifier = Modifier.clickable(
                            enabled = uiState.connectionState == ConnectionState.CONNECTED && !uiState.processing && codexReady
                        ) {
                            showAttachmentMenu = false
                            filePickerLauncher.launch(arrayOf("*/*"))
                        }
                )

                ListItem(
                    headlineContent = { Text(stringResource(R.string.composer_model)) },
                    supportingContent = { Text(stringResource(R.string.composer_model_unavailable)) },
                    leadingContent = {
                        Icon(imageVector = Icons.Default.AutoAwesome, contentDescription = null)
                    },
                    colors = ListItemDefaults.colors(
                        headlineColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        supportingColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        leadingIconColor = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                )
            }
        }
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

    // Logs Sheet
    if (uiState.showLogsSheet) {
        ModalBottomSheet(
            onDismissRequest = viewModel::hideLogsSheet,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ) {
            LogsSheetContent()
        }
    }

    // File Sheet
    if (uiState.showFileSheet) {
        ModalBottomSheet(
            onDismissRequest = viewModel::hideFileSheet,
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ) {
            FileSheetContent(
                path = uiState.fileSheetPath,
                content = uiState.fileSheetContent,
                loading = uiState.fileSheetLoading,
                error = uiState.fileSheetError,
                binary = uiState.fileSheetBinary,
                truncated = uiState.fileSheetTruncated
            )
        }
    }

    // Create Worktree Sheet
    if (uiState.showCreateWorktreeSheet) {
        CreateWorktreeSheet(
            currentProvider = uiState.activeProvider,
            providerModelState = uiState.providerModelState,
            onDismiss = viewModel::hideCreateWorktreeSheet,
            onRequestModels = viewModel::loadProviderModels,
            onCreate = { name, provider, model, reasoningEffort ->
                viewModel.createWorktree(name, provider, null, model, reasoningEffort)
            }
        )
    }

    // Worktree Menu Sheet
    uiState.showWorktreeMenuFor?.let { worktreeId ->
        uiState.worktrees[worktreeId]?.let { worktree ->
            WorktreeMenuSheet(
                worktree = worktree,
                onDismiss = viewModel::hideWorktreeMenu,
                onClose = { viewModel.requestCloseWorktree(worktreeId) }
            )
        }
    }

    // Close Worktree Confirmation Dialog
    uiState.showCloseWorktreeConfirm?.let { worktreeId ->
        uiState.worktrees[worktreeId]?.let { worktree ->
            AlertDialog(
                onDismissRequest = viewModel::cancelCloseWorktree,
                title = { Text(stringResource(R.string.worktree_close)) },
                text = {
                    Text(stringResource(R.string.worktree_close_confirmation, worktree.name))
                },
                confirmButton = {
                    Button(
                        onClick = viewModel::confirmCloseWorktree,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Text(stringResource(R.string.action_close))
                    }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::cancelCloseWorktree) {
                        Text(stringResource(R.string.action_cancel))
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
                    contentDescription = stringResource(R.string.action_remove),
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

private data class CameraPhoto(
    val uri: Uri,
    val name: String,
    val file: File
)

private fun createTempImageFile(context: android.content.Context): File {
    val cameraDir = File(context.cacheDir, "camera")
    if (!cameraDir.exists()) {
        cameraDir.mkdirs()
    }
    val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
    return File.createTempFile("photo_$timestamp", ".jpg", cameraDir)
}
