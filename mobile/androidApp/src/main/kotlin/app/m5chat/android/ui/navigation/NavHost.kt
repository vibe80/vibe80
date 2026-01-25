package app.m5chat.android.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.m5chat.android.ui.screens.ChatScreen
import app.m5chat.android.ui.screens.SessionScreen

sealed class Screen(val route: String) {
    data object Session : Screen("session")
    data object Chat : Screen("chat/{sessionId}") {
        fun createRoute(sessionId: String) = "chat/$sessionId"
    }
}

@Composable
fun M5ChatNavHost(
    navController: NavHostController = rememberNavController()
) {
    NavHost(
        navController = navController,
        startDestination = Screen.Session.route
    ) {
        composable(Screen.Session.route) {
            SessionScreen(
                onSessionCreated = { sessionId ->
                    navController.navigate(Screen.Chat.createRoute(sessionId)) {
                        popUpTo(Screen.Session.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.Chat.route) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString("sessionId") ?: return@composable
            ChatScreen(
                sessionId = sessionId,
                onDisconnect = {
                    navController.navigate(Screen.Session.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
    }
}
