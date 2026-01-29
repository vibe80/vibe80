package app.m5chat.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import app.m5chat.android.R

val SpaceGrotesk = FontFamily(
    Font(R.font.space_grotesk_wght, weight = FontWeight.Normal),
    Font(R.font.space_grotesk_wght, weight = FontWeight.Bold)
)

private val BaseTypography = Typography()

val AppTypography = Typography(
    displayLarge = BaseTypography.displayLarge.copy(fontFamily = SpaceGrotesk),
    displayMedium = BaseTypography.displayMedium.copy(fontFamily = SpaceGrotesk),
    displaySmall = BaseTypography.displaySmall.copy(fontFamily = SpaceGrotesk),
    headlineLarge = BaseTypography.headlineLarge.copy(fontFamily = SpaceGrotesk),
    headlineMedium = BaseTypography.headlineMedium.copy(fontFamily = SpaceGrotesk),
    headlineSmall = BaseTypography.headlineSmall.copy(fontFamily = SpaceGrotesk),
    titleLarge = BaseTypography.titleLarge.copy(fontFamily = SpaceGrotesk),
    titleMedium = BaseTypography.titleMedium.copy(fontFamily = SpaceGrotesk),
    titleSmall = BaseTypography.titleSmall.copy(fontFamily = SpaceGrotesk),
    bodyLarge = BaseTypography.bodyLarge.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Normal),
    bodyMedium = BaseTypography.bodyMedium.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Normal),
    bodySmall = BaseTypography.bodySmall.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Normal),
    labelLarge = BaseTypography.labelLarge.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Normal),
    labelMedium = BaseTypography.labelMedium.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Normal),
    labelSmall = BaseTypography.labelSmall.copy(fontFamily = SpaceGrotesk, fontWeight = FontWeight.Normal)
)
