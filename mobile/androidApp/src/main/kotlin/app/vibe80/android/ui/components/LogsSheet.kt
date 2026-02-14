package app.vibe80.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Api
import androidx.compose.material.icons.filled.Cable
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.stringResource
import app.vibe80.android.R
import app.vibe80.android.ui.theme.SpaceMono
import app.vibe80.shared.logging.AppLogger
import app.vibe80.shared.logging.LogEntry
import app.vibe80.shared.logging.LogLevel
import app.vibe80.shared.logging.LogSource
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LogsSheetContent(
    modifier: Modifier = Modifier
) {
    val logs by AppLogger.logs.collectAsState()
    var selectedSource by remember { mutableStateOf<LogSource?>(null) }

    val filteredLogs = remember(logs, selectedSource) {
        if (selectedSource == null) logs else logs.filter { it.source == selectedSource }
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .fillMaxHeight(0.9f)
            .padding(horizontal = 16.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = stringResource(R.string.logs_title, filteredLogs.size),
                style = MaterialTheme.typography.titleLarge
            )
            IconButton(onClick = { AppLogger.clear() }) {
                Icon(
                    imageVector = Icons.Default.Clear,
                    contentDescription = stringResource(R.string.logs_clear)
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Filter chips
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            FilterChip(
                selected = selectedSource == null,
                onClick = { selectedSource = null },
                label = { Text(stringResource(R.string.logs_filter_all)) }
            )
            FilterChip(
                selected = selectedSource == LogSource.API,
                onClick = { selectedSource = if (selectedSource == LogSource.API) null else LogSource.API },
                label = { Text(stringResource(R.string.logs_filter_api)) },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Api,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )
            FilterChip(
                selected = selectedSource == LogSource.WEBSOCKET,
                onClick = { selectedSource = if (selectedSource == LogSource.WEBSOCKET) null else LogSource.WEBSOCKET },
                label = { Text(stringResource(R.string.logs_filter_websocket)) },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Cable,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )
            FilterChip(
                selected = selectedSource == LogSource.APP,
                onClick = { selectedSource = if (selectedSource == LogSource.APP) null else LogSource.APP },
                label = { Text(stringResource(R.string.logs_filter_app)) },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Phone,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                }
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Logs list
        if (filteredLogs.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = stringResource(R.string.logs_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(filteredLogs, key = { it.id }) { log ->
                    LogEntryCard(log = log)
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun LogEntryCard(log: LogEntry) {
    val backgroundColor = when (log.level) {
        LogLevel.ERROR -> MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
        LogLevel.WARNING -> Color(0xFFFFF3E0)
        LogLevel.INFO -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
        LogLevel.DEBUG -> MaterialTheme.colorScheme.surface
    }

    val levelColor = when (log.level) {
        LogLevel.ERROR -> MaterialTheme.colorScheme.error
        LogLevel.WARNING -> Color(0xFFFF9800)
        LogLevel.INFO -> MaterialTheme.colorScheme.primary
        LogLevel.DEBUG -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    val sourceIcon = when (log.source) {
        LogSource.API -> Icons.Default.Api
        LogSource.WEBSOCKET -> Icons.Default.Cable
        LogSource.APP -> Icons.Default.Phone
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = backgroundColor),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp)
        ) {
            // Header row: time, source, level
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Timestamp
                Text(
                    text = formatTimestamp(log.timestamp),
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = SpaceMono,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Source icon
                Icon(
                    imageVector = sourceIcon,
                    contentDescription = log.source.name,
                    modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )

                // Level badge
                Surface(
                    color = levelColor.copy(alpha = 0.2f),
                    shape = MaterialTheme.shapes.extraSmall
                ) {
                    Text(
                        text = log.level.name,
                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = levelColor,
                        fontSize = 9.sp
                    )
                }
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Message
            SelectionContainer {
                Text(
                    text = log.message,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = SpaceMono,
                    fontSize = 11.sp
                )
            }

            // Details (expandable/scrollable)
            log.details?.let { details ->
                Spacer(modifier = Modifier.height(4.dp))
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    shape = MaterialTheme.shapes.small
                ) {
                    SelectionContainer {
                        Text(
                            text = details,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = SpaceMono,
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState())
                                .padding(8.dp)
                        )
                    }
                }
            }
        }
    }
}

private fun formatTimestamp(timestamp: Long): String {
    val sdf = SimpleDateFormat("HH:mm:ss.SSS", Locale.getDefault())
    return sdf.format(Date(timestamp))
}
