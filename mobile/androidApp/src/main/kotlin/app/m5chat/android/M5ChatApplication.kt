package app.m5chat.android

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import app.m5chat.android.di.appModule
import app.m5chat.android.data.SessionPreferences
import app.m5chat.shared.di.sharedModule
import app.m5chat.shared.models.LLMProvider
import app.m5chat.shared.repository.SessionRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin
import org.koin.core.context.GlobalContext

class M5ChatApplication : Application(), DefaultLifecycleObserver {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()

        startKoin {
            androidLogger()
            androidContext(this@M5ChatApplication)
            modules(
                sharedModule(BASE_URL),
                appModule
            )
        }

        ProcessLifecycleOwner.get().lifecycle.addObserver(this)
    }

    override fun onStart(owner: LifecycleOwner) {
        val koin = GlobalContext.get().koin
        val sessionPreferences: SessionPreferences = koin.get()
        val sessionRepository: SessionRepository = koin.get()

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

    companion object {
        const val BASE_URL = "https://vibecoder.lab.adho.app"
    }
}
