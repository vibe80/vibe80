package app.vibe80.android.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.navArgument
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import app.vibe80.android.ui.screens.ChatScreen
import app.vibe80.android.ui.screens.QrScanScreen
import app.vibe80.android.ui.screens.SessionScreen
import app.vibe80.android.NotificationRoute

sealed class Screen(val route: String) {
    data object Session : Screen("session")
    data object QrScan : Screen("qr-scan")
    data object Chat : Screen("chat/{sessionId}?worktreeId={worktreeId}") {
        fun createRoute(sessionId: String, worktreeId: String? = null): String {
            return if (worktreeId.isNullOrBlank()) {
                "chat/$sessionId"
            } else {
                "chat/$sessionId?worktreeId=$worktreeId"
            }
        }
    }
}

@Composable
fun Vibe80NavHost(
    navController: NavHostController = rememberNavController(),
    pendingNotification: NotificationRoute? = null,
    onNotificationHandled: () -> Unit = {}
) {
    pendingNotification?.let { notification ->
        androidx.compose.runtime.LaunchedEffect(notification) {
            navController.navigate(
                Screen.Chat.createRoute(notification.sessionId, notification.worktreeId)
            ) {
                launchSingleTop = true
                popUpTo(Screen.Session.route) { inclusive = false }
            }
            onNotificationHandled()
        }
    }

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

        composable(
            Screen.Chat.route,
            arguments = listOf(
                navArgument("worktreeId") {
                    nullable = true
                    defaultValue = null
                }
            )
        ) { backStackEntry ->
            val sessionId = backStackEntry.arguments?.getString("sessionId") ?: return@composable
            val worktreeId = backStackEntry.arguments?.getString("worktreeId")
            ChatScreen(
                sessionId = sessionId,
                initialWorktreeId = worktreeId,
                onDisconnect = {
                    navController.navigate(Screen.Session.route) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
    }
}
