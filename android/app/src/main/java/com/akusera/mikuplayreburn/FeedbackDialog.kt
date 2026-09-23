package com.akusera.mikuplayreburn

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.view.ViewGroup
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

private const val TAG = "FeedbackDialog"

// ============================================================================
// 可配置项
// ============================================================================

/** 反馈页面 URL（可配置） */
private const val FEEDBACK_URL = "https://github.com/nicepkg/mikuplay"

/** 赞赏二维码在 DCIM 下的保存目录名 */
private const val QR_SAVE_DIR = "MikuPlay"

/** 赞赏二维码文件名 */
private const val QR_FILE_NAME = "mikuplay_qrcode.jpg"

// ============================================================================
// SharedPreferences 键名
// ============================================================================

private const val PREFS_NAME = "mikuplay_prefs"
private const val KEY_LAUNCH_COUNT = "feedback_launch_count"
private const val KEY_PERM_DISMISSED = "feedback_perm_dismissed"
private const val KEY_QR_SAVED = "feedback_qrcode_saved"

// ============================================================================
// 弹窗触发阈值
// ============================================================================

private const val FIRST_TRIGGER = 10
private const val SECOND_TRIGGER = 50

// ============================================================================
// FeedbackLauncher — 入口（供 Java 层调用）
// ============================================================================

/**
 * 反馈/赞赏功能入口。
 *
 * 在 MainActivity 的公告回调链中调用，确保不与公告对话框重叠。
 * 内部通过 SharedPreferences 管理启动计数与"永久忽略"状态。
 */
object FeedbackLauncher {
    private const val TAG = "FeedbackLauncher"

    /**
     * 检查是否应显示反馈对话框，若满足条件则显示。
     *
     * @param activity   宿主 Activity（需为 ComponentActivity 子类以支持 Compose）
     * @param onComplete 对话框关闭后的回调（主线程触发），可为 null。
     */
    @JvmStatic
    fun showIfDue(activity: Activity, onComplete: Runnable? = null) {
        val prefs = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        // 1. 累计启动次数
        val count = prefs.getInt(KEY_LAUNCH_COUNT, 0) + 1
        prefs.edit().putInt(KEY_LAUNCH_COUNT, count).apply()

        // 2. 检查"永久忽略"
        if (prefs.getBoolean(KEY_PERM_DISMISSED, false)) {
            Log.d(TAG, "反馈对话框已永久忽略 (count=$count)")
            onComplete?.run()
            return
        }

        // 3. 检查触发条件
        if (count != FIRST_TRIGGER && count != SECOND_TRIGGER) {
            Log.d(TAG, "未达触发阈值，跳过 (count=$count)")
            onComplete?.run()
            return
        }

        Log.i(TAG, "达到触发阈值 count=$count，显示反馈对话框")

        // 4. 主线程显示 Compose Dialog
        activity.runOnUiThread {
            showFeedbackDialog(activity, count, onComplete)
        }
    }

    private fun showFeedbackDialog(
        activity: Activity,
        launchCount: Int,
        onComplete: Runnable?,
    ) {
        val contentView = activity.findViewById<ViewGroup>(android.R.id.content)
        val composeView = ComposeView(activity).apply {
            setContent {
                FeedbackTheme {
                    FeedbackDialog(
                        launchCount = launchCount,
                        onDismiss = {
                            (parent as? ViewGroup)?.removeView(this)
                            onComplete?.run()
                        },
                    )
                }
            }
        }
        composeView.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
        contentView.addView(composeView)
    }
}

// ============================================================================
// Compose 主题
// ============================================================================

@Composable
private fun FeedbackTheme(content: @Composable () -> Unit) {
    val darkTheme = isSystemInDarkTheme()
    val colorScheme = if (darkTheme) darkColorScheme() else lightColorScheme()
    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}

// ============================================================================
// 保存状态枚举
// ============================================================================

/** "支持一下"按钮的保存状态 */
private enum class SaveState {
    /** 可以保存 */
    IDLE,
    /** 保存中 */
    SAVING,
    /** 已保存（本次或历史已保存） */
    SAVED,
}

// ============================================================================
// Compose 对话框
// ============================================================================

/**
 * 反馈/赞赏对话框 — Material3 风格。
 *
 * 布局：标题 → 正文 → 底部三按钮行（忽略 / 反馈 / 支持一下）。
 * 不可通过点击外部关闭，只能通过按钮操作。
 *
 * @param launchCount 当前启动次数（用于判断"忽略"是否触发永久忽略）
 * @param onDismiss   对话框关闭回调（用户点击"忽略"或完成操作后）
 */
@Composable
private fun FeedbackDialog(
    launchCount: Int,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var saveState by remember { mutableStateOf(SaveState.IDLE) }

    // Android 9 存储权限请求 launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            scope.launch { performSave(context) { saveState = it } }
        } else {
            Toast.makeText(context, "需要存储权限才能保存赞赏码", Toast.LENGTH_SHORT).show()
        }
    }

    // 初始化：检查是否已保存过
    val prefs = remember { context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }
    if (prefs.getBoolean(KEY_QR_SAVED, false) && saveState == SaveState.IDLE) {
        saveState = SaveState.SAVED
    }

    Dialog(
        onDismissRequest = { /* 禁止外部点击关闭 */ },
        properties = DialogProperties(
            dismissOnBackPress = false,
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
                modifier = Modifier.padding(
                    start = 24.dp, top = 24.dp, end = 24.dp, bottom = 16.dp
                ),
            ) {
                // ─ 标题 ──
                Text(
                    text = "感谢您使用本软件",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                // ── 正文 ──
                Text(
                    text = "您觉得MikuPlay Reburn怎么样?\n" +
                            "如果您在使用过程中遇到任何问题，欢迎随时反馈。\n" +
                            "软件由个人独立开发维护，开发不易。\n" +
                            "如果觉得不错，可以考虑支持一下，您的鼓励是我持续改进的动力。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 12.dp),
                    lineHeight = 22.sp,
                )

                // ── 底部按钮行 ──
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 20.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // 忽略（靠左）
                    OutlinedButton(
                        onClick = {
                            // 第 50 次启动时"忽略"标记为永久忽略
                            if (launchCount >= SECOND_TRIGGER) {
                                prefs.edit()
                                    .putBoolean(KEY_PERM_DISMISSED, true)
                                    .apply()
                                Log.i(TAG, "已标记为永久忽略")
                            }
                            onDismiss()
                        },
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text("忽略", maxLines = 1, softWrap = false)
                    }

                    // 右侧按钮组（靠右对齐）
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // 我要反馈
                        OutlinedButton(
                            onClick = {
                                try {
                                    // 调用 QQ 加群功能（群号：471226496）
                                    val qqGroupKey = BuildConfig.QQ_GROUP_KEY
                                    val intent = android.content.Intent().apply {
                                        data = Uri.parse(
                                            "mqqopensdkapi://bizAgent/qm/qr?url=http%3A%2F%2Fqm.qq.com%2Fcgi-bin%2Fqm%2Fqr%3Ffrom%3Dapp%26p%3Dandroid%26jump_from%3Dwebapi%26k%3D$qqGroupKey"
                                        )
                                    }
                                    context.startActivity(intent)
                                } catch (e: Exception) {
                                    Log.w(TAG, "无法打开 QQ 加群页面，请确认已安装 QQ", e)
                                    Toast.makeText(context, "请先安装 QQ 客户端", Toast.LENGTH_SHORT).show()
                                }
                            },
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        ) {
                            Text("我要反馈", maxLines = 1, softWrap = false)
                        }

                        // 鼓励一下
                        Button(
                            onClick = {
                                when (saveState) {
                                    SaveState.IDLE -> {
                                        // Android 9 需要运行时权限
                                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                                            && !hasWritePermission(context)
                                        ) {
                                            permissionLauncher.launch(
                                                Manifest.permission.WRITE_EXTERNAL_STORAGE
                                            )
                                        } else {
                                            scope.launch {
                                                performSave(context) { saveState = it }
                                            }
                                        }
                                    }
                                    SaveState.SAVED -> {
                                        // 已保存，按钮变为关闭对话框
                                        onDismiss()
                                    }
                                    SaveState.SAVING -> { /* 保存中，忽略点击 */ }
                                }
                            },
                            enabled = saveState != SaveState.SAVING,
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        ) {
                            if (saveState == SaveState.SAVING) {
                                CircularProgressIndicator(
                                    modifier = Modifier
                                        .padding(end = 8.dp)
                                        .widthIn(16.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary,
                                )
                                Text("保存中")
                            } else if (saveState == SaveState.SAVED) {
                                Text("关闭")
                            } else {
                                Text("鼓励一下")
                            }
                        }
                    }
                }
            }
        }
    }
}

// ============================================================================
// Preview
// ============================================================================

@Preview(showBackground = true, name = "Feedback Dialog - Light")
@Composable
private fun FeedbackDialogPreviewLight() {
    FeedbackTheme {
        FeedbackDialogContent(launchCount = FIRST_TRIGGER)
    }
}

@Preview(showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES, name = "Feedback Dialog - Dark")
@Composable
private fun FeedbackDialogPreviewDark() {
    FeedbackTheme {
        FeedbackDialogContent(launchCount = SECOND_TRIGGER)
    }
}

/**
 * 对话框内容体（不含 Dialog 窗口包裹），便于 Preview 渲染。
 */
@Composable
private fun FeedbackDialogContent(launchCount: Int) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 6.dp,
        modifier = Modifier
            .widthIn(max = 480.dp)
            .fillMaxWidth(),
    ) {
        Column(
            modifier = Modifier.padding(
                start = 24.dp, top = 24.dp, end = 24.dp, bottom = 16.dp
            ),
        ) {
            Text(
                text = "感谢您使用本软件",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Medium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "您觉得MikuPlay Reburn怎么样?\n" +
                        "如果您在使用过程中遇到任何问题，欢迎随时反馈。\n" +
                        "软件由个人独立开发维护，开发不易。\n" +
                        "如果觉得不错，可以考虑支持一下，您的鼓励是我持续改进的动力。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 12.dp),
                lineHeight = 22.sp,
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 20.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedButton(
                    onClick = {},
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Text("忽略", maxLines = 1, softWrap = false)
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedButton(
                        onClick = {},
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text("我要反馈", maxLines = 1, softWrap = false)
                    }
                    Button(
                        onClick = {},
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    ) {
                        Text("鼓励一下")
                    }
                }
            }
        }
    }
}

// ============================================================================
// 辅助方法
// ============================================================================

/** 检查是否已获得写入外部存储权限（仅 Android 9 需要） */
private fun hasWritePermission(context: Context): Boolean {
    return ContextCompat.checkSelfPermission(
        context, Manifest.permission.WRITE_EXTERNAL_STORAGE
    ) == PackageManager.PERMISSION_GRANTED
}

/**
 * 执行二维码保存流程（IO 操作在 IO 调度器）。
 *
 * 流程：解码 → 检查重复 → 保存 → 标记 → Toast。
 * 保存成功后弹出合并 Toast："赞赏码已释放\n微信扫一扫支持开发"。
 */
private suspend fun performSave(
    context: Context,
    onStateChanged: (SaveState) -> Unit,
) {
    onStateChanged(SaveState.SAVING)

    val success = withContext(Dispatchers.IO) {
        try {
            val bitmap = FeedbackBridge.getQrCodeBitmap()
            if (bitmap == null) {
                Log.e(TAG, "二维码 Bitmap 解码失败")
                return@withContext false
            }

            val saved = saveQrCodeToDCIM(context, bitmap)
            if (saved) {
                // 标记已保存（用于去重）
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_QR_SAVED, true)
                    .apply()
            }
            saved
        } catch (e: Exception) {
            Log.e(TAG, "保存赞赏码失败", e)
            false
        }
    }

    if (success) {
        onStateChanged(SaveState.SAVED)
        Toast.makeText(
            context,
            "微信赞赏码已释放到相册",
            Toast.LENGTH_LONG,
        ).show()
    } else {
        onStateChanged(SaveState.IDLE)
        Toast.makeText(context, "保存失败，请重试", Toast.LENGTH_SHORT).show()
    }
}

/**
 * 将二维码 Bitmap 保存到系统 DCIM 目录。
 *
 * 按 Android 版本分支处理：
 * - Android 10+：使用 MediaStore + IS_PENDING 机制
 * - Android 9：使用 Environment.getExternalStoragePublicDirectory + 传统文件 I/O
 *
 * 幂等：若 SharedPreferences 已标记 KEY_QR_SAVED，调用前应已跳过。
 *
 * @return true 保存成功
 */
private fun saveQrCodeToDCIM(context: Context, bitmap: Bitmap): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        saveViaMediaStore(context, bitmap)
    } else {
        saveViaLegacyStorage(context, bitmap)
    }
}

/** Android 10+ 使用 MediaStore 保存（无需写权限） */
private fun saveViaMediaStore(context: Context, bitmap: Bitmap): Boolean {
    val resolver = context.contentResolver

    // 幂等检查：MediaStore 中是否已存在同名文件
    val existingUri = findExistingQrCode(context)
    if (existingUri != null) {
        Log.d(TAG, "赞赏码已存在于 MediaStore: $existingUri")
        return true
    }

    val contentValues = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, QR_FILE_NAME)
        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        put(MediaStore.Images.Media.RELATIVE_PATH, "DCIM/$QR_SAVE_DIR")
        put(MediaStore.Images.Media.IS_PENDING, 1)
    }

    val uri = resolver.insert(
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
        contentValues,
    ) ?: run {
        Log.e(TAG, "MediaStore.insert 返回 null")
        return false
    }

    val written = try {
        resolver.openOutputStream(uri)?.use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)
        } ?: false
    } catch (e: Exception) {
        Log.e(TAG, "写入 MediaStore 失败", e)
        // 写入失败时清理已插入的空记录
        try { resolver.delete(uri, null, null) } catch (_: Exception) {}
        false
    }

    if (written) {
        // 取消 pending 标记，使图片对其他媒体应用可见
        contentValues.clear()
        contentValues.put(MediaStore.Images.Media.IS_PENDING, 0)
        resolver.update(uri, contentValues, null, null)
        Log.i(TAG, "赞赏码已保存到 DCIM/$QR_SAVE_DIR/$QR_FILE_NAME")
    }

    return written
}

/** Android 9 使用传统存储 API 保存 */
private fun saveViaLegacyStorage(context: Context, bitmap: Bitmap): Boolean {
    val dcim = Environment.getExternalStoragePublicDirectory(
        Environment.DIRECTORY_DCIM
    )
    val dir = File(dcim, QR_SAVE_DIR).apply { mkdirs() }
    val file = File(dir, QR_FILE_NAME)

    // 幂等：文件已存在
    if (file.exists()) {
        Log.d(TAG, "赞赏码文件已存在: ${file.absolutePath}")
        return true
    }

    return try {
        FileOutputStream(file).use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 95, out)
        }
        // 触发媒体库扫描
        android.media.MediaScannerConnection.scanFile(
            context, arrayOf(file.absolutePath), arrayOf("image/jpeg"), null
        )
        Log.i(TAG, "赞赏码已保存到 ${file.absolutePath}")
        true
    } catch (e: Exception) {
        Log.e(TAG, "传统存储保存失败", e)
        false
    }
}

/** 在 MediaStore 中查找已存在的赞赏码文件 */
private fun findExistingQrCode(context: Context): Uri? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null

    val resolver = context.contentResolver
    val projection = arrayOf(MediaStore.Images.Media._ID)
    val selection = "${MediaStore.Images.Media.DISPLAY_NAME} = ?"
    val selectionArgs = arrayOf(QR_FILE_NAME)

    return try {
        resolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection, selection, selectionArgs, null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val id = cursor.getLong(0)
                Uri.withAppendedPath(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id.toString())
            } else {
                null
            }
        }
    } catch (e: Exception) {
        Log.w(TAG, "查询 MediaStore 失败", e)
        null
    }
}
