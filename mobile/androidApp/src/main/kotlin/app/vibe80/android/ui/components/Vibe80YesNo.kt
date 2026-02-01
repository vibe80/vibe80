package app.vibe80.android.ui.components

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
import app.vibe80.android.R

/**
 * Represents a parsed vibe80:yesno tag
 */
data class Vibe80YesNoBlock(
    val question: String?,
    val startIndex: Int,
    val endIndex: Int
)

/**
 * Parses vibe80:yesno tags from markdown text.
 * Format:
 * <!-- vibe80:yesno question? -->
 */
fun parseVibe80YesNo(text: String): List<Vibe80YesNoBlock> {
    val blocks = mutableListOf<Vibe80YesNoBlock>()
    val pattern = Regex("""<!--\s*vibe80:yesno\s*(.*?)\s*-->""", RegexOption.IGNORE_CASE)

    pattern.findAll(text).forEach { match ->
        val question = match.groupValues[1].trim().ifEmpty { null }
        blocks.add(
            Vibe80YesNoBlock(
                question = question,
                startIndex = match.range.first,
                endIndex = match.range.last + 1
            )
        )
    }

    return blocks
}

/**
 * Extracts text content without vibe80:yesno tags
 */
fun removeVibe80YesNo(text: String): String {
    val blocks = parseVibe80YesNo(text)
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
 * Replaces vibe80:yesno tags with their question text (when present)
 */
fun replaceVibe80YesNoWithQuestions(text: String): String {
    val blocks = parseVibe80YesNo(text)
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
 * Composable to display vibe80:yesno as clickable buttons
 */
@Composable
fun Vibe80YesNoView(
    block: Vibe80YesNoBlock,
    onOptionSelected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        val yesLabel = stringResource(R.string.vibe80_yes)
        val noLabel = stringResource(R.string.vibe80_no)

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
