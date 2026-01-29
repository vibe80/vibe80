package app.m5chat.android.ui.components

import android.graphics.Typeface
import android.net.Uri
import android.text.method.LinkMovementMethod
import android.widget.TextView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.res.ResourcesCompat
import app.m5chat.android.R
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
    sessionId: String? = null,
    onChoiceSelected: ((String) -> Unit)? = null,
    onFormSubmit: ((Map<String, String>, List<VibecoderFormField>) -> Unit)? = null,
    formsSubmitted: Boolean = false,
    yesNoSubmitted: Boolean = false,
    onYesNoSubmit: (() -> Unit)? = null
) {
    val isUser = message?.role == MessageRole.USER
    val rawText = streamingText ?: message?.text ?: ""
    val displayText = remember(rawText) { stripAttachmentSuffix(rawText) }

    // Parse vibecoder:choices blocks for assistant messages
    val choicesBlocks = remember(displayText, isUser) {
        if (!isUser && !isStreaming) parseVibecoderChoices(displayText) else emptyList()
    }

    // Parse vibecoder:form blocks for assistant messages
    val formBlocks = remember(displayText, isUser) {
        if (!isUser && !isStreaming) parseVibecoderForms(displayText) else emptyList()
    }

    // Parse vibecoder:yesno tags for assistant messages
    val yesNoBlocks = remember(displayText, isUser) {
        if (!isUser && !isStreaming) parseVibecoderYesNo(displayText) else emptyList()
    }

    val text = remember(displayText, choicesBlocks, formBlocks, yesNoBlocks, formsSubmitted, yesNoSubmitted) {
        var result = displayText
        if (choicesBlocks.isNotEmpty()) result = removeVibecoderChoices(result)
        if (yesNoBlocks.isNotEmpty()) {
            result = if (yesNoSubmitted) {
                replaceVibecoderYesNoWithQuestions(result)
            } else {
                removeVibecoderYesNo(result)
            }
        }
        if (formBlocks.isNotEmpty()) {
            result = if (formsSubmitted) {
                replaceVibecoderFormsWithQuestions(result)
            } else {
                removeVibecoderForms(result)
            }
        }
        result
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
                    Color.Transparent
                }
            ),
            elevation = CardDefaults.cardElevation(
                defaultElevation = if (isUser) 1.dp else 0.dp
            ),
            shape = MaterialTheme.shapes.medium
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                // Role indicator for non-user messages
                if (!isUser && message != null && message.role != MessageRole.ASSISTANT) {
                    Text(
                        text = when (message.role) {
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

                // Vibecoder yes/no
                if (yesNoBlocks.isNotEmpty() && onChoiceSelected != null && !yesNoSubmitted) {
                    Spacer(modifier = Modifier.height(12.dp))
                    yesNoBlocks.forEach { block ->
                        VibecoderYesNoView(
                            block = block,
                            onOptionSelected = { choice ->
                                onChoiceSelected(choice)
                                onYesNoSubmit?.invoke()
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }

                // Vibecoder form
                if (formBlocks.isNotEmpty() && onFormSubmit != null && !formsSubmitted) {
                    Spacer(modifier = Modifier.height(12.dp))
                    formBlocks.forEach { block ->
                        VibecoderFormView(
                            block = block,
                            onFormSubmit = { formData -> onFormSubmit(formData, block.fields) },
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
                                isUser = isUser,
                                sessionId = sessionId
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
    isUser: Boolean,
    sessionId: String?
) {
    val resolvedPath = remember(attachment.path, sessionId) {
        resolveAttachmentPath(attachment.path, sessionId)
    }
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
                .data(resolvedPath ?: attachment.path)
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

private fun resolveAttachmentPath(path: String, sessionId: String?): String? {
    if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("content://") || path.startsWith("file://")) {
        return path
    }
    if (sessionId.isNullOrBlank()) {
        return null
    }
    val base = Uri.parse(app.m5chat.android.M5ChatApplication.BASE_URL)
    return base.buildUpon()
        .appendEncodedPath("api/attachments/file")
        .appendQueryParameter("session", sessionId)
        .appendQueryParameter("path", path)
        .build()
        .toString()
}

private fun stripAttachmentSuffix(text: String): String {
    val match = ATTACHMENTS_SUFFIX_REGEX.find(text) ?: return text
    return match.groupValues.getOrNull(1)?.trimEnd() ?: text
}

private val ATTACHMENTS_SUFFIX_REGEX = Regex(
    pattern = """(?s)^(.*?)(?:\n?\s*;;\s*attachments:\s*\[[^\]]*])\s*$"""
)

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
    val codeFence = remember(markdown) { extractSingleCodeFence(markdown) }
    if (codeFence != null && shouldCollapseCodeBlock(codeFence.code)) {
        CollapsibleCodeBlock(
            code = codeFence.code,
            language = codeFence.language,
            modifier = modifier
        )
        return
    }

    val context = LocalContext.current
    val textColor = MaterialTheme.colorScheme.onSurfaceVariant
    val linkColor = MaterialTheme.colorScheme.primary
    val codeBackgroundColor = MaterialTheme.colorScheme.surface
    val codeTextColor = MaterialTheme.colorScheme.onSurface
    val codeTextSizePx = remember {
        14f * context.resources.displayMetrics.scaledDensity
    }
    val bodyTypeface = remember {
        ResourcesCompat.getFont(context, R.font.space_grotesk_wght)
    }

    val markwon = remember(textColor, linkColor, codeBackgroundColor, codeTextSizePx) {
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
                        .codeTextSize(codeTextSizePx.toInt())
                        .codeBlockTextSize(codeTextSizePx.toInt())
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
                bodyTypeface?.let { typeface = it }
            }
        },
        update = { textView ->
            markwon.setMarkdown(textView, markdown)
        }
    )
}

private data class CodeFence(
    val language: String?,
    val code: String
)

private fun extractSingleCodeFence(markdown: String): CodeFence? {
    val fenceRegex = Regex(
        pattern = """^\s*```([A-Za-z0-9_-]+)?\s*\n([\s\S]*?)\n```\s*$"""
    )
    val match = fenceRegex.find(markdown) ?: return null
    val language = match.groupValues.getOrNull(1)?.ifBlank { null }
    val code = match.groupValues.getOrNull(2)?.trimEnd() ?: return null
    return CodeFence(language = language, code = code)
}

private fun shouldCollapseCodeBlock(code: String): Boolean {
    val lines = code.lines().size
    return lines >= 8 || code.length >= 400
}

@Composable
private fun CollapsibleCodeBlock(
    code: String,
    language: String?,
    modifier: Modifier = Modifier
) {
    var expanded by remember(code) { mutableStateOf(false) }
    val background = MaterialTheme.colorScheme.surface
    val textColor = MaterialTheme.colorScheme.onSurface
    val lineCount = remember(code) { code.lines().size }

    Column(
        modifier = modifier
            .clip(MaterialTheme.shapes.small)
            .background(background)
            .padding(8.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Filled.Code,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (language.isNullOrBlank()) "Code" else "Code ($language)",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "$lineCount lignes",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Icon(
                imageVector = if (expanded) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Spacer(modifier = Modifier.height(6.dp))

        if (expanded) {
            Text(
                text = code,
                color = textColor,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 240.dp)
                    .verticalScroll(rememberScrollState())
                    .horizontalScroll(rememberScrollState())
                    .padding(8.dp)
            )
        } else {
            Text(
                text = code,
                color = textColor,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp)
            )
        }
    }
}
