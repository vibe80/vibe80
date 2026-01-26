package app.m5chat.shared

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlin.coroutines.cancellation.CancellationException

/**
 * Wrapper for executing Kotlin suspend functions from Swift.
 *
 * Usage in Swift:
 * ```swift
 * SuspendWrapper<SessionState>().execute(
 *     suspend: { repository.createSession(repoUrl: url, provider: .codex) },
 *     onSuccess: { state in
 *         self.sessionState = state
 *     },
 *     onError: { error in
 *         self.errorMessage = error.message ?? "Unknown error"
 *     }
 * )
 * ```
 */
class SuspendWrapper<T> {

    private var scope: CoroutineScope? = null
    private var job: Job? = null

    /**
     * Execute a suspend function with callbacks.
     *
     * @param suspend The suspend function to execute (returns Result<T>)
     * @param onSuccess Called on successful completion with the result
     * @param onError Called if an exception occurs
     */
    fun execute(
        suspendBlock: suspend () -> Result<T>,
        onSuccess: (T) -> Unit,
        onError: (Throwable) -> Unit
    ) {
        cancel()

        scope = CoroutineScope(Dispatchers.Main)
        job = scope?.launch {
            try {
                val result = suspendBlock()
                result.fold(
                    onSuccess = { value -> onSuccess(value) },
                    onFailure = { error -> onError(error) }
                )
            } catch (e: CancellationException) {
                // Ignore cancellation
            } catch (e: Throwable) {
                onError(e)
            }
        }
    }

    /**
     * Execute a suspend function that doesn't return a Result.
     */
    fun executeSimple(
        suspendBlock: suspend () -> T,
        onSuccess: (T) -> Unit,
        onError: (Throwable) -> Unit
    ) {
        cancel()

        scope = CoroutineScope(Dispatchers.Main)
        job = scope?.launch {
            try {
                val result = suspendBlock()
                onSuccess(result)
            } catch (e: CancellationException) {
                // Ignore cancellation
            } catch (e: Throwable) {
                onError(e)
            }
        }
    }

    /**
     * Execute a suspend function that returns Unit (no result).
     */
    fun executeUnit(
        suspendBlock: suspend () -> Unit,
        onComplete: () -> Unit,
        onError: (Throwable) -> Unit
    ) {
        cancel()

        scope = CoroutineScope(Dispatchers.Main)
        job = scope?.launch {
            try {
                suspendBlock()
                onComplete()
            } catch (e: CancellationException) {
                // Ignore cancellation
            } catch (e: Throwable) {
                onError(e)
            }
        }
    }

    /**
     * Cancel the current operation.
     */
    fun cancel() {
        job?.cancel()
        scope?.cancel()
        job = null
        scope = null
    }
}

/**
 * Simplified wrapper for fire-and-forget suspend calls.
 *
 * Usage in Swift:
 * ```swift
 * Coroutines.launch {
 *     repository.sendMessage(text: "Hello")
 * }
 * ```
 */
object Coroutines {

    private val scope = CoroutineScope(Dispatchers.Main)

    /**
     * Launch a suspend function without waiting for result.
     * Errors are logged but not propagated.
     */
    fun launch(
        block: suspend () -> Unit,
        onError: ((Throwable) -> Unit)? = null
    ): Job {
        return scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                // Ignore
            } catch (e: Throwable) {
                onError?.invoke(e)
            }
        }
    }
}

/**
 * Callback-based wrapper that's easier to use from Swift.
 * Provides a more idiomatic Swift API.
 */
class AsyncCall<T> private constructor(
    private val block: suspend () -> T
) {
    companion object {
        fun <T> create(block: suspend () -> T): AsyncCall<T> = AsyncCall(block)
    }

    private var scope: CoroutineScope? = null
    private var job: Job? = null

    /**
     * Start the async operation.
     */
    fun start(
        onSuccess: (T) -> Unit,
        onFailure: (Throwable) -> Unit
    ): AsyncCall<T> {
        scope = CoroutineScope(Dispatchers.Main)
        job = scope?.launch {
            try {
                val result = block()
                onSuccess(result)
            } catch (e: CancellationException) {
                // Cancelled, ignore
            } catch (e: Throwable) {
                onFailure(e)
            }
        }
        return this
    }

    /**
     * Cancel the operation.
     */
    fun cancel() {
        job?.cancel()
        scope?.cancel()
    }
}
