package app.vibe80.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.runtime.mutableStateOf
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.vibe80.android.notifications.MessageNotifier
import app.vibe80.android.ui.navigation.Vibe80NavHost
import app.vibe80.android.ui.theme.Vibe80Theme

class MainActivity : ComponentActivity() {
    private val notificationRoute = mutableStateOf<NotificationRoute?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestNotificationPermissionIfNeeded()
        notificationRoute.value = parseNotificationIntent(intent)

        setContent {
            Vibe80Theme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    Vibe80NavHost(
                        pendingNotification = notificationRoute.value,
                        onNotificationHandled = { notificationRoute.value = null }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        notificationRoute.value = parseNotificationIntent(intent)
    }

    private fun parseNotificationIntent(intent: Intent?): NotificationRoute? {
        val sessionId = intent?.getStringExtra(MessageNotifier.EXTRA_SESSION_ID)?.takeIf { it.isNotBlank() }
            ?: return null
        val worktreeId = intent.getStringExtra(MessageNotifier.EXTRA_WORKTREE_ID)?.takeIf { it.isNotBlank() }
        return NotificationRoute(sessionId, worktreeId)
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED
        ) return
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            NOTIFICATION_PERMISSION_REQUEST_CODE
        )
    }

    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001
    }
}

data class NotificationRoute(
    val sessionId: String,
    val worktreeId: String?
)
