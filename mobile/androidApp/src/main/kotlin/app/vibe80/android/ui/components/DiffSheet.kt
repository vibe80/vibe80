package app.vibe80.android.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.vibe80.android.R
import app.vibe80.android.ui.theme.SpaceMono
import app.vibe80.shared.models.RepoDiff

/**
 * Status d'un fichier dans le diff
 */
enum class FileStatus(val label: String, val icon: String, val color: Color) {
    ADDED("A", FaIcons.Plus, Color(0xFF4CAF50)),
    MODIFIED("M", FaIcons.Edit, Color(0xFFFFC107)),
    DELETED("D", FaIcons.Delete, Color(0xFFF44336)),
    RENAMED("R", FaIcons.File, Color(0xFF2196F3)),
    UNKNOWN("?", FaIcons.File, Color.Gray)
}

/**
 * Représente un fichier parsé depuis le diff
 */
data class DiffFile(
    val path: String,
    val oldPath: String? = null,
    val status: FileStatus,
    val additions: Int = 0,
    val deletions: Int = 0,
    val hunks: List<DiffHunk> = emptyList()
)

/**
 * Représente un hunk (bloc de modifications) dans un fichier
 */
data class DiffHunk(
    val header: String,
    val lines: List<DiffLine>
)

/**
 * Représente une ligne du diff
 */
data class DiffLine(
    val content: String,
    val type: LineType,
    val oldLineNumber: Int? = null,
    val newLineNumber: Int? = null
)

enum class LineType {
    CONTEXT,
    ADDITION,
    DELETION,
    HEADER
}

/**
 * Parse le diff brut en structure de données
 */
fun parseDiff(diffText: String): List<DiffFile> {
    if (diffText.isBlank()) return emptyList()

    val files = mutableListOf<DiffFile>()
    val lines = diffText.lines()
    var i = 0

    while (i < lines.size) {
        val line = lines[i]

        // Début d'un nouveau fichier
        if (line.startsWith("diff --git")) {
            val filePaths = parseFilePaths(line)
            var status = FileStatus.MODIFIED
            var oldPath: String? = null
            val hunks = mutableListOf<DiffHunk>()
            var additions = 0
            var deletions = 0

            i++

            // Parse les métadonnées du fichier
            while (i < lines.size && !lines[i].startsWith("diff --git")) {
                val metaLine = lines[i]

                when {
                    metaLine.startsWith("new file mode") -> status = FileStatus.ADDED
                    metaLine.startsWith("deleted file mode") -> status = FileStatus.DELETED
                    metaLine.startsWith("rename from") -> {
                        status = FileStatus.RENAMED
                        oldPath = metaLine.removePrefix("rename from ")
                    }
                    metaLine.startsWith("@@") -> {
                        // Début d'un hunk
                        val hunkLines = mutableListOf<DiffLine>()
                        val hunkHeader = metaLine
                        val (oldStart, newStart) = parseHunkHeader(metaLine)
                        var oldLineNum = oldStart
                        var newLineNum = newStart

                        hunkLines.add(DiffLine(metaLine, LineType.HEADER))
                        i++

                        // Parse les lignes du hunk
                        while (i < lines.size &&
                               !lines[i].startsWith("@@") &&
                               !lines[i].startsWith("diff --git")) {
                            val hunkLine = lines[i]
                            when {
                                hunkLine.startsWith("+") && !hunkLine.startsWith("+++") -> {
                                    hunkLines.add(DiffLine(hunkLine, LineType.ADDITION, null, newLineNum))
                                    newLineNum++
                                    additions++
                                }
                                hunkLine.startsWith("-") && !hunkLine.startsWith("---") -> {
                                    hunkLines.add(DiffLine(hunkLine, LineType.DELETION, oldLineNum, null))
                                    oldLineNum++
                                    deletions++
                                }
                                hunkLine.startsWith(" ") || hunkLine.isEmpty() -> {
                                    hunkLines.add(DiffLine(hunkLine, LineType.CONTEXT, oldLineNum, newLineNum))
                                    oldLineNum++
                                    newLineNum++
                                }
                                else -> {
                                    // Ligne de métadonnées (---, +++ ou autre)
                                    hunkLines.add(DiffLine(hunkLine, LineType.HEADER))
                                }
                            }
                            i++
                        }

                        hunks.add(DiffHunk(hunkHeader, hunkLines))
                        continue // Ne pas incrémenter i car on l'a déjà fait
                    }
                }
                i++
            }

            files.add(DiffFile(
                path = filePaths.second ?: filePaths.first,
                oldPath = oldPath,
                status = status,
                additions = additions,
                deletions = deletions,
                hunks = hunks
            ))
        } else {
            i++
        }
    }

    return files
}

private fun parseFilePaths(diffLine: String): Pair<String, String?> {
    // diff --git a/path/to/file b/path/to/file
    val regex = Regex("""diff --git a/(.+) b/(.+)""")
    val match = regex.find(diffLine)
    return if (match != null) {
        Pair(match.groupValues[1], match.groupValues[2])
    } else {
        Pair(diffLine, null)
    }
}

private fun parseHunkHeader(header: String): Pair<Int, Int> {
    // @@ -oldStart,oldCount +newStart,newCount @@
    val regex = Regex("""@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@.*""")
    val match = regex.find(header)
    return if (match != null) {
        Pair(match.groupValues[1].toInt(), match.groupValues[2].toInt())
    } else {
        Pair(1, 1)
    }
}

/**
 * Composant principal pour afficher le diff
 */
@Composable
fun DiffSheetContent(
    repoDiff: RepoDiff?,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
    ) {
        Text(
            text = stringResource(R.string.diff_title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        if (repoDiff == null || repoDiff.diff.isBlank()) {
            EmptyDiffState()
        } else {
            val files = remember(repoDiff.diff) { parseDiff(repoDiff.diff) }

            if (files.isEmpty()) {
                EmptyDiffState()
            } else {
                DiffSummary(files = files)
                Spacer(modifier = Modifier.height(16.dp))
                DiffFilesList(files = files)
            }
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun EmptyDiffState() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            FaIcon(
                icon = FaIcons.File,
                contentDescription = null,
                modifier = Modifier.size(48.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.diff_empty_title),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun DiffSummary(files: List<DiffFile>) {
    val totalAdditions = files.sumOf { it.additions }
    val totalDeletions = files.sumOf { it.deletions }

    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            SummaryItem(
                label = stringResource(R.string.diff_files_label),
                value = files.size.toString(),
                color = MaterialTheme.colorScheme.primary
            )
            SummaryItem(
                label = stringResource(R.string.diff_additions),
                value = "+$totalAdditions",
                color = Color(0xFF4CAF50)
            )
            SummaryItem(
                label = stringResource(R.string.diff_deletions),
                value = "-$totalDeletions",
                color = Color(0xFFF44336)
            )
        }
    }
}

@Composable
private fun SummaryItem(
    label: String,
    value: String,
    color: Color
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = color
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun DiffFilesList(files: List<DiffFile>) {
    LazyColumn(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(files) { file ->
            DiffFileCard(file = file)
        }
    }
}

@Composable
private fun DiffFileCard(file: DiffFile) {
    var expanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column {
            // En-tête du fichier (cliquable pour expand/collapse)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { expanded = !expanded }
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Badge status
                Surface(
                    color = file.status.color,
                    shape = MaterialTheme.shapes.small
                ) {
                    Text(
                        text = file.status.label,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        fontWeight = FontWeight.Bold
                    )
                }

                // Nom du fichier
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = file.path,
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = SpaceMono
                    )
                    if (file.oldPath != null && file.oldPath != file.path) {
                        Text(
                            text = "← ${file.oldPath}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontFamily = SpaceMono
                        )
                    }
                }

                // Stats +/-
                if (file.additions > 0 || file.deletions > 0) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (file.additions > 0) {
                            Text(
                                text = "+${file.additions}",
                                style = MaterialTheme.typography.labelMedium,
                                color = Color(0xFF4CAF50)
                            )
                        }
                        if (file.deletions > 0) {
                            Text(
                                text = "-${file.deletions}",
                                style = MaterialTheme.typography.labelMedium,
                                color = Color(0xFFF44336)
                            )
                        }
                    }
                }

                // Icône expand/collapse
                FaIcon(
                    icon = if (expanded) FaIcons.ChevronUp else FaIcons.ChevronDown,
                    contentDescription = stringResource(
                        if (expanded) R.string.action_collapse else R.string.action_expand
                    ),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Contenu du diff (expandable)
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                DiffContent(file = file)
            }
        }
    }
}

@Composable
private fun DiffContent(file: DiffFile) {
    val horizontalScrollState = rememberScrollState()

    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(horizontalScrollState)
                .padding(8.dp)
        ) {
            file.hunks.forEach { hunk ->
                hunk.lines.forEach { line ->
                    DiffLineRow(line = line)
                }
            }
        }
    }
}

@Composable
private fun DiffLineRow(line: DiffLine) {
    val backgroundColor = when (line.type) {
        LineType.ADDITION -> Color(0xFF4CAF50).copy(alpha = 0.2f)
        LineType.DELETION -> Color(0xFFF44336).copy(alpha = 0.2f)
        LineType.HEADER -> MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
        LineType.CONTEXT -> Color.Transparent
    }

    val textColor = when (line.type) {
        LineType.ADDITION -> Color(0xFF2E7D32)
        LineType.DELETION -> Color(0xFFC62828)
        LineType.HEADER -> MaterialTheme.colorScheme.primary
        LineType.CONTEXT -> MaterialTheme.colorScheme.onSurface
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(backgroundColor)
            .padding(vertical = 1.dp)
    ) {
        // Numéros de ligne
        if (line.type != LineType.HEADER) {
            Text(
                text = (line.oldLineNumber?.toString() ?: "").padStart(4),
                style = MaterialTheme.typography.bodySmall,
                fontFamily = SpaceMono,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                modifier = Modifier.width(36.dp)
            )
            Text(
                text = (line.newLineNumber?.toString() ?: "").padStart(4),
                style = MaterialTheme.typography.bodySmall,
                fontFamily = SpaceMono,
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                modifier = Modifier.width(36.dp)
            )
        } else {
            Spacer(modifier = Modifier.width(72.dp))
        }

        // Contenu de la ligne
        Text(
            text = line.content,
            style = MaterialTheme.typography.bodySmall,
            fontFamily = SpaceMono,
            fontSize = 11.sp,
            color = textColor,
            modifier = Modifier.padding(start = 8.dp)
        )
    }
}
