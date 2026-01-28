package app.m5chat.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import app.m5chat.android.R

val SpaceGrotesk = FontFamily(
    Font(R.font.space_grotesk_wght, weight = FontWeight.Normal),
    Font(R.font.space_grotesk_wght, weight = FontWeight.Medium),
    Font(R.font.space_grotesk_wght, weight = FontWeight.SemiBold),
    Font(R.font.space_grotesk_wght, weight = FontWeight.Bold)
)

private val BaseTypography = Typography(defaultFontFamily = SpaceGrotesk)

val AppTypography = Typography(
    displayLarge = BaseTypography.displayLarge,
    displayMedium = BaseTypography.displayMedium,
    displaySmall = BaseTypography.displaySmall,
    headlineLarge = BaseTypography.headlineLarge,
    headlineMedium = BaseTypography.headlineMedium,
    headlineSmall = BaseTypography.headlineSmall,
    titleLarge = BaseTypography.titleLarge,
    titleMedium = BaseTypography.titleMedium,
    titleSmall = BaseTypography.titleSmall,
    bodyLarge = BaseTypography.bodyLarge.copy(fontWeight = FontWeight.Medium),
    bodyMedium = BaseTypography.bodyMedium.copy(fontWeight = FontWeight.Medium),
    bodySmall = BaseTypography.bodySmall.copy(fontWeight = FontWeight.Medium),
    labelLarge = BaseTypography.labelLarge.copy(fontWeight = FontWeight.Medium),
    labelMedium = BaseTypography.labelMedium.copy(fontWeight = FontWeight.Medium),
    labelSmall = BaseTypography.labelSmall.copy(fontWeight = FontWeight.Medium)
)
