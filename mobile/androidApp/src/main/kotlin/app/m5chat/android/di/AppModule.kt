package app.m5chat.android.di

import app.m5chat.android.viewmodel.ChatViewModel
import app.m5chat.android.viewmodel.SessionViewModel
import org.koin.androidx.viewmodel.dsl.viewModel
import org.koin.dsl.module

val appModule = module {
    viewModel { SessionViewModel(get()) }
    viewModel { ChatViewModel(get()) }
}
