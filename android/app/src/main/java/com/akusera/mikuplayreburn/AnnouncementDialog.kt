package com.akusera.mikuplayreburn

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.view.ViewGroup
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

private const val TAG = "AnnouncementDialog"

// ============================================================================
// AnnouncementLauncher — 公告显示入口（供 Java 层调用）
// ============================================================================

/**
 * 公告显示流程入口。
 *
 * 在后台线程加载公告，加载完成后在主线程通过 Compose Dialog 逐个显示。
 * 全程不阻塞 UI，出错时静默跳过（不影响应用启动）。
 *
 * 用法（Java）：`AnnouncementLauncher.show(this);`
 */
object AnnouncementLauncher {
    private const val TAG = "AnnouncementLauncher"

    /**
     * 启动公告显示流程。
     *
     * 在后台线程执行完整流程：
     * 1. syncIfNeeded() — BJT 00:00 界限检查，从 Git Raw 同步在线公告
     * 2. getVisibleAnnouncements() — 加载可显示公告（含本地 + 远程同步）
     * 3. 主线程逐个显示 Compose Dialog
     *
     * 全程不阻塞 UI，出错时静默跳过（不影响应用启动）。
     * 同步失败时使用本地缓存内容显示公告。
     *
     * @param activity   宿主 Activity（需为 ComponentActivity 子类以支持 Compose）
     * @param onComplete 公告流程结束回调（无公告 / 全部关闭 / 加载出错 均在主线程触发），
     *                   可为 null。用于让调用方在公告遮罩消失后再展示依赖全屏观察的 UI。
     */
    @JvmOverloads
    @JvmStatic
    fun show(activity: Activity, onComplete: Runnable? = null) {
        // 后台线程执行同步 + 加载，避免阻塞主线程
        Thread {
            // 1. 检查并执行远程同步（BJT 00:00 界限，失败不影响显示）
            try {
                AnnouncementBridge.syncIfNeeded(activity)
            } catch (e: Exception) {
                Log.w(TAG, "远程同步失败，使用缓存", e)
            }

            // 3. 加载可显示公告
            val announcements = try {
                AnnouncementBridge.getVisibleAnnouncements(activity)
            } catch (e: Exception) {
                Log.e(TAG, "加载公告失败", e)
                emptyList()
            }

            // 无公告：主线程触发回调后直接结束
            if (announcements.isEmpty()) {
                activity.runOnUiThread { onComplete?.run() }
                return@Thread
            }

            // 4. 主线程显示 Compose Dialog
            activity.runOnUiThread {
                showAnnouncementDialogs(activity, announcements, onComplete)
            }
        }.start()
    }

    /**
     * 创建 ComposeView 承载公告对话框，添加到 Activity 内容视图。
     * 所有公告关闭后自动移除 ComposeView，并触发 [onComplete]。
     */
    private fun showAnnouncementDialogs(
        activity: Activity,
        announcements: List<AnnouncementItem>,
        onComplete: Runnable? = null,
    ) {
        val contentView = activity.findViewById<ViewGroup>(android.R.id.content)
        val composeView = ComposeView(activity).apply {
            setContent {
                AnnouncementTheme {
                    AnnouncementDialogHost(
                        announcements = announcements,
                        onAllDismissed = {
                            // 主线程移除 ComposeView
                            (parent as? ViewGroup)?.removeView(this)
                            // 通知调用方公告流程已结束
                            onComplete?.run()
                        },
                    )
                }
            }
        }
        // ComposeView 作为透明宿主，不占用布局空间
        composeView.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        contentView.addView(composeView)
    }
}

/**
 * 公告对话框主题 — 根据系统深色模式自动切换配色。
 */
@Composable
private fun AnnouncementTheme(content: @Composable () -> Unit) {
    val darkTheme = isSystemInDarkTheme()
    val colorScheme = if (darkTheme) darkColorScheme() else lightColorScheme()
    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}

/**
 * 公告对话框宿主 — 管理公告队列，逐个显示。
 *
 * 由 [MainActivity] 通过 ComposeView 调用。公告按 priority 降序（C++ 侧已排序）逐个显示，
 * 当前公告关闭后自动显示下一个。
 *
 * @param announcements 待显示的公告列表（已排序）
 * @param onAllDismissed 所有公告关闭后的回调（通知 MainActivity 清理 ComposeView）
 */
@Composable
fun AnnouncementDialogHost(
    announcements: List<AnnouncementItem>,
    onAllDismissed: () -> Unit,
) {
    var currentIndex by remember { mutableStateOf(0) }

    if (currentIndex >= announcements.size) {
        // 使用 LaunchedEffect 避免在组合过程中产生副作用
        LaunchedEffect(Unit) { onAllDismissed() }
        return
    }

    val announcement = announcements[currentIndex]
    val context = LocalContext.current
    AnnouncementDialog(
        announcement = announcement,
        onDismiss = { dontShowAgain ->
            if (dontShowAgain) {
                AnnouncementBridge.markDontShow(context, announcement.id)
            }
            currentIndex++
        },
    )
}

/**
 * 单条公告对话框 — Material3 风格，原生渲染（不经过 WebView）。
 *
 * 布局：标题 → 可滚动正文（简化 Markdown）→ 底部控件区。
 * 响应式：在大屏设备上限制最大宽度，正文区限制最大高度并支持滚动。
 */
@Composable
private fun AnnouncementDialog(
    announcement: AnnouncementItem,
    onDismiss: (dontShowAgain: Boolean) -> Unit,
) {
    Dialog(
        onDismissRequest = { onDismiss(false) },
        properties = DialogProperties(
            dismissOnBackPress = true,
            dismissOnClickOutside = false,
        ),
    ) {
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 6.dp,
            modifier = Modifier
                .widthIn(max = 480.dp)
                .fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier.padding(start = 24.dp, top = 24.dp, end = 24.dp, bottom = 8.dp),
            ) {
                // ── 标题 ──
                Text(
                    text = announcement.title,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                // 日期（可选）
                announcement.date?.takeIf { it.isNotEmpty() }?.let { date ->
                    Spacer(modifier = Modifier.padding(top = 4.dp))
                    Text(
                        text = date,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Spacer(modifier = Modifier.padding(top = 6.dp))

                // ── 正文（可滚动）──
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    MarkdownContent(content = announcement.content)
                }

                // ── 底部控件区 ──
                AnnouncementControls(
                    announcement = announcement,
                    onDismiss = onDismiss,
                )
            }
        }
    }
}

/**
 * 简化 Markdown 渲染器。
 *
 * 支持的语法（与 C++ MkaParser 的 CONTENT 段对应）：
 * - `# 标题` → headlineSmall
 * - `## 标题` → titleMedium
 * - `### 标题` → titleSmall
 * - `- 项目` → 无序列表
 * - `1. 项目` → 有序列表
 * - 空行 → 段落间距
 * - 纯文本 → bodyMedium
 *
 * 不支持图片、链接、HTML、代码块、粗体/斜体（安全考虑）。
 */
@Composable
fun MarkdownContent(content: String) {
    if (content.isEmpty()) return

    val lines = content.lines()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        when {
            line.startsWith("### ") -> {
                Spacer(modifier = Modifier.padding(top = 12.dp))
                Text(
                    text = line.removePrefix("### "),
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.padding(top = 4.dp))
            }
            line.startsWith("## ") -> {
                Spacer(modifier = Modifier.padding(top = 16.dp))
                Text(
                    text = line.removePrefix("## "),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.padding(top = 6.dp))
            }
            line.startsWith("# ") -> {
                Text(
                    text = line.removePrefix("# "),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.padding(top = 8.dp))
            }
            line.startsWith("- ") -> {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "•",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = line.removePrefix("- "),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            line.matches(Regex("^\\d+\\.\\s.*")) -> {
                val num = line.substringBefore(".")
                val text = line.substringAfter(". ")
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        text = "$num.",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = text,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            line.isBlank() -> {
                Spacer(modifier = Modifier.padding(top = 8.dp))
            }
            else -> {
                Text(
                    text = line,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    lineHeight = 20.sp,
                )
            }
        }
        i++
    }
}

/**
 * 底部控件渲染器。
 *
 * 根据 [AnnouncementItem.controls] 声明渲染：
 * - `dont_show_again` → "不再显示"复选框（独占一行）
 * - `action_url:<url>|<label>` → 打开 URL 的按钮（右对齐，支持多个）
 * - `action_close` → 关闭按钮（始终存在）
 * - `action_dismiss` → "知道了"按钮（语义不同于 close）
 *
 * 布局：Column 分两行 — 第一行复选框，第二行按钮区（右对齐 + 统一间距）。
 * 避免所有控件挤在单行导致窄屏溢出。
 */
@Composable
private fun AnnouncementControls(
    announcement: AnnouncementItem,
    onDismiss: (dontShowAgain: Boolean) -> Unit,
) {
    val context = LocalContext.current
    var dontShowAgain by remember { mutableStateOf(false) }

    val hasDontShow = announcement.controls.contains("dont_show_again")
    val actionUrls = announcement.controls.filter { it.startsWith("action_url:") }
    val hasDismiss = announcement.controls.contains("action_dismiss")

    Column(
        modifier = Modifier.fillMaxWidth(),
    ) {
        // ── Row 1: "不再显示"复选框（独占一行，避免与按钮拥挤）──
        if (hasDontShow) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp, bottom = 0.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(
                    checked = dontShowAgain,
                    onCheckedChange = { dontShowAgain = it },
                )
                Text(
                    text = "不再显示",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        // ── Row 2: 操作按钮行（右对齐，统一间距）──
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 0.dp, bottom = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // action_url 按钮
            actionUrls.forEach { control ->
                val parts = control.removePrefix("action_url:").split("|")
                val url = parts.getOrNull(0).orEmpty()
                val label = parts.getOrNull(1) ?: "打开链接"
                if (url.isNotEmpty()) {
                    OutlinedButton(
                        onClick = {
                            try {
                                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                context.startActivity(intent)
                            } catch (e: Exception) {
                                Log.w(TAG, "无法打开 URL: $url", e)
                            }
                        },
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text(label, maxLines = 1, softWrap = false)
                    }
                }
            }

            // 关闭/确认按钮（始终存在）
            Button(
                onClick = { onDismiss(dontShowAgain) },
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            ) {
                Text(if (hasDismiss) "知道了" else "关闭", maxLines = 1, softWrap = false)
            }
        }
    }
}
