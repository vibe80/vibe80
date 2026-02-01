package app.vibe80.android.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/**
 * Represents a parsed vibe80:form block
 */
data class Vibe80FormBlock(
    val question: String,
    val fields: List<Vibe80FormField>,
    val startIndex: Int,
    val endIndex: Int
)

/**
 * Represents a form field
 */
data class Vibe80FormField(
    val type: FieldType,
    val id: String,
    val label: String,
    val defaultValue: String = "",
    val choices: List<String> = emptyList()
)

enum class FieldType {
    INPUT,
    TEXTAREA,
    RADIO,
    SELECT,
    CHECKBOX
}

/**
 * Parses vibe80:form blocks from markdown text.
 * Format:
 * <!-- vibe80:form {question} -->
 * input|textarea|radio|select|checkbox::field_id::Label::Default/Choices
 * <!-- /vibe80:form -->
 */
fun parseVibe80Forms(text: String): List<Vibe80FormBlock> {
    val blocks = mutableListOf<Vibe80FormBlock>()
    val startPattern = Regex("""<!--\s*vibe80:form\s+(.+?)\s*-->""", RegexOption.IGNORE_CASE)
    val endPattern = Regex("""<!--\s*/vibe80:form\s*-->""", RegexOption.IGNORE_CASE)

    var searchStart = 0
    while (searchStart < text.length) {
        val startMatch = startPattern.find(text, searchStart) ?: break
        val endMatch = endPattern.find(text, startMatch.range.last + 1) ?: break

        val question = startMatch.groupValues[1].trim()
        val fieldsText = text.substring(startMatch.range.last + 1, endMatch.range.first)
        val fields = parseFormFields(fieldsText)

        if (fields.isNotEmpty()) {
            blocks.add(
                Vibe80FormBlock(
                    question = question,
                    fields = fields,
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
 * Parses form fields from the content between form tags
 * Format: type::field_id::Label::Default/Choices
 */
private fun parseFormFields(text: String): List<Vibe80FormField> {
    return text.lines()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("<!--") }
        .mapNotNull { line ->
            val parts = line.split("::")
            if (parts.size >= 3) {
                val typeStr = parts[0].lowercase().trim()
                val type = when (typeStr) {
                    "input" -> FieldType.INPUT
                    "textarea" -> FieldType.TEXTAREA
                    "radio" -> FieldType.RADIO
                    "select" -> FieldType.SELECT
                    "checkbox" -> FieldType.CHECKBOX
                    else -> null
                }

                type?.let {
                    val id = parts[1].trim()
                    val label = parts[2].trim()
                    val defaultOrChoices = if (parts.size > 3) parts[3].trim() else ""

                    // For radio/select, the 4th part contains choices separated by ::
                    val choices = if (type == FieldType.RADIO || type == FieldType.SELECT) {
                        if (parts.size > 3) parts.drop(3).map { it.trim() } else emptyList()
                    } else {
                        emptyList()
                    }

                    val defaultValue = if (type == FieldType.RADIO || type == FieldType.SELECT) {
                        ""
                    } else {
                        defaultOrChoices
                    }

                    Vibe80FormField(
                        type = type,
                        id = id,
                        label = label,
                        defaultValue = defaultValue,
                        choices = choices
                    )
                }
            } else {
                null
            }
        }
}

/**
 * Extracts text content without vibe80:form blocks
 */
fun removeVibe80Forms(text: String): String {
    val blocks = parseVibe80Forms(text)
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
 * Replaces vibe80:form blocks with their question text
 */
fun replaceVibe80FormsWithQuestions(text: String): String {
    val blocks = parseVibe80Forms(text)
    if (blocks.isEmpty()) return text

    val result = StringBuilder()
    var lastEnd = 0

    for (block in blocks.sortedBy { it.startIndex }) {
        if (block.startIndex > lastEnd) {
            result.append(text.substring(lastEnd, block.startIndex))
        }
        if (block.question.isNotBlank()) {
            if (result.isNotEmpty() && !result.last().isWhitespace()) {
                result.append("\n")
            }
            result.append(block.question.trim())
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
 * Composable to display vibe80:form as interactive form fields
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Vibe80FormView(
    block: Vibe80FormBlock,
    onFormSubmit: (Map<String, String>) -> Unit,
    modifier: Modifier = Modifier
) {
    val formState = remember(block) {
        mutableStateMapOf<String, String>().apply {
            block.fields.forEach { field ->
                put(field.id, field.defaultValue)
            }
        }
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Question/header
        Text(
            text = block.question,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 4.dp)
        )

        // Form fields
        block.fields.forEach { field ->
            when (field.type) {
                FieldType.INPUT -> {
                    OutlinedTextField(
                        value = formState[field.id] ?: "",
                        onValueChange = { formState[field.id] = it },
                        label = { Text(field.label) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }

                FieldType.TEXTAREA -> {
                    OutlinedTextField(
                        value = formState[field.id] ?: "",
                        onValueChange = { formState[field.id] = it },
                        label = { Text(field.label) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 100.dp),
                        minLines = 3,
                        maxLines = 6
                    )
                }

                FieldType.RADIO -> {
                    Column {
                        Text(
                            text = field.label,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        field.choices.forEach { choice ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RadioButton(
                                    selected = formState[field.id] == choice,
                                    onClick = { formState[field.id] = choice }
                                )
                                Text(
                                    text = choice,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.padding(start = 4.dp)
                                )
                            }
                        }
                    }
                }

                FieldType.SELECT -> {
                    var expanded by remember { mutableStateOf(false) }
                    ExposedDropdownMenuBox(
                        expanded = expanded,
                        onExpandedChange = { expanded = it },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        OutlinedTextField(
                            value = formState[field.id] ?: "",
                            onValueChange = {},
                            readOnly = true,
                            label = { Text(field.label) },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                            modifier = Modifier
                                .menuAnchor()
                                .fillMaxWidth()
                        )
                        ExposedDropdownMenu(
                            expanded = expanded,
                            onDismissRequest = { expanded = false }
                        ) {
                            field.choices.forEach { choice ->
                                DropdownMenuItem(
                                    text = { Text(choice) },
                                    onClick = {
                                        formState[field.id] = choice
                                        expanded = false
                                    }
                                )
                            }
                        }
                    }
                }

                FieldType.CHECKBOX -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(
                            checked = formState[field.id] == "true",
                            onCheckedChange = { formState[field.id] = it.toString() }
                        )
                        Text(
                            text = field.label,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(start = 4.dp)
                        )
                    }
                }
            }
        }

        // Submit button
        Button(
            onClick = { onFormSubmit(formState.toMap()) },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Envoyer")
        }
    }
}

/**
 * Formats form data as a user-friendly message
 */
fun formatFormResponse(formData: Map<String, String>, fields: List<Vibe80FormField>): String {
    return fields.mapNotNull { field ->
        val value = formData[field.id]
        if (!value.isNullOrBlank() && value != "false") {
            when (field.type) {
                FieldType.CHECKBOX -> if (value == "true") field.label else null
                else -> "${field.label}: $value"
            }
        } else {
            null
        }
    }.joinToString("\n")
}
