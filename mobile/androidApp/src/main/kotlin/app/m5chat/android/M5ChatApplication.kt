package app.m5chat.android

import android.app.Application
import app.m5chat.android.di.appModule
import app.m5chat.shared.di.sharedModule
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin

class M5ChatApplication : Application() {

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
    }

    companion object {
        // TODO: Make configurable via settings
        const val BASE_URL = "http://10.0.2.2:3000" // localhost from emulator
    }
}
