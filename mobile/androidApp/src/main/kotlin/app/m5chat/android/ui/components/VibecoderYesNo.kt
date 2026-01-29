package app.m5chat.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.m5chat.android.R

/**
 * Represents a parsed vibecoder:yesno tag
 */
data class VibecoderYesNoBlock(
    val question: String?,
    val startIndex: Int,
    val endIndex: Int
)

/**
 * Parses vibecoder:yesno tags from markdown text.
 * Format:
 * <!-- vibecoder:yesno question? -->
 */
fun parseVibecoderYesNo(text: String): List<VibecoderYesNoBlock> {
    val blocks = mutableListOf<VibecoderYesNoBlock>()
    val pattern = Regex("""<!--\s*vibecoder:yesno\s*(.*?)\s*-->""", RegexOption.IGNORE_CASE)

    pattern.findAll(text).forEach { match ->
        val question = match.groupValues[1].trim().ifEmpty { null }
        blocks.add(
            VibecoderYesNoBlock(
                question = question,
                startIndex = match.range.first,
                endIndex = match.range.last + 1
            )
        )
    }

    return blocks
}

/**
 * Extracts text content without vibecoder:yesno tags
 */
fun removeVibecoderYesNo(text: String): String {
    val blocks = parseVibecoderYesNo(text)
    if (blocks.isEmpty()) return text

    val result = StringBuilder()
    var lastEnd = 0

    for (block in blocks.sortedBy { it.startIndex }) {
        if (block.startIndex > lastEnd) {
            result.append(text.substring(lastEnd, block.startIndex))
        }
        lastEnd = block.endIndex
    }

    if (lastEnd < text.length) {
        result.append(text.substring(lastEnd))
    }

    return result.toString().trim()
}

/**
 * Replaces vibecoder:yesno tags with their question text (when present)
 */
fun replaceVibecoderYesNoWithQuestions(text: String): String {
    val blocks = parseVibecoderYesNo(text)
    if (blocks.isEmpty()) return text

    val result = StringBuilder()
    var lastEnd = 0

    for (block in blocks.sortedBy { it.startIndex }) {
        if (block.startIndex > lastEnd) {
            result.append(text.substring(lastEnd, block.startIndex))
        }
        val question = block.question?.trim().orEmpty()
        if (question.isNotBlank()) {
            if (result.isNotEmpty() && !result.last().isWhitespace()) {
                result.append("\n")
            }
            result.append(question)
            result.append("\n")
        }
        lastEnd = block.endIndex
    }

    if (lastEnd < text.length) {
        result.append(text.substring(lastEnd))
    }

    return result.toString().trim()
}

/**
 * Composable to display vibecoder:yesno as clickable buttons
 */
@Composable
fun VibecoderYesNoView(
    block: VibecoderYesNoBlock,
    onOptionSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        val yesLabel = stringResource(R.string.vibecoder_yes)
        val noLabel = stringResource(R.string.vibecoder_no)

        block.question?.let { question ->
            Text(
                text = question,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 4.dp)
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Button(
                onClick = { onOptionSelected(yesLabel) },
                modifier = Modifier.weight(1f)
            ) {
                Text(text = yesLabel)
            }
            OutlinedButton(
                onClick = { onOptionSelected(noLabel) },
                modifier = Modifier.weight(1f)
            ) {
                Text(text = noLabel)
            }
        }
    }
}
