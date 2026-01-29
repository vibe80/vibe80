package app.m5chat.android.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.m5chat.shared.models.Worktree
import app.m5chat.shared.models.WorktreeStatus

@Composable
fun WorktreeTabs(
    worktrees: List<Worktree>,
    activeWorktreeId: String,
    onSelectWorktree: (String) -> Unit,
    onWorktreeMenu: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color.Transparent,
        tonalElevation = 0.dp
    ) {
        Row(
            modifier = Modifier
                .horizontalScroll(scrollState)
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Worktree tabs
            worktrees.forEach { worktree ->
                WorktreeTab(
                    worktree = worktree,
                    isActive = worktree.id == activeWorktreeId,
                    onClick = { onSelectWorktree(worktree.id) },
                    onLongClick = { onWorktreeMenu(worktree.id) }
                )
            }

        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WorktreeTab(
    worktree: Worktree,
    isActive: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit
) {
    val backgroundColor by animateColorAsState(
        targetValue = if (isActive) {
            MaterialTheme.colorScheme.primaryContainer
        } else {
            MaterialTheme.colorScheme.surface
        },
        label = "tabBgColor"
    )

    val elevation by animateDpAsState(
        targetValue = if (isActive) 4.dp else 0.dp,
        label = "tabElevation"
    )

    val worktreeColor = try {
        Color(android.graphics.Color.parseColor(worktree.color))
    } catch (e: Exception) {
        MaterialTheme.colorScheme.primary
    }

    Surface(
        modifier = Modifier
            .height(36.dp),
        shape = RoundedCornerShape(18.dp),
        color = backgroundColor,
        tonalElevation = elevation,
        onClick = onClick
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // Color indicator
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(worktreeColor)
            )

            // Name
            Text(
                text = worktree.name,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                color = if (isActive) {
                    MaterialTheme.colorScheme.onPrimaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurface
                }
            )

            // Status indicator
            WorktreeStatusIndicator(
                status = worktree.status,
                isMain = worktree.id == Worktree.MAIN_WORKTREE_ID
            )

            // Menu button for non-main worktrees
            if (worktree.id != Worktree.MAIN_WORKTREE_ID) {
                Icon(
                    imageVector = Icons.Default.MoreVert,
                    contentDescription = "Menu",
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { onLongClick() },
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun WorktreeStatusIndicator(
    status: WorktreeStatus,
    isMain: Boolean
) {
    when (status) {
        WorktreeStatus.CREATING -> {
            CircularProgressIndicator(
                modifier = Modifier.size(12.dp),
                strokeWidth = 1.5.dp
            )
        }
        WorktreeStatus.PROCESSING -> {
            CircularProgressIndicator(
                modifier = Modifier.size(12.dp),
                strokeWidth = 1.5.dp,
                color = MaterialTheme.colorScheme.tertiary
            )
        }
        WorktreeStatus.MERGING -> {
            CircularProgressIndicator(
                modifier = Modifier.size(12.dp),
                strokeWidth = 1.5.dp,
                color = MaterialTheme.colorScheme.secondary
            )
        }
        WorktreeStatus.MERGE_CONFLICT -> {
            Badge(
                containerColor = MaterialTheme.colorScheme.error
            ) {
                Text("!", style = MaterialTheme.typography.labelSmall)
            }
        }
        WorktreeStatus.ERROR -> {
            Badge(
                containerColor = MaterialTheme.colorScheme.error
            ) {
                Text("!", style = MaterialTheme.typography.labelSmall)
            }
        }
        WorktreeStatus.COMPLETED -> {
            if (!isMain) {
                Badge(
                    containerColor = MaterialTheme.colorScheme.tertiary
                ) {
                    Text("done", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        WorktreeStatus.READY -> {
            // No indicator for ready state
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun WorktreeMenuSheet(
    worktree: Worktree,
    onDismiss: () -> Unit,
    onMerge: () -> Unit,
    onClose: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = "Worktree: ${worktree.name}",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 16.dp)
            )

            // Status info
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.small
                ) {
                    Text(
                        text = worktree.branchName,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
                Surface(
                    color = MaterialTheme.colorScheme.tertiaryContainer,
                    shape = MaterialTheme.shapes.small
                ) {
                    Text(
                        text = worktree.provider.name,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    )
                }
            }

            // Merge button
            if (worktree.status == WorktreeStatus.READY || worktree.status == WorktreeStatus.COMPLETED) {
                FilledTonalButton(
                    onClick = onMerge,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Merge vers main")
                }

                Spacer(modifier = Modifier.height(8.dp))
            }

            // Close button
            OutlinedButton(
                onClick = onClose,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Fermer le worktree")
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
