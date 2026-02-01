package app.vibe80.shared

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.cancel

/**
 * Wrapper for Kotlin StateFlow that can be observed from Swift.
 *
 * Usage in Swift:
 * ```swift
 * let wrapper = FlowWrapper(flow: repository.messages)
 * wrapper.subscribe { messages in
 *     self.messages = messages as? [ChatMessage] ?? []
 * }
 * // Later: wrapper.close()
 * ```
 */
class FlowWrapper<T>(private val flow: StateFlow<T>) {

    /** Current value of the StateFlow */
    val value: T get() = flow.value

    private var scope: CoroutineScope? = null
    private var job: Job? = null

    /**
     * Subscribe to flow updates.
     * @param onEach Callback invoked on each emission (on main thread)
     */
    fun subscribe(onEach: (T) -> Unit) {
        // Cancel any existing subscription
        close()

        scope = CoroutineScope(Dispatchers.Main)
        job = flow
            .onEach { value -> onEach(value) }
            .launchIn(scope!!)
    }

    /**
     * Cancel the subscription and clean up resources.
     * Must be called when the observer is no longer needed.
     */
    fun close() {
        job?.cancel()
        scope?.cancel()
        job = null
        scope = null
    }
}

/**
 * Wrapper for regular Kotlin Flow (non-StateFlow).
 * Useful for one-shot events like errors.
 */
class SharedFlowWrapper<T>(private val flow: Flow<T>) {

    private var scope: CoroutineScope? = null
    private var job: Job? = null

    /**
     * Subscribe to flow emissions.
     * @param onEach Callback invoked on each emission (on main thread)
     */
    fun subscribe(onEach: (T) -> Unit) {
        close()

        scope = CoroutineScope(Dispatchers.Main)
        job = flow
            .onEach { value -> onEach(value) }
            .launchIn(scope!!)
    }

    /**
     * Cancel the subscription.
     */
    fun close() {
        job?.cancel()
        scope?.cancel()
        job = null
        scope = null
    }
}

/**
 * Collector interface for Swift interop.
 * Allows Swift code to implement a collector callback.
 */
interface Collector<T> {
    fun emit(value: T)
}

/**
 * Extension to create FlowWrapper from StateFlow.
 * Makes it easier to use from Swift.
 */
fun <T> StateFlow<T>.wrap(): FlowWrapper<T> = FlowWrapper(this)

/**
 * Extension to create SharedFlowWrapper from Flow.
 */
fun <T> Flow<T>.wrapAsShared(): SharedFlowWrapper<T> = SharedFlowWrapper(this)
