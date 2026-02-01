package app.vibe80.shared.di

import app.vibe80.shared.network.ApiClient
import app.vibe80.shared.network.HttpClientFactory
import app.vibe80.shared.network.WebSocketManager
import app.vibe80.shared.repository.SessionRepository
import org.koin.dsl.module

fun sharedModule(baseUrl: String) = module {
    single { HttpClientFactory.create() }
    single { ApiClient(get(), baseUrl) }
    single { WebSocketManager(get(), baseUrl) }
    single { SessionRepository(get(), get()) }
}
