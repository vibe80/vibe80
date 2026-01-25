package app.m5chat.android.ui.components

import android.widget.TextView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.m5chat.shared.models.ChatMessage
import app.m5chat.shared.models.MessageRole
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin

@Composable
fun MessageBubble(
    message: ChatMessage?,
    streamingText: String? = null,
    isStreaming: Boolean = false
) {
    val isUser = message?.role == MessageRole.USER
    val text = streamingText ?: message?.text ?: ""

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Card(
            modifier = Modifier.widthIn(max = 320.dp),
            colors = CardDefaults.cardColors(
                containerColor = if (isUser) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                }
            ),
            shape = MaterialTheme.shapes.medium
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                // Role indicator for non-user messages
                if (!isUser && message != null) {
                    Text(
                        text = when (message.role) {
                            MessageRole.ASSISTANT -> "Assistant"
                            MessageRole.COMMAND_EXECUTION -> "Commande"
                            MessageRole.TOOL_RESULT -> "Résultat"
                            else -> ""
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(bottom = 4.dp)
                    )
                }

                // Command execution special display
                if (message?.role == MessageRole.COMMAND_EXECUTION) {
                    message.command?.let { cmd ->
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.surface
                            )
                        ) {
                            Text(
                                text = "$ $cmd",
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                                modifier = Modifier.padding(8.dp)
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                    }
                }

                // Message content with Markdown rendering
                if (text.isNotBlank()) {
                    if (isUser) {
                        // Simple text for user messages
                        Text(
                            text = text,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    } else {
                        // Markdown for assistant messages
                        MarkdownText(
                            markdown = text,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }

                // Streaming indicator
                if (isStreaming) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.padding(top = 4.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(12.dp),
                            strokeWidth = 1.5.dp
                        )
                    }
                }

                // Attachments
                message?.attachments?.forEach { attachment ->
                    AssistChip(
                        onClick = { },
                        label = { Text(attachment.name) },
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun MarkdownText(
    markdown: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val markwon = remember {
        Markwon.builder(context)
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(TablePlugin.create(context))
            .build()
    }

    val textColor = MaterialTheme.colorScheme.onSurfaceVariant

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextView(ctx).apply {
                setTextColor(textColor.hashCode())
            }
        },
        update = { textView ->
            markwon.setMarkdown(textView, markdown)
        }
    )
}
