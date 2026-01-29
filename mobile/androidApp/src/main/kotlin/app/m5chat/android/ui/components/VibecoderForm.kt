package app.m5chat.android.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/**
 * Represents a parsed vibecoder:form block
 */
data class VibecoderFormBlock(
    val question: String,
    val fields: List<VibecoderFormField>,
    val startIndex: Int,
    val endIndex: Int
)

/**
 * Represents a form field
 */
data class VibecoderFormField(
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
 * Parses vibecoder:form blocks from markdown text.
 * Format:
 * <!-- vibecoder:form {question} -->
 * input|textarea|radio|select|checkbox::field_id::Label::Default/Choices
 * <!-- /vibecoder:form -->
 */
fun parseVibecoderForms(text: String): List<VibecoderFormBlock> {
    val blocks = mutableListOf<VibecoderFormBlock>()
    val startPattern = Regex("""<!--\s*vibecoder:form\s+(.+?)\s*-->""", RegexOption.IGNORE_CASE)
    val endPattern = Regex("""<!--\s*/vibecoder:form\s*-->""", RegexOption.IGNORE_CASE)

    var searchStart = 0
    while (searchStart < text.length) {
        val startMatch = startPattern.find(text, searchStart) ?: break
        val endMatch = endPattern.find(text, startMatch.range.last + 1) ?: break

        val question = startMatch.groupValues[1].trim()
        val fieldsText = text.substring(startMatch.range.last + 1, endMatch.range.first)
        val fields = parseFormFields(fieldsText)

        if (fields.isNotEmpty()) {
            blocks.add(
                VibecoderFormBlock(
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
private fun parseFormFields(text: String): List<VibecoderFormField> {
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

                    VibecoderFormField(
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
 * Extracts text content without vibecoder:form blocks
 */
fun removeVibecoderForms(text: String): String {
    val blocks = parseVibecoderForms(text)
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
 * Replaces vibecoder:form blocks with their question text
 */
fun replaceVibecoderFormsWithQuestions(text: String): String {
    val blocks = parseVibecoderForms(text)
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
 * Composable to display vibecoder:form as interactive form fields
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VibecoderFormView(
    block: VibecoderFormBlock,
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
fun formatFormResponse(formData: Map<String, String>, fields: List<VibecoderFormField>): String {
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
