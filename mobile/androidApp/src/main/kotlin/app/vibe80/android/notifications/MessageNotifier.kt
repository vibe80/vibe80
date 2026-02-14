package app.vibe80.android.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.vibe80.android.MainActivity
import app.vibe80.android.R
import app.vibe80.shared.utils.NotificationSanitizer

class MessageNotifier(private val context: Context) {

    fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = CHANNEL_DESCRIPTION
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    fun canNotify(): Boolean {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return false
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    fun notifyMessage(title: String, body: String, sessionId: String?, worktreeId: String?) {
        val sanitizedBody = NotificationSanitizer.sanitizeForNotification(body)
        if (sanitizedBody.isBlank() || !canNotify()) return

        val notificationKey = listOf(title, sanitizedBody, sessionId.orEmpty(), worktreeId.orEmpty()).joinToString("|")
        val notificationId = notificationKey.hashCode()
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            action = "app.vibe80.NOTIFICATION_OPEN.$notificationId"
            putExtra(EXTRA_SESSION_ID, sessionId)
            putExtra(EXTRA_WORKTREE_ID, worktreeId)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(sanitizedBody)
            .setStyle(NotificationCompat.BigTextStyle().bigText(sanitizedBody))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        NotificationManagerCompat.from(context).notify(notificationId, notification)
    }

    companion object {
        const val CHANNEL_ID = "llm_messages"
        private const val CHANNEL_NAME = "Messages"
        private const val CHANNEL_DESCRIPTION = "Notifications quand un message arrive"
        const val EXTRA_SESSION_ID = "app.vibe80.extra.SESSION_ID"
        const val EXTRA_WORKTREE_ID = "app.vibe80.extra.WORKTREE_ID"
    }
}
