package com.akusera.mikuplayreburn

import android.content.Context
import android.util.Log
import org.json.JSONArray

/**
 * 公告系统 JNI 封装。
 *
 * C++ 侧（AnnouncementManager.cpp）完成 .mka 文件的扫描、解析、过滤与排序，
 * 通过 JNI 返回 JSON 数组字符串；本类负责解析 JSON 为 [AnnouncementItem] 列表。
 *
 * 不经过 WebView / Capacitor，直接在原生层完成公告加载。
 */
object AnnouncementBridge {
    private const val TAG = "AnnouncementBridge"

    init {
        // mikuplay_encoder 已由 MikuPlayApplication.onCreate 加载；
        // 此处冗余加载是 no-op，保证独立测试时 native 方法可注册。
        try {
            System.loadLibrary("mikuplay_encoder")
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "加载 libmikuplay_encoder 失败", e)
        }
    }

    /**
     * 获取所有可显示的公告（已按 priority 降序排列）。
     *
     * 此方法涉及 JNI 调用与 assets/内部存储 I/O，应在后台线程调用。
     *
     * @return 可显示的公告列表；无公告或出错时返回空列表。
     */
    fun getVisibleAnnouncements(context: Context): List<AnnouncementItem> {
        val json = try {
            nativeGetVisibleAnnouncements(context)
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "nativeGetVisibleAnnouncements 未注册", e)
            return emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "nativeGetVisibleAnnouncements 调用异常", e)
            return emptyList()
        }

        if (json.isNullOrEmpty()) {
            Log.d(TAG, "nativeGetVisibleAnnouncements 返回空")
            return emptyList()
        }

        return parseAnnouncementJson(json)
    }

    /**
     * 标记公告为"不再显示"。
     * 仅当公告声明了 dont_show_again 控件且用户勾选后才应调用。
     */
    fun markDontShow(context: Context, announcementId: String) {
        try {
            nativeMarkDontShow(context, announcementId)
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "nativeMarkDontShow 未注册", e)
        } catch (e: Exception) {
            Log.e(TAG, "nativeMarkDontShow 调用异常", e)
        }
    }

    /**
     * 检查并执行远程同步（BJT 00:00 界限）。
     *
     * 全程在 C++ 中完成（libcurl HTTP + JSON 解析 + SHA-256 校验 + 缓存原子替换），
     * 不回调 Kotlin。应在后台线程调用，不阻塞 UI。
     *
     * 同步流程：
     * 1. 检查 BJT 00:00 界限，今日已同步则跳过
     * 2. 下载远程 index.json，计算 SHA-256
     * 3. 与本地 index.json 的 SHA-256 比较：
     *    - 一致 → 跳过下载，仅更新同步时间戳
     *    - 不一致 → 下载 .mka 文件，SHA-256 校验 + MKA 格式校验，原子替换缓存
     *
     * 同步失败不影响公告显示（使用缓存内容）。
     *
     * @return true=同步完成或跳过；false=同步异常
     */
    fun syncIfNeeded(context: Context): Boolean {
        return try {
            nativeSyncIfNeeded(context)
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "nativeSyncIfNeeded 未注册", e)
            false
        } catch (e: Exception) {
            Log.e(TAG, "nativeSyncIfNeeded 调用异常", e)
            false
        }
    }

    /**
     * 解析 C++ 返回的 JSON 数组为 [AnnouncementItem] 列表。
     * 解析失败时返回空列表（不影响应用启动）。
     */
    private fun parseAnnouncementJson(json: String): List<AnnouncementItem> {
        return try {
            val array = JSONArray(json)
            val result = mutableListOf<AnnouncementItem>()
            for (i in 0 until array.length()) {
                val obj = array.optJSONObject(i) ?: continue
                val controlsArray = obj.optJSONArray("controls")
                val controls = mutableListOf<String>()
                if (controlsArray != null) {
                    for (j in 0 until controlsArray.length()) {
                        controlsArray.optString(j).takeIf { it.isNotEmpty() }?.let {
                            controls.add(it)
                        }
                    }
                }
                val item = AnnouncementItem(
                    id = obj.optString("id"),
                    version = obj.optString("version").takeIf { it.isNotEmpty() },
                    date = obj.optString("date").takeIf { it.isNotEmpty() },
                    priority = obj.optInt("priority", 0),
                    title = obj.optString("title"),
                    controls = controls,
                    content = obj.optString("content"),
                )
                // id 与 content 为必填，缺失则跳过该条
                if (item.id.isNotEmpty() && item.content.isNotEmpty()) {
                    result.add(item)
                }
            }
            result
        } catch (e: Exception) {
            Log.e(TAG, "解析公告 JSON 失败: ${e.message}", e)
            emptyList()
        }
    }

    // ── JNI native 方法 ──
    @JvmStatic
    private external fun nativeGetVisibleAnnouncements(context: Context): String?

    @JvmStatic
    private external fun nativeMarkDontShow(context: Context, announcementId: String)

    @JvmStatic
    private external fun nativeSyncIfNeeded(context: Context): Boolean
}

/**
 * 单条公告的数据模型。
 *
 * @property id       公告唯一标识（用于"不再显示"判断）
 * @property version  对应的应用版本号
 * @property date     发布日期（ISO 格式 YYYY-MM-DD）
 * @property priority 显示优先级（数值越大越优先）
 * @property title    对话框标题
 * @property controls 控件声明列表（如 dont_show_again、action_url:...、action_close）
 * @property content  CONTENT 段原文（简化 Markdown，由 Compose 侧渲染）
 */
data class AnnouncementItem(
    val id: String,
    val version: String?,
    val date: String?,
    val priority: Int,
    val title: String,
    val controls: List<String>,
    val content: String,
)
