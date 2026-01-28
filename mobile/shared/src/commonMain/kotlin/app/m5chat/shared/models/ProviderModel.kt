package app.m5chat.shared.models

import kotlinx.serialization.Serializable

/**
 * Represents a reasoning effort option for a model
 */
@Serializable
data class ReasoningEffortOption(
    val reasoningEffort: String
)

/**
 * Represents an LLM model available for a provider
 */
@Serializable
data class ProviderModel(
    val id: String,
    val model: String,
    val displayName: String? = null,
    val isDefault: Boolean = false,
    val defaultReasoningEffort: String? = null,
    val supportedReasoningEfforts: List<ReasoningEffortOption> = emptyList()
)

/**
 * Response from the models API endpoint
 */
@Serializable
data class ModelsResponse(
    val models: List<ProviderModel> = emptyList()
)

/**
 * State for provider models (loading, error, models list)
 */
data class ProviderModelState(
    val models: List<ProviderModel> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null
)
