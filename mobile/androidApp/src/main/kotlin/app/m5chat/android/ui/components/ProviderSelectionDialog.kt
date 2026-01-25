package app.m5chat.android.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import app.m5chat.shared.models.LLMProvider

@Composable
fun ProviderSelectionDialog(
    currentProvider: LLMProvider,
    onProviderSelected: (LLMProvider) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(text = "Choisir un provider")
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                LLMProvider.entries.forEach { provider ->
                    ProviderOption(
                        provider = provider,
                        isSelected = provider == currentProvider,
                        onClick = {
                            onProviderSelected(provider)
                            onDismiss()
                        }
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Annuler")
            }
        }
    )
}

@Composable
private fun ProviderOption(
    provider: LLMProvider,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val containerColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surfaceVariant
        },
        animationSpec = tween(durationMillis = 200),
        label = "containerColor"
    )

    val contentColor by animateColorAsState(
        targetValue = if (isSelected) {
            MaterialTheme.colorScheme.onPrimaryContainer
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
        animationSpec = tween(durationMillis = 200),
        label = "contentColor"
    )

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = containerColor,
            contentColor = contentColor
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = provider.icon,
                contentDescription = null,
                modifier = Modifier.size(24.dp)
            )

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = provider.displayName,
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = provider.description,
                    style = MaterialTheme.typography.bodySmall
                )
            }

            if (isSelected) {
                Icon(
                    imageVector = Icons.Default.Check,
                    contentDescription = "Sélectionné",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

private val LLMProvider.icon: ImageVector
    get() = when (this) {
        LLMProvider.CODEX -> Icons.Default.SmartToy
        LLMProvider.CLAUDE -> Icons.Default.Psychology
    }

private val LLMProvider.displayName: String
    get() = when (this) {
        LLMProvider.CODEX -> "Codex"
        LLMProvider.CLAUDE -> "Claude"
    }

private val LLMProvider.description: String
    get() = when (this) {
        LLMProvider.CODEX -> "OpenAI Codex - Spécialisé code"
        LLMProvider.CLAUDE -> "Anthropic Claude - Polyvalent"
    }
