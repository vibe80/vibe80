package app.vibe80.shared.utils

object NotificationSanitizer {
    fun sanitizeForNotification(value: String?, maxLength: Int = 180): String {
        if (value.isNullOrBlank()) return ""

        var output = value

        val vibe80Match = Regex("""<!--\s*vibe80:""", RegexOption.IGNORE_CASE).find(output)
        if (vibe80Match != null) {
            output = output.substring(0, vibe80Match.range.first)
        }

        output = output
            .replace(Regex("""```([\s\S]*?)```"""), "$1")
            .replace(Regex("""`([^`]+)`"""), "$1")
            .replace(Regex("""!\[([^\]]*)\]\(([^)]+)\)"""), "$1")
            .replace(Regex("""\[([^\]]+)\]\(([^)]+)\)"""), "$1")
            .replace(Regex("""(?m)^\s{0,3}#{1,6}\s+"""), "")
            .replace(Regex("""(?m)^\s{0,3}>\s?"""), "")
            .replace(Regex("""(?m)^\s{0,3}[-*+]\s+"""), "")
            .replace(Regex("""(?m)^\s{0,3}\d+\.\s+"""), "")
            .replace(Regex("""[*_~]{1,3}"""), "")
            .replace(Regex("""\s+"""), " ")
            .trim()

        return if (output.length > maxLength) output.take(maxLength) else output
    }
}

