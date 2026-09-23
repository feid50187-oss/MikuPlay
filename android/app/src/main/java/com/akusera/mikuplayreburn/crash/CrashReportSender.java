package com.akusera.mikuplayreburn.crash;

import android.content.Context;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;

import org.acra.data.CrashReportData;
import org.acra.sender.ReportSender;
import org.acra.sender.ReportSenderException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.TimeZone;

/**
 * ACRA 自定义 ReportSender — 将崩溃/异常报告写入外部存储根目录。
 * 文件命名: MikuPlay错误日志YYYYMMDDHHMMSS（BJT）.txt
 */
public class CrashReportSender implements ReportSender {

    @Override
    public void send(Context context, CrashReportData report) throws ReportSenderException {
        // ACRA 已捕获错误 — Toast 提示便于验证
        showToast(context, "捕获错误，正在写入日志");

        SimpleDateFormat sdf = new SimpleDateFormat("yyyyMMddHHmmss", Locale.getDefault());
        sdf.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));
        String timestamp = sdf.format(new Date());

        String fileName = "MikuPlay错误日志" + timestamp + "（BJT）.txt";
        File dir = Environment.getExternalStorageDirectory();
        if (dir == null || !dir.canWrite()) {
            dir = context.getExternalFilesDir(null);
        }
        if (dir == null) {
            dir = context.getFilesDir();
        }
        File file = new File(dir, fileName);

        try (Writer writer = new OutputStreamWriter(new FileOutputStream(file, true), "UTF-8")) {
            writer.write(formatReport(report, timestamp));
        } catch (Exception e) {
            throw new ReportSenderException("写入崩溃日志失败: " + file.getAbsolutePath(), e);
        }
    }

    private String formatReport(CrashReportData report, String timestamp) {
        StringBuilder sb = new StringBuilder();
        SimpleDateFormat readable = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault());
        readable.setTimeZone(TimeZone.getTimeZone("Asia/Shanghai"));

        sb.append("═══════════════════════════════════════════════════\n");
        sb.append("                MikuPlay 错误日志\n");
        sb.append("═══════════════════════════════════════════════════\n");
        sb.append("  时间: ").append(readable.format(new Date())).append(" (BJT)\n");
        sb.append("═══════════════════════════════════════════════════\n\n");

        JSONObject json;
        try {
            json = new JSONObject(report.toJSON());
        } catch (Exception e) {
            sb.append("【错误】无法序列化崩溃报告: ").append(e.getMessage()).append("\n");
            sb.append("═══════════════════════════════════════════════════\n");
            return sb.toString();
        }

        // ── 应用信息 ──
        sb.append("【应用信息】\n");
        sb.append("  版本名:   ").append(json.optString("APP_VERSION_NAME", "N/A")).append("\n");
        sb.append("  版本号:   ").append(json.optString("APP_VERSION_CODE", "N/A")).append("\n");
        sb.append("  包名:     ").append(json.optString("PACKAGE_NAME", "N/A")).append("\n");
        sb.append("  构建类型: ").append(json.optString("BUILD_CONFIG", "N/A")).append("\n\n");

        // ── 设备信息 ──
        sb.append("【设备信息】\n");
        sb.append("  品牌:     ").append(json.optString("BRAND", "N/A")).append("\n");
        sb.append("  型号:     ").append(json.optString("PHONE_MODEL", "N/A")).append("\n");
        sb.append("  产品:     ").append(json.optString("PRODUCT", "N/A")).append("\n");
        sb.append("  Android:  ").append(json.optString("ANDROID_VERSION", "N/A")).append("\n");
        sb.append("  Build:    ").append(json.optString("BUILD", "N/A")).append("\n");
        sb.append("  屏幕:     ").append(json.optString("DISPLAY", "N/A")).append("\n\n");

        // ── 崩溃信息 ──
        sb.append("【崩溃信息】\n");
        sb.append("  崩溃时间: ").append(json.optString("USER_CRASH_DATE", "N/A")).append("\n");
        sb.append("  启动时间: ").append(json.optString("USER_APP_START_DATE", "N/A")).append("\n");
        sb.append("  线程:     ").append(json.optString("THREAD_DETAILS", "N/A")).append("\n\n");

        // ── 堆栈跟踪 ──
        sb.append("【堆栈跟踪】\n");
        sb.append(json.optString("STACK_TRACE", "N/A")).append("\n\n");

        // ── 异常消息 ──
        String exception = json.optString("EXCEPTION", "");
        if (!exception.isEmpty()) {
            sb.append("【异常消息】\n");
            sb.append(exception).append("\n\n");
        }

        // ── Logcat ──
        String logcat = json.optString("LOGCAT", "");
        if (!logcat.isEmpty()) {
            sb.append("【Logcat (最后 200 行)】\n");
            sb.append(logcat).append("\n\n");
        }

        // ── 自定义数据 ──
        String customData = json.optString("CUSTOM_DATA", "");
        if (!customData.isEmpty()) {
            sb.append("【自定义数据】\n");
            sb.append(customData).append("\n\n");
        }

        // ── 完整 JSON 转储 ──
        sb.append("【完整数据转储 (JSON)】\n");
        try {
            sb.append(json.toString(2)).append("\n");
        } catch (Exception e) {
            sb.append(json.toString()).append("\n");
        }

        // ── 所有字段一览 ──
        sb.append("\n【所有字段】\n");
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            sb.append("  ").append(key).append("\n");
        }

        sb.append("\n═══════════════════════════════════════════════════\n");
        sb.append("                日志结束\n");
        sb.append("═══════════════════════════════════════════════════\n");

        return sb.toString();
    }

    /** 后台线程（SenderService）调用，切回主线程显示 Toast。 */
    private static void showToast(final Context context, final String msg) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Toast.makeText(context, msg, Toast.LENGTH_LONG).show();
            } catch (Throwable ignored) {
                // Toast 失败不影响日志写入
            }
        });
    }
}
