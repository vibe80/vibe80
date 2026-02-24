package app.vibe80.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.vibe80.android.di.appModule
import app.vibe80.android.data.SessionPreferences
import app.vibe80.android.notifications.MessageNotifier
import app.vibe80.shared.di.sharedModule
import app.vibe80.shared.models.MessageRole
import app.vibe80.shared.repository.SessionRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.component.KoinComponent
import org.koin.core.component.get
import org.koin.core.context.startKoin

class Vibe80Application : Application(), DefaultLifecycleObserver, KoinComponent {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var isInForeground = false
    private lateinit var notifier: MessageNotifier

    override fun onCreate() {
        super<Application>.onCreate()

        startKoin {
            androidLogger()
            androidContext(this@Vibe80Application)
            modules(
                sharedModule(BASE_URL),
                appModule
            )
        }

        notifier = MessageNotifier(this)
        notifier.createChannel()

        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
        startNotificationObservers()
    }

    override fun onStart(owner: LifecycleOwner) {
        isInForeground = true
        val sessionPreferences: SessionPreferences = get()
        val sessionRepository: SessionRepository = get()

        appScope.launch {
            val savedWorkspace = sessionPreferences.savedWorkspace.first()
            if (!savedWorkspace?.workspaceToken.isNullOrBlank()) {
                sessionRepository.setWorkspaceToken(savedWorkspace.workspaceToken)
            }
            if (!savedWorkspace?.workspaceRefreshToken.isNullOrBlank()) {
                sessionRepository.setRefreshToken(savedWorkspace.workspaceRefreshToken)
            }
        }
    }

    override fun onStop(owner: LifecycleOwner) {
        isInForeground = false
    }

    private fun startNotificationObservers() {
        val sessionRepository: SessionRepository = get()

        appScope.launch {
            var lastNotifiedId: String? = null
            sessionRepository.messages.collect { messages ->
                val assistant = messages.lastOrNull { it.role == MessageRole.ASSISTANT }
                if (assistant != null && assistant.id != lastNotifiedId) {
                    lastNotifiedId = assistant.id
                    maybeNotify(
                        title = "Nouveau message",
                        body = assistant.text,
                        sessionId = sessionRepository.sessionState.value?.sessionId,
                        worktreeId = null
                    )
                }
            }
        }

        appScope.launch {
            val lastNotifiedByWorktree = mutableMapOf<String, String?>()
            sessionRepository.worktreeMessages.collect { worktreeMessages ->
                worktreeMessages.forEach { (worktreeId, messages) ->
                    val assistant = messages.lastOrNull { it.role == MessageRole.ASSISTANT }
                    val lastNotified = lastNotifiedByWorktree[worktreeId]
                    if (assistant != null && assistant.id != lastNotified) {
                        lastNotifiedByWorktree[worktreeId] = assistant.id
                        val worktreeName = sessionRepository.worktrees.value[worktreeId]?.name
                        val title = if (worktreeName.isNullOrBlank()) {
                            "Nouveau message (worktree)"
                        } else {
                            "Nouveau message ($worktreeName)"
                        }
                        maybeNotify(
                            title = title,
                            body = assistant.text,
                            sessionId = sessionRepository.sessionState.value?.sessionId,
                            worktreeId = worktreeId
                        )
                    }
                }
            }
        }
    }

    private fun maybeNotify(title: String, body: String, sessionId: String?, worktreeId: String?) {
        if (isInForeground) return
        notifier.notifyMessage(title, body, sessionId, worktreeId)
    }

    companion object {
        const val BASE_URL = "https://app.vibe80.io"
        const val SHOW_LOGS_BUTTON = false
        var logsButtonEnabled by mutableStateOf(SHOW_LOGS_BUTTON)
    }
}
