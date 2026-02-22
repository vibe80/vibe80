package app.vibe80.android.ui.components

/**
 * Parse le premier tag vibe80:task.
 * Format:
 * <!-- vibe80:task description -->
 */
fun parseVibe80Task(text: String): String? {
    val pattern = Regex("""<!--\s*vibe80:task\s+(.+?)\s*-->""", RegexOption.IGNORE_CASE)
    val match = pattern.find(text) ?: return null
    return match.groupValues
        .getOrNull(1)
        ?.trim()
        ?.takeIf { it.isNotBlank() }
}

/**
 * Supprime tous les tags vibe80:task du texte.
 */
fun removeVibe80Task(text: String): String {
    val pattern = Regex("""<!--\s*vibe80:task\s+.+?\s*-->""", RegexOption.IGNORE_CASE)
    return text.replace(pattern, "")
}

