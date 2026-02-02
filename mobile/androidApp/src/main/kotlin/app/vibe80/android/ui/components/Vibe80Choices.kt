package app.vibe80.android.ui.components

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Represents a parsed vibe80:choices block
 */
data class Vibe80ChoicesBlock(
    val question: String?,
    val options: List<String>,
    val startIndex: Int,
    val endIndex: Int
)

/**
 * Parses vibe80:choices blocks from markdown text.
 * Format:
 * <!-- vibe80:choices question? -->
 * option1
 * option2
 * <!-- /vibe80:choices -->
 */
fun parseVibe80Choices(text: String): List<Vibe80ChoicesBlock> {
    val blocks = mutableListOf<Vibe80ChoicesBlock>()
    val startPattern = Regex("""<!--\s*vibe80:choices\s*(.*?)\s*-->""", RegexOption.IGNORE_CASE)
    val endPattern = Regex("""<!--\s*/vibe80:choices\s*-->""", RegexOption.IGNORE_CASE)

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
                Vibe80ChoicesBlock(
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
 * Extracts text content without vibe80:choices blocks
 */
fun removeVibe80Choices(text: String): String {
    val blocks = parseVibe80Choices(text)
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
 * Composable to display vibe80:choices as clickable buttons
 */
@Composable
fun Vibe80ChoicesView(
    block: Vibe80ChoicesBlock,
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
        val useFilledStyle = isSystemInDarkTheme()
        block.options.forEach { option ->
            if (useFilledStyle) {
                Button(
                    onClick = { onOptionSelected(option) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                ) {
                    Text(
                        text = option,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            } else {
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
}
