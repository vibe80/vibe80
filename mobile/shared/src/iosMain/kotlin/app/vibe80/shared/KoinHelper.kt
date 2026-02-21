package app.vibe80.shared

import app.vibe80.shared.di.sharedModule
import app.vibe80.shared.network.ApiClient
import app.vibe80.shared.network.WebSocketManager
import app.vibe80.shared.repository.SessionRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin

/**
 * Helper object for initializing Koin from iOS.
 * Call KoinHelper.start(baseUrl) from Swift AppDelegate or AppState.
 */
object KoinHelper {

    /**
     * Initialize Koin with the shared module.
     * @param baseUrl The server base URL (e.g., "https://vibe80.example.com")
     */
    fun start(baseUrl: String) {
        startKoin {
            modules(sharedModule(baseUrl))
        }
    }

    /**
     * Stop Koin (call on app termination if needed)
     */
    fun stop() {
        stopKoin()
    }
}

/**
 * Provides access to shared module dependencies from iOS.
 * Usage in Swift:
 *   let provider = SharedDependencies()
 *   let repository = provider.sessionRepository
 */
class SharedDependencies : KoinComponent {
    val sessionRepository: SessionRepository by inject()
    val apiClient: ApiClient by inject()
    val webSocketManager: WebSocketManager by inject()

    fun workspaceTokenObserver(): WorkspaceTokenObserver {
        return WorkspaceTokenObserver(sessionRepository.workspaceTokenUpdates)
    }

    fun workspaceAuthInvalidObserver(): WorkspaceAuthInvalidObserver {
        return WorkspaceAuthInvalidObserver(sessionRepository.workspaceAuthInvalid)
    }
}

class WorkspaceTokenObserver(
    private val flow: Flow<ApiClient.WorkspaceTokenUpdate>
) {
    private var scope: CoroutineScope? = null
    private var job: Job? = null

    fun subscribe(onUpdate: (workspaceToken: String, refreshToken: String) -> Unit) {
        close()
        scope = CoroutineScope(Dispatchers.Main)
        job = flow
            .onEach { update ->
                onUpdate(update.workspaceToken, update.refreshToken)
            }
            .launchIn(scope!!)
    }

    fun close() {
        job?.cancel()
        scope?.cancel()
        job = null
        scope = null
    }
}

class WorkspaceAuthInvalidObserver(
    private val flow: Flow<String>
) {
    private var scope: CoroutineScope? = null
    private var job: Job? = null

    fun subscribe(onInvalid: (message: String) -> Unit) {
        close()
        scope = CoroutineScope(Dispatchers.Main)
        job = flow
            .onEach { message -> onInvalid(message) }
            .launchIn(scope!!)
    }

    fun close() {
        job?.cancel()
        scope?.cancel()
        job = null
        scope = null
    }
}
