package app.vibe80.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.vibe80.android.R
import app.vibe80.shared.models.LLMProvider
import app.vibe80.shared.models.ProviderModelState
import app.vibe80.shared.models.Worktree

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateWorktreeSheet(
    currentProvider: LLMProvider,
    worktrees: List<Worktree>,
    providerModelState: Map<String, ProviderModelState>,
    onDismiss: () -> Unit,
    onRequestModels: (provider: String) -> Unit,
    onCreate: (
        name: String?,
        provider: LLMProvider,
        branchName: String?,
        model: String?,
        reasoningEffort: String?,
        context: String,
        sourceWorktree: String?,
        internetAccess: Boolean,
        denyGitCredentialsAccess: Boolean
    ) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var selectedProvider by remember { mutableStateOf(currentProvider) }
    var selectedColor by remember { mutableStateOf(Worktree.COLORS.first()) }
    var selectedContext by remember { mutableStateOf("new") }
    var sourceWorktreeId by remember { mutableStateOf(Worktree.MAIN_WORKTREE_ID) }
    var startingBranch by remember { mutableStateOf("main") }
    var selectedModel by remember { mutableStateOf<String?>(null) }
    var selectedReasoningEffort by remember { mutableStateOf<String?>(null) }
    var internetAccess by remember { mutableStateOf(true) }
    var denyGitCredentialsAccess by remember { mutableStateOf(true) }

    val currentModelState = providerModelState[selectedProvider.name.lowercase()] ?: ProviderModelState()
    val availableModels = currentModelState.models
    val defaultModel = remember(availableModels) { availableModels.find { it.isDefault } }
    val selectedModelDetails = remember(availableModels, selectedModel) {
        availableModels.find { it.model == selectedModel }
    }

    LaunchedEffect(worktrees) {
        if (worktrees.none { it.id == sourceWorktreeId }) {
            sourceWorktreeId = worktrees.find { it.id == Worktree.MAIN_WORKTREE_ID }?.id
                ?: worktrees.firstOrNull()?.id
                ?: Worktree.MAIN_WORKTREE_ID
        }
    }

    LaunchedEffect(selectedProvider, selectedContext) {
        if (selectedContext == "new" && selectedProvider == LLMProvider.CODEX) {
            val state = providerModelState[selectedProvider.name.lowercase()]
            if (state == null || (state.models.isEmpty() && !state.loading)) {
                onRequestModels(selectedProvider.name.lowercase())
            }
        } else {
            selectedModel = null
            selectedReasoningEffort = null
        }
    }

    LaunchedEffect(availableModels, defaultModel) {
        if (selectedProvider == LLMProvider.CODEX && selectedModel == null && defaultModel != null) {
            selectedModel = defaultModel.model
            if (selectedReasoningEffort == null && defaultModel.defaultReasoningEffort != null) {
                selectedReasoningEffort = defaultModel.defaultReasoningEffort
            }
        }
    }

    LaunchedEffect(selectedModelDetails) {
        if (selectedModelDetails != null) {
            val supportedEfforts = selectedModelDetails.supportedReasoningEfforts
            if (supportedEfforts.isEmpty()) {
                selectedReasoningEffort = null
            } else if (
                selectedReasoningEffort != null &&
                supportedEfforts.none { it.reasoningEffort == selectedReasoningEffort }
            ) {
                selectedReasoningEffort = null
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            Text(
                text = stringResource(R.string.worktree_new_title),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 24.dp)
            )

            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(32) },
                label = { Text(stringResource(R.string.worktree_name_optional_label)) },
                placeholder = { Text(stringResource(R.string.worktree_name_placeholder_example)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                supportingText = {
                    Text(stringResource(R.string.worktree_name_count, name.length))
                }
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = startingBranch,
                onValueChange = { startingBranch = it },
                label = { Text(stringResource(R.string.worktree_source_branch_label)) },
                placeholder = { Text("main") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = stringResource(R.string.worktree_context_label),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = selectedContext == "new",
                    onClick = { selectedContext = "new" },
                    label = { Text(stringResource(R.string.worktree_context_new)) }
                )
                FilterChip(
                    selected = selectedContext == "fork",
                    onClick = { selectedContext = "fork" },
                    label = { Text(stringResource(R.string.worktree_context_fork)) }
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (selectedContext == "new") {
                Text(
                    text = stringResource(R.string.provider_label),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LLMProvider.entries.forEach { provider ->
                        FilterChip(
                            selected = selectedProvider == provider,
                            onClick = { selectedProvider = provider },
                            label = { Text(provider.name) }
                        )
                    }
                }

                if (selectedProvider == LLMProvider.CODEX) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = stringResource(R.string.model_label),
                            style = MaterialTheme.typography.labelLarge
                        )
                        if (!currentModelState.loading) {
                            IconButton(
                                onClick = { onRequestModels(selectedProvider.name.lowercase()) },
                                modifier = Modifier.size(24.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Refresh,
                                    contentDescription = stringResource(R.string.model_refresh),
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    if (currentModelState.loading) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp
                            )
                            Text(
                                text = stringResource(R.string.model_loading),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    } else if (currentModelState.error != null) {
                        Text(
                            text = currentModelState.error ?: "",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    } else if (availableModels.isNotEmpty()) {
                        var modelExpanded by remember { mutableStateOf(false) }

                        ExposedDropdownMenuBox(
                            expanded = modelExpanded,
                            onExpandedChange = { modelExpanded = it }
                        ) {
                            OutlinedTextField(
                                value = selectedModelDetails?.displayName
                                    ?: selectedModelDetails?.model
                                    ?: stringResource(R.string.model_default),
                                onValueChange = {},
                                readOnly = true,
                                trailingIcon = {
                                    ExposedDropdownMenuDefaults.TrailingIcon(expanded = modelExpanded)
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .menuAnchor()
                            )
                            ExposedDropdownMenu(
                                expanded = modelExpanded,
                                onDismissRequest = { modelExpanded = false }
                            ) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.model_default)) },
                                    onClick = {
                                        selectedModel = null
                                        modelExpanded = false
                                    }
                                )
                                availableModels.forEach { model ->
                                    DropdownMenuItem(
                                        text = { Text(model.displayName ?: model.model) },
                                        onClick = {
                                            selectedModel = model.model
                                            modelExpanded = false
                                        }
                                    )
                                }
                            }
                        }
                    }

                    val supportedEfforts = selectedModelDetails?.supportedReasoningEfforts ?: emptyList()
                    if (supportedEfforts.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(16.dp))

                        Text(
                            text = stringResource(R.string.reasoning_label),
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )

                        var effortExpanded by remember { mutableStateOf(false) }

                        ExposedDropdownMenuBox(
                            expanded = effortExpanded,
                            onExpandedChange = { effortExpanded = it }
                        ) {
                            OutlinedTextField(
                                value = selectedReasoningEffort ?: stringResource(R.string.reasoning_default),
                                onValueChange = {},
                                readOnly = true,
                                trailingIcon = {
                                    ExposedDropdownMenuDefaults.TrailingIcon(expanded = effortExpanded)
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .menuAnchor()
                            )
                            ExposedDropdownMenu(
                                expanded = effortExpanded,
                                onDismissRequest = { effortExpanded = false }
                            ) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.reasoning_default)) },
                                    onClick = {
                                        selectedReasoningEffort = null
                                        effortExpanded = false
                                    }
                                )
                                supportedEfforts.forEach { effort ->
                                    DropdownMenuItem(
                                        text = { Text(effort.reasoningEffort) },
                                        onClick = {
                                            selectedReasoningEffort = effort.reasoningEffort
                                            effortExpanded = false
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                Text(
                    text = stringResource(R.string.worktree_source_worktree_label),
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(bottom = 8.dp)
                )

                var sourceExpanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(
                    expanded = sourceExpanded,
                    onExpandedChange = { sourceExpanded = it }
                ) {
                    OutlinedTextField(
                        value = worktrees.firstOrNull { it.id == sourceWorktreeId }?.name ?: sourceWorktreeId,
                        onValueChange = {},
                        readOnly = true,
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = sourceExpanded)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = sourceExpanded,
                        onDismissRequest = { sourceExpanded = false }
                    ) {
                        worktrees.forEach { wt ->
                            DropdownMenuItem(
                                text = { Text(if (wt.id == Worktree.MAIN_WORKTREE_ID) "main" else wt.name) },
                                onClick = {
                                    sourceWorktreeId = wt.id
                                    sourceExpanded = false
                                }
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = stringResource(R.string.worktree_internet_access_label))
                Switch(
                    checked = internetAccess,
                    onCheckedChange = {
                        internetAccess = it
                        if (!it) denyGitCredentialsAccess = false
                    }
                )
            }

            if (internetAccess) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(text = stringResource(R.string.worktree_deny_git_credentials_label))
                    Switch(
                        checked = denyGitCredentialsAccess,
                        onCheckedChange = { denyGitCredentialsAccess = it }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = stringResource(R.string.worktree_color_label),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(Worktree.COLORS) { color ->
                    val colorValue = try {
                        Color(android.graphics.Color.parseColor(color))
                    } catch (e: Exception) {
                        MaterialTheme.colorScheme.primary
                    }

                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(colorValue)
                            .clickable { selectedColor = color },
                        contentAlignment = Alignment.Center
                    ) {
                        if (selectedColor == color) {
                            Box(
                                modifier = Modifier
                                    .size(16.dp)
                                    .clip(CircleShape)
                                    .background(Color.White)
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = {
                    onCreate(
                        name.trim().ifEmpty { null },
                        selectedProvider,
                        startingBranch.trim().ifEmpty { null },
                        if (selectedContext == "new" && selectedProvider == LLMProvider.CODEX) selectedModel else null,
                        if (selectedContext == "new" && selectedProvider == LLMProvider.CODEX) selectedReasoningEffort else null,
                        selectedContext,
                        if (selectedContext == "fork") sourceWorktreeId else null,
                        internetAccess,
                        denyGitCredentialsAccess
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = startingBranch.trim().isNotEmpty() && (selectedContext == "new" || sourceWorktreeId.isNotBlank())
            ) {
                Text(stringResource(R.string.action_create))
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
