package app.vibe80.shared.models

import kotlinx.serialization.Serializable

@Serializable
data class RepoDiff(
    val status: String,
    val diff: String
)
