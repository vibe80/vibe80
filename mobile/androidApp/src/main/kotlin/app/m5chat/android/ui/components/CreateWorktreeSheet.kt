package app.m5chat.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.m5chat.shared.models.BranchInfo
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.models.Worktree

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateWorktreeSheet(
    branches: BranchInfo?,
    currentProvider: LLMProvider,
    onDismiss: () -> Unit,
    onCreate: (name: String, provider: LLMProvider, branchName: String?) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var selectedProvider by remember { mutableStateOf(currentProvider) }
    var selectedBranch by remember { mutableStateOf<String?>(null) }
    var selectedColor by remember { mutableStateOf(Worktree.COLORS.first()) }

    val isValid = name.isNotBlank() && name.length >= 2

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = "Nouveau Worktree",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 24.dp)
            )

            // Name input
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(32) },
                label = { Text("Nom du worktree") },
                placeholder = { Text("ex: feature-auth") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                supportingText = {
                    Text("${name.length}/32 caractères")
                }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Provider selection
            Text(
                text = "Provider",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                LLMProvider.entries.forEach { provider ->
                    FilterChip(
                        selected = selectedProvider == provider,
                        onClick = { selectedProvider = provider },
                        label = { Text(provider.name) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Color selection
            Text(
                text = "Couleur",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
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

            Spacer(modifier = Modifier.height(16.dp))

            // Branch selection (optional)
            Text(
                text = "Branche source (optionnel)",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            if (branches != null) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item {
                        FilterChip(
                            selected = selectedBranch == null,
                            onClick = { selectedBranch = null },
                            label = { Text("Branche courante") }
                        )
                    }
                    items(branches.branches.take(10)) { branch ->
                        FilterChip(
                            selected = selectedBranch == branch,
                            onClick = { selectedBranch = branch },
                            label = { Text(branch) }
                        )
                    }
                }
            } else {
                Text(
                    text = "Chargement des branches...",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Create button
            Button(
                onClick = { onCreate(name, selectedProvider, selectedBranch) },
                enabled = isValid,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Créer le worktree")
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
