package app.m5chat.android.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Represents a parsed vibecoder:choices block
 */
data class VibecoderChoicesBlock(
    val question: String?,
    val options: List<String>,
    val startIndex: Int,
    val endIndex: Int
)

/**
 * Parses vibecoder:choices blocks from markdown text.
 * Format:
 * <!-- vibecoder:choices question? -->
 * option1
 * option2
 * <!-- /vibecoder:choices -->
 */
fun parseVibecoderChoices(text: String): List<VibecoderChoicesBlock> {
    val blocks = mutableListOf<VibecoderChoicesBlock>()
    val startPattern = Regex("""<!--\s*vibecoder:choices\s*(.*?)\s*-->""", RegexOption.IGNORE_CASE)
    val endPattern = Regex("""<!--\s*/vibecoder:choices\s*-->""", RegexOption.IGNORE_CASE)

    var searchStart = 0
    while (searchStart < text.length) {
        val startMatch = startPattern.find(text, searchStart) ?: break
        val endMatch = endPattern.find(text, startMatch.range.last + 1) ?: break

        val question = startMatch.groupValues[1].trim().ifEmpty { null }
        val optionsText = text.substring(startMatch.range.last + 1, endMatch.range.first)
        val options = optionsText
            .lines()
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("<!--") }

        if (options.isNotEmpty()) {
            blocks.add(
                VibecoderChoicesBlock(
                    question = question,
                    options = options,
                    startIndex = startMatch.range.first,
                    endIndex = endMatch.range.last + 1
                )
            )
        }

        searchStart = endMatch.range.last + 1
    }

    return blocks
}

/**
 * Extracts text content without vibecoder:choices blocks
 */
fun removeVibecoderChoices(text: String): String {
    val blocks = parseVibecoderChoices(text)
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
 * Composable to display vibecoder:choices as clickable buttons
 */
@Composable
fun VibecoderChoicesView(
    block: VibecoderChoicesBlock,
    onOptionSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Question/header if present
        block.question?.let { question ->
            Text(
                text = question,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 4.dp)
            )
        }

        // Options as buttons
        block.options.forEach { option ->
            OutlinedButton(
                onClick = { onOptionSelected(option) },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.primary
                )
            ) {
                Text(
                    text = option,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
    }
}
