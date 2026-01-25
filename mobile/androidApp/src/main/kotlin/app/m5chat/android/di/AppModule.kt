package app.m5chat.android.di

import app.m5chat.android.data.AttachmentUploader
import app.m5chat.android.data.SessionPreferences
import app.m5chat.android.viewmodel.ChatViewModel
import app.m5chat.android.viewmodel.SessionViewModel
import app.m5chat.shared.network.ApiClient
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
