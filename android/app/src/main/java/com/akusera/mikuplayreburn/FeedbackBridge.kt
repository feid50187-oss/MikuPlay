package com.akusera.mikuplayreburn

import android.graphics.BitmapFactory
import android.util.Log

/**
 * 反馈/赞赏功能的 JNI 桥接层。
 *
 * Native 方法由 [FeedbackResource.cpp] 实现，通过 [JNIOnLoad.cpp] 的
 * `registerFeedbackBridge` 注册到此类。
 *
 * 二维码图片以二进制形式嵌入在 SO 库中（构建时由 `xxd -i` 等效脚本
 * 转换为 C 字节数组），运行时通过 JNI 提取到 Java 层解码为 Bitmap。
 */
object FeedbackBridge {
    private const val TAG = "FeedbackBridge"

    init {
        // mikuplay_encoder 已由 MikuPlayApplication.onCreate 加载；
        // 冗余加载是 no-op，保证独立测试时 native 方法可用。
        try {
            System.loadLibrary("mikuplay_encoder")
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "加载 libmikuplay_encoder 失败", e)
        }
    }

    /**
     * 从 SO 嵌入数据中获取赞赏二维码的 JPEG 原始字节。
     *
     * @return JPEG 图片的字节数组；失败时返回空数组。
     */
    @JvmStatic
    external fun nativeGetQrCodeBytes(): ByteArray

    /**
     * 获取赞赏二维码的 Bitmap 解码结果。
     *
     * @return 解码后的 Bitmap；解码失败返回 null。
     */
    fun getQrCodeBitmap(): android.graphics.Bitmap? {
        return try {
            val bytes = nativeGetQrCodeBytes()
            if (bytes.isEmpty()) {
                Log.e(TAG, "nativeGetQrCodeBytes 返回空数据")
                return null
            }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "nativeGetQrCodeBytes 未注册", e)
            null
        } catch (e: Exception) {
            Log.e(TAG, "nativeGetQrCodeBytes 调用异常", e)
            null
        }
    }
}
