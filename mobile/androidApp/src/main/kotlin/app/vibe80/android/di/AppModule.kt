package app.vibe80.android.di

import app.vibe80.android.data.AttachmentUploader
import app.vibe80.android.data.SessionPreferences
import app.vibe80.android.viewmodel.ChatViewModel
import app.vibe80.android.viewmodel.SessionViewModel
import app.vibe80.shared.network.ApiClient
import org.koin.android.ext.koin.androidContext
import org.koin.androidx.viewmodel.dsl.viewModel
import org.koin.dsl.module

val appModule = module {
    single { SessionPreferences(androidContext()) }
    single {
        val apiClient: ApiClient = get()
        AttachmentUploader(androidContext(), apiClient.getBaseUrl())
    }
    viewModel { SessionViewModel(get(), get()) }
    viewModel { ChatViewModel(get(), get(), get()) }
}
