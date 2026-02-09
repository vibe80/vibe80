package app.vibe80.android.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFEE5D3B),
    onPrimary = Color(0xFF0E0F0E),
    primaryContainer = Color(0xFF261A16),
    onPrimaryContainer = Color(0xFFF2EDE3),
    secondary = Color(0xFFD9573C),
    onSecondary = Color(0xFF0E0F0E),
    secondaryContainer = Color(0xFF1F2321),
    onSecondaryContainer = Color(0xFFF2EDE3),
    background = Color(0xFF0E0F0E),
    onBackground = Color(0xFFF2EDE3),
    surface = Color(0xFF171A19),
    onSurface = Color(0xFFF2EDE3),
    surfaceVariant = Color(0xFF1F2321),
    onSurfaceVariant = Color(0xFFB7ADA1),
    error = Color(0xFFCF6679),
    onError = Color(0xFF0E0F0E)
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFFEE5D3B),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFF6DBC7),
    onPrimaryContainer = Color(0xFF141311),
    secondary = Color(0xFFB43C24),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEFE9DC),
    onSecondaryContainer = Color(0xFF4B463F),
    background = Color(0xFFF5F2EA),
    onBackground = Color(0xFF141311),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF141311),
    surfaceVariant = Color(0xFFEFE9DC),
    onSurfaceVariant = Color(0xFF4B463F),
    error = Color(0xFFB00020),
    onError = Color(0xFFFFFFFF)
)

@Composable
fun Vibe80Theme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = Color.Transparent.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content
    )
}
