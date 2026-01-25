package app.m5chat.shared.di

import app.m5chat.shared.network.ApiClient
import app.m5chat.shared.network.HttpClientFactory
import app.m5chat.shared.network.WebSocketManager
import app.m5chat.shared.repository.SessionRepository
import org.koin.dsl.module

fun sharedModule(baseUrl: String) = module {
    single { HttpClientFactory.create() }
    single { ApiClient(get(), baseUrl) }
    single { WebSocketManager(get(), baseUrl) }
    single { SessionRepository(get(), get()) }
}
