package com.akusera.mikuplayreburn.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = Color(0xFFFF6699),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFFD1E0),
    onPrimaryContainer = Color(0xFF8A1A44),
    secondary = Color(0xFF39C5BB),
    onSecondary = Color.White,
    surface = Color(0xFFF5F5F5),
    onSurface = Color(0xFF212121),
    onSurfaceVariant = Color(0xFF616161),
    surfaceVariant = Color(0xFFE0E0E0),
    outlineVariant = Color(0xFFBDBDBD),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFFF6699),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF8A1A44),
    onPrimaryContainer = Color(0xFFFFD1E0),
    secondary = Color(0xFF39C5BB),
    onSecondary = Color.White,
    surface = Color(0xFF242424),
    onSurface = Color(0xFFE6E6E6),
    onSurfaceVariant = Color(0xFFB3B3B3),
    surfaceVariant = Color(0xFF333333),
    outlineVariant = Color(0xFF616161),
)

@Composable
fun OnboardingTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    MaterialTheme(
        colorScheme = colorScheme,
        typography = MaterialTheme.typography,
        content = content,
    )
}
