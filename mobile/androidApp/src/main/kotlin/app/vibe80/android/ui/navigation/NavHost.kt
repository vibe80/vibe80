package app.vibe80.android.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.vibe80.android.ui.screens.ChatScreen
import app.vibe80.android.ui.screens.QrScanScreen
import app.vibe80.android.ui.screens.SessionScreen

sealed class Screen(val route: String) {
    data object Session : Screen("session")
    data object QrScan : Screen("qr-scan")
    data object Chat : Screen("chat/{sessionId}") {
        fun createRoute(sessionId: String) = "chat/$sessionId"
    }
}

@Composable
fun Vibe80NavHost(
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
                },
                onOpenQrScanner = {
                    navController.navigate(Screen.QrScan.route)
                }
            )
        }

        composable(Screen.QrScan.route) {
            QrScanScreen(
                onHandoffComplete = { sessionId ->
                    navController.navigate(Screen.Chat.createRoute(sessionId)) {
                        popUpTo(Screen.Session.route) { inclusive = true }
                    }
                },
                onBack = { navController.popBackStack() }
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
