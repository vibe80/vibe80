package app.m5chat.android.ui.components

import android.graphics.Typeface
import android.text.method.LinkMovementMethod
import android.widget.TextView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.m5chat.shared.models.Attachment
import app.m5chat.shared.models.ChatMessage
import app.m5chat.shared.models.MessageRole
import coil.compose.AsyncImage
import coil.request.ImageRequest
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.Markwon
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.linkify.LinkifyPlugin

@Composable
fun MessageBubble(
    message: ChatMessage?,
    streamingText: String? = null,
    isStreaming: Boolean = false,
    onChoiceSelected: ((String) -> Unit)? = null
) {
    val isUser = message?.role == MessageRole.USER
    val rawText = streamingText ?: message?.text ?: ""

    // Parse vibecoder:choices blocks for assistant messages
    val choicesBlocks = remember(rawText, isUser) {
        if (!isUser && !isStreaming) parseVibecoderChoices(rawText) else emptyList()
    }
    val text = remember(rawText, choicesBlocks) {
        if (choicesBlocks.isNotEmpty()) removeVibecoderChoices(rawText) else rawText
    }

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

                // Vibecoder choices buttons
                if (choicesBlocks.isNotEmpty() && onChoiceSelected != null) {
                    Spacer(modifier = Modifier.height(12.dp))
                    choicesBlocks.forEach { block ->
                        VibecoderChoicesView(
                            block = block,
                            onOptionSelected = onChoiceSelected,
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
                if (!message?.attachments.isNullOrEmpty()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        message?.attachments?.forEach { attachment ->
                            AttachmentItem(
                                attachment = attachment,
                                isUser = isUser
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AttachmentItem(
    attachment: Attachment,
    isUser: Boolean
) {
    val isImage = attachment.mimeType?.startsWith("image/") == true ||
            attachment.name.lowercase().let {
                it.endsWith(".png") || it.endsWith(".jpg") ||
                        it.endsWith(".jpeg") || it.endsWith(".gif") ||
                        it.endsWith(".webp")
            }

    if (isImage) {
        // Image preview
        AsyncImage(
            model = ImageRequest.Builder(LocalContext.current)
                .data(attachment.path)
                .crossfade(true)
                .build(),
            contentDescription = attachment.name,
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 200.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surface)
        )
        Text(
            text = attachment.name,
            style = MaterialTheme.typography.labelSmall,
            color = if (isUser) {
                MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    } else {
        // File attachment chip
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(
                containerColor = if (isUser) {
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
                } else {
                    MaterialTheme.colorScheme.surface
                }
            )
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Description,
                    contentDescription = null,
                    modifier = Modifier.size(24.dp),
                    tint = if (isUser) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.primary
                    }
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = attachment.name,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    attachment.size?.let { size ->
                        Text(
                            text = formatFileSize(size),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                        )
                    }
                }
            }
        }
    }
}

private fun formatFileSize(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
        else -> "${bytes / (1024 * 1024 * 1024)} GB"
    }
}

@Composable
fun MarkdownText(
    markdown: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant
    val linkColor = MaterialTheme.colorScheme.primary
    val codeBackgroundColor = MaterialTheme.colorScheme.surface
    val codeTextColor = MaterialTheme.colorScheme.onSurface

    val markwon = remember(textColor, linkColor, codeBackgroundColor) {
        Markwon.builder(context)
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(TablePlugin.create(context))
            .usePlugin(LinkifyPlugin.create())
            .usePlugin(object : AbstractMarkwonPlugin() {
                override fun configureTheme(builder: MarkwonTheme.Builder) {
                    builder
                        .codeTextColor(codeTextColor.toArgb())
                        .codeBackgroundColor(codeBackgroundColor.toArgb())
                        .codeBlockTextColor(codeTextColor.toArgb())
                        .codeBlockBackgroundColor(codeBackgroundColor.toArgb())
                        .codeTypeface(Typeface.MONOSPACE)
                        .codeBlockTypeface(Typeface.MONOSPACE)
                        .codeTextSize(14)
                        .codeBlockTextSize(13)
                        .codeBlockMargin(16)
                        .linkColor(linkColor.toArgb())
                        .isLinkUnderlined(true)
                        .headingBreakHeight(0)
                }
            })
            .build()
    }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextView(ctx).apply {
                setTextColor(textColor.toArgb())
                setLinkTextColor(linkColor.toArgb())
                movementMethod = LinkMovementMethod.getInstance()
                textSize = 14f
            }
        },
        update = { textView ->
            markwon.setMarkdown(textView, markdown)
        }
    )
}
