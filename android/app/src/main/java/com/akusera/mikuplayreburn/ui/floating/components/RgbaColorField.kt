package com.akusera.mikuplayreburn.ui.floating.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import kotlin.math.roundToInt

/**
 * 颜色字段 — Android 端复刻前端 `src/UIComponents/shared/RGBColorPicker.ts`（popup 模式）。
 *
 * 布局与前端逐像素对齐：
 * - 一行包装：左侧文本标签（默认"颜色"）+ 右侧颜色预览框；
 * - 点击预览框弹出调整面板（Popup 实现，**不会压暗背景**，与前端注释掉的 overlay 背景一致）；
 * - 面板内含 R/G/B/A 四条渐变滑轨（黑→通道色、A 为透明→灰）、HEX 输入框（背景随当前颜色变化、
 *   文字按亮度自动黑/白）、"确定"按钮（点击仅关闭面板，颜色实时回调）。
 *
 * 颜色全部取自前端 `src/styles/theme.ts` 的明暗两套主题值（accent #FF6699 等），
 * 组件自包含、不依赖外层 MaterialTheme 配色，便于在悬浮窗等场景直接使用。
 *
 * 当前处于高速迭代阶段，API 允许破坏性调整。
 *
 * @param label         左侧文本，默认 "颜色"
 * @param color         当前颜色（受控值，含 alpha）
 * @param onColorChange 颜色变化回调（滑轨拖动 / HEX 输入时实时触发）
 * @param modifier      外部修饰符
 * @param showAlpha     是否在面板中显示 A 通道滑轨，默认 true
 */
@Composable
fun RgbaColorField(
    label: String = "颜色",
    color: Color,
    onColorChange: (Color) -> Unit,
    modifier: Modifier = Modifier,
    showAlpha: Boolean = true,
) {
    val palette = if (isSystemInDarkTheme()) DarkPalette else LightPalette
    var popupVisible by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // ── 左侧标签 ──
            Text(
                text = label,
                color = palette.textSecondary,
                fontSize = 13.sp,
                maxLines = 1,
            )

            // ── 右侧预览框（40x30，圆角 6，边框 2，点击弹面板）──
            Box(
                modifier = Modifier
                    .size(width = 40.dp, height = 30.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(rgbOf(color))
                    .border(2.dp, palette.border, RoundedCornerShape(6.dp))
                    .clickable { popupVisible = true },
            )
        }

        // ── 调整面板：Popup 不产生背景遮罩 ──
        if (popupVisible) {
            Popup(
                alignment = Alignment.Center,
                onDismissRequest = { popupVisible = false },
            ) {
                RgbaAdjustPanel(
                    color = color,
                    onColorChange = onColorChange,
                    showAlpha = showAlpha,
                    onConfirm = { popupVisible = false },
                    palette = palette,
                )
            }
        }
    }
}

// ============================================================================
// 调整面板
// ============================================================================

@Composable
private fun RgbaAdjustPanel(
    color: Color,
    onColorChange: (Color) -> Unit,
    showAlpha: Boolean,
    onConfirm: () -> Unit,
    palette: RgbaPalette,
) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier = Modifier
            .shadow(8.dp, shape, spotColor = Color.Black.copy(alpha = 0.2f))
            .widthIn(min = 240.dp)
            .clip(shape)
            .background(palette.surface)
            .border(1.dp, palette.border, shape)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // R / G / B 三条滑轨：渐变 黑 → 通道色
        ChannelSliderRow(
            letter = "R",
            letterColor = palette.axisX,
            trackBrush = Brush.horizontalGradient(listOf(Color.Black, palette.axisX)),
            thumbColor = palette.axisX,
            value = (color.red * 255).roundToInt(),
            onChange = { onColorChange(color.copy(red = it / 255f)) },
            palette = palette,
        )
        ChannelSliderRow(
            letter = "G",
            letterColor = palette.axisY,
            trackBrush = Brush.horizontalGradient(listOf(Color.Black, palette.axisY)),
            thumbColor = palette.axisY,
            value = (color.green * 255).roundToInt(),
            onChange = { onColorChange(color.copy(green = it / 255f)) },
            palette = palette,
        )
        ChannelSliderRow(
            letter = "B",
            letterColor = palette.axisZ,
            trackBrush = Brush.horizontalGradient(listOf(Color.Black, palette.axisZ)),
            thumbColor = palette.axisZ,
            value = (color.blue * 255).roundToInt(),
            onChange = { onColorChange(color.copy(blue = it / 255f)) },
            palette = palette,
        )

        // A 通道：渐变 透明 → 禁用文字色
        if (showAlpha) {
            ChannelSliderRow(
                letter = "A",
                letterColor = palette.alphaGray,
                trackBrush = Brush.horizontalGradient(listOf(Color.Transparent, palette.textDisabled)),
                thumbColor = palette.alphaGray,
                value = (color.alpha * 255).roundToInt(),
                onChange = { onColorChange(color.copy(alpha = it / 255f)) },
                palette = palette,
            )
        }

        // HEX 输入行
        HexRow(color = color, onColorChange = onColorChange, palette = palette)

        // 确定按钮（仅关闭面板）
        ConfirmButton(onClick = onConfirm, palette = palette)
    }
}

// ============================================================================
// 通道滑轨（复刻前端 input[type=range]：渐变轨道 + 白边圆形滑块）
// ============================================================================

private val THUMB_SIZE = 18.dp

@Composable
private fun ChannelSliderRow(
    letter: String,
    letterColor: Color,
    trackBrush: Brush,
    thumbColor: Color,
    value: Int,
    onChange: (Int) -> Unit,
    palette: RgbaPalette,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // 通道字母
        Text(
            text = letter,
            color = letterColor,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.width(20.dp),
        )

        // 滑轨（可点击 / 拖动）
        BoxWithConstraints(
            modifier = Modifier
                .weight(1f)
                .height(24.dp)
                .pointerInput(Unit) {
                    val trackWidthPx = size.width.toFloat()
                    fun fractionFromX(x: Float): Float {
                        val thumbPx = THUMB_SIZE.toPx()
                        val usable = trackWidthPx - thumbPx
                        if (usable <= 0f) return 0f
                        return ((x - thumbPx / 2f) / usable).coerceIn(0f, 1f)
                    }
                    // 点击轨道直接跳值，拖动连续调节
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        onChange((fractionFromX(down.position.x) * 255).roundToInt())
                        var dragging = false
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (change.changedToUp()) break
                            if (change.isConsumed) continue
                            if (!dragging) {
                                // 越过触摸滑动阈值后进入拖动态
                                if (change.positionChange().getDistance() > viewConfiguration.touchSlop) {
                                    dragging = true
                                } else {
                                    continue
                                }
                            }
                            change.consume()
                            onChange((fractionFromX(change.position.x) * 255).roundToInt())
                        }
                    }
                },
        ) {
            val trackFraction = value / 255f
            val thumbOffsetPx = with(LocalDensity.current) {
                ((maxWidth - THUMB_SIZE) * trackFraction).toPx()
            }

            // 渐变轨道
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .align(Alignment.CenterStart)
                    .clip(RoundedCornerShape(3.dp))
                    .background(trackBrush),
            )

            // 白色描边圆形滑块
            Box(
                modifier = Modifier
                    .size(THUMB_SIZE)
                    .align(Alignment.CenterStart)
                    .offset { IntOffset(thumbOffsetPx.roundToInt(), 0) }
                    .background(thumbColor, CircleShape)
                    .border(2.dp, Color.White, CircleShape),
            )
        }

        // 数值显示（等宽字体，底色 = 面板背景）
        Box(
            modifier = Modifier
                .widthIn(min = 36.dp)
                .background(palette.bg, RoundedCornerShape(6.dp))
                .padding(horizontal = 8.dp, vertical = 4.dp),
            contentAlignment = Alignment.CenterEnd,
        ) {
            Text(
                text = value.toString(),
                color = palette.textSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                fontFamily = FontFamily.Monospace,
                textAlign = TextAlign.End,
            )
        }
    }
}

// ============================================================================
// HEX 输入行（背景 = 当前颜色，文字按亮度黑白自适应）
// ============================================================================

@Composable
private fun HexRow(
    color: Color,
    onColorChange: (Color) -> Unit,
    palette: RgbaPalette,
) {
    var text by remember { mutableStateOf(rgbToHex(color)) }

    // 外部颜色变化（滑轨拖动）时同步 HEX 文本
    LaunchedEffect(color) { text = rgbToHex(color) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "HEX",
            color = palette.textSecondary,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
        )

        val textColor = if (luminance(color) > 0.5f) Color.Black else Color.White
        val interactionSource = remember { MutableInteractionSource() }
        val focused by interactionSource.collectIsFocusedAsState()

        BasicTextField(
            value = text,
            onValueChange = { newText ->
                val filtered = newText
                    .filter { it.isDigit() || it.lowercaseChar() in 'a'..'f' }
                    .uppercase()
                    .take(6)
                text = filtered
                if (filtered.length == 6) {
                    val rgb = parseHex(filtered)
                    onColorChange(color.copy(red = rgb.first, green = rgb.second, blue = rgb.third))
                }
            },
            textStyle = TextStyle(
                color = textColor,
                fontSize = 13.sp,
                fontFamily = FontFamily.Monospace,
                textAlign = TextAlign.Center,
            ),
            singleLine = true,
            cursorBrush = SolidColor(textColor),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            modifier = Modifier
                .weight(1f)
                .background(rgbOf(color), RoundedCornerShape(6.dp))
                .border(
                    width = 1.dp,
                    color = if (focused) palette.accent else palette.border,
                    shape = RoundedCornerShape(6.dp),
                )
                .padding(vertical = 6.dp, horizontal = 10.dp),
        )
    }
}

// ============================================================================
// 确定按钮
// ============================================================================

@Composable
private fun ConfirmButton(onClick: () -> Unit, palette: RgbaPalette) {
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.98f else 1f,
        label = "confirmScale",
    )

    Box(
        modifier = Modifier
            .scale(scale)
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(palette.accent)
            .clickable(interactionSource = interactionSource, indication = null, onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "确定",
            color = Color.White,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
        )
    }
}

// ============================================================================
// 调色板（严格取色自前端 src/styles/theme.ts）
// ============================================================================

private data class RgbaPalette(
    val accent: Color,
    val bg: Color,
    val surface: Color,
    val border: Color,
    val textSecondary: Color,
    val textDisabled: Color,
    val axisX: Color,
    val axisY: Color,
    val axisZ: Color,
    val alphaGray: Color,
)

private val LightPalette = RgbaPalette(
    accent = Color(0xFFFF6699),
    bg = Color(0xFFF5F5F5),
    surface = Color(0xFFFFFFFF),
    border = Color(0xFFE0E0E0),
    textSecondary = Color(0xFF616161),
    textDisabled = Color(0xFFBDBDBD),
    axisX = Color(0xFFEF4444),
    axisY = Color(0xFF22C55E),
    axisZ = Color(0xFF3B82F6),
    alphaGray = Color(0xFFBBBBBB),
)

private val DarkPalette = RgbaPalette(
    accent = Color(0xFFFF6699),
    bg = Color(0xFF242424),
    surface = Color(0xFF3B3B3B),
    border = Color(0x1FFFFFFF),          // rgba(255,255,255,0.12)
    textSecondary = Color(0xB3FFFFFF),  // rgba(255,255,255,0.7)
    textDisabled = Color(0x61FFFFFF),   // rgba(255,255,255,0.38)
    axisX = Color(0xFFEF4444),
    axisY = Color(0xFF22C55E),
    axisZ = Color(0xFF3B82F6),
    alphaGray = Color(0xFFBBBBBB),
)

// ============================================================================
// 颜色工具
// ============================================================================

/** 去掉 alpha，仅保留 RGB（与前端预览块一致） */
private fun rgbOf(color: Color): Color = Color(color.red, color.green, color.blue)

/** 输出 6 位大写 HEX（不含 #） */
private fun rgbToHex(color: Color): String = String.format(
    "%02X%02X%02X",
    (color.red * 255).roundToInt(),
    (color.green * 255).roundToInt(),
    (color.blue * 255).roundToInt(),
)

/** 解析 6 位 HEX，返回 (r, g, b) 各 0..1 */
private fun parseHex(hex: String): Triple<Float, Float, Float> = Triple(
    hex.substring(0, 2).toInt(16) / 255f,
    hex.substring(2, 4).toInt(16) / 255f,
    hex.substring(4, 6).toInt(16) / 255f,
)

/** 亮度（与前端 updateHexInputBg 相同的加权公式） */
private fun luminance(color: Color): Float =
    0.299f * color.red + 0.587f * color.green + 0.114f * color.blue

// ============================================================================
// Preview
// ============================================================================

@Preview(showBackground = true, widthDp = 320, name = "RgbaColorField - Light")
@Composable
private fun RgbaColorFieldPreviewLight() {
    MaterialTheme {
        var color by remember { mutableStateOf(Color(0xFFFF6699)) }
        RgbaColorField(
            label = "颜色",
            color = color,
            onColorChange = { color = it },
        )
    }
}

@Preview(showBackground = true, widthDp = 320, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES, name = "RgbaColorField - Dark")
@Composable
private fun RgbaColorFieldPreviewDark() {
    MaterialTheme {
        var color by remember { mutableStateOf(Color(0xFF39C5BB)) }
        RgbaColorField(
            label = "颜色",
            color = color,
            onColorChange = { color = it },
        )
    }
}
