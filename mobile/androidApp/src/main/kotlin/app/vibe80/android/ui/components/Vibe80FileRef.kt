package app.vibe80.android.ui.components

/**
 * Parses vibe80:fileref blocks from markdown text.
 * Format:
 * <!-- vibe80:fileref path/to/file -->
 */
fun parseVibe80FileRefs(text: String): List<String> {
    val pattern = Regex("""<!--\s*vibe80:fileref\s+([^>]+?)\s*-->""", RegexOption.IGNORE_CASE)
    return pattern.findAll(text)
        .mapNotNull { matchResult ->
            val path = matchResult.groupValues.getOrNull(1)?.trim().orEmpty()
            path.takeIf { it.isNotBlank() }
        }
        .toList()
}

/**
 * Removes vibe80:fileref blocks from text.
 */
fun removeVibe80FileRefs(text: String): String {
    val pattern = Regex("""<!--\s*vibe80:fileref\s+([^>]+?)\s*-->""", RegexOption.IGNORE_CASE)
    return text.replace(pattern, "")
}
