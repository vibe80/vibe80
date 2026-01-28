package app.m5chat.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import app.m5chat.android.di.appModule
import app.m5chat.android.data.SessionPreferences
import app.m5chat.android.notifications.MessageNotifier
import app.m5chat.shared.di.sharedModule
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.models.MessageRole
import app.m5chat.shared.repository.SessionRepository
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

class M5ChatApplication : Application(), DefaultLifecycleObserver, KoinComponent {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var isInForeground = false
    private lateinit var notifier: MessageNotifier

    override fun onCreate() {
        super<Application>.onCreate()

        startKoin {
            androidLogger()
            androidContext(this@M5ChatApplication)
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
            val savedSession = sessionPreferences.savedSession.first()
            if (savedSession != null) {
                val provider = try {
                    LLMProvider.valueOf(savedSession.provider.uppercase())
                } catch (e: Exception) {
                    LLMProvider.CODEX
                }
                sessionRepository.ensureWebSocketConnected(savedSession.sessionId, provider)
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
                    maybeNotify("Nouveau message", assistant.text)
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
                        maybeNotify(title, assistant.text)
                    }
                }
            }
        }
    }

    private fun maybeNotify(title: String, body: String) {
        if (isInForeground) return
        notifier.notifyMessage(title, body)
    }

    companion object {
        const val BASE_URL = "https://vibecoder.lab.adho.app"
    }
}
