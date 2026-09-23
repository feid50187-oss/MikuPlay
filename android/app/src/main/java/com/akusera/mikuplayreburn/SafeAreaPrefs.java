package com.akusera.mikuplayreburn;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Environment;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;

/**
 * 安全区手动调整值的持久化。
 * 记录方式参考 OnboardingState：同一 SharedPreferences 文件 + 版本名比对，
 * 在版本更新后令调整窗口再次显示。
 *
 * 兜底机制：/storage/emulated/0/MikuPlay/安全区设置.txt 作为标记文件。
 * 用户若发现安全区错误，可通过文件管理器删除此文件，
 * 应用下次启动时会自动弹出安全区校准窗口。
 */
public final class SafeAreaPrefs {
    private static final String TAG = "SafeAreaPrefs";
    private static final String PREFS_NAME = "mikuplay_prefs";
    private static final String KEY_COMPLETED = "safe_area_tuning_completed";
    private static final String KEY_VERSION = "safe_area_tuning_version";
    private static final String KEY_TOP = "safe_area_top_px";     // CSS px
    private static final String KEY_BOTTOM = "safe_area_bottom_px"; // CSS px
    private static final String MARKER_DIR = "MikuPlay";
    private static final String MARKER_FILE = "安全区设置.txt";

    private SafeAreaPrefs() {}

    /** 获取标记文件路径（/storage/emulated/0/MikuPlay/安全区设置.txt）。 */
    private static File getMarkerFile() {
        File dir = new File(Environment.getExternalStorageDirectory(), MARKER_DIR);
        return new File(dir, MARKER_FILE);
    }

    /** 标记文件是否缺失（缺失则需强制弹出校准窗口）。 */
    public static boolean isMarkerFileMissing() {
        try {
            return !getMarkerFile().exists();
        } catch (Exception e) {
            Log.w(TAG, "无法检查标记文件，视为缺失: " + e.getMessage());
            return true;
        }
    }

    /** 创建标记文件（用户完成校准后调用）。 */
    public static void createMarkerFile() {
        try {
            File file = getMarkerFile();
            File dir = file.getParentFile();
            if (dir != null && !dir.exists()) {
                dir.mkdirs();
            }
            if (!file.exists()) {
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write("删除本文件并重启应用，即可强制显示校准窗口\n".getBytes("utf-8"));
                }
                Log.d(TAG, "标记文件已创建: " + file.getAbsolutePath());
            }
        } catch (Exception e) {
            Log.w(TAG, "创建标记文件失败: " + e.getMessage());
        }
    }

    private static String currentVersionName(Context context) {
        try {
            return context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "unknown";
        }
    }

    /** 是否应显示安全区调整窗口：未完成 或 当前版本与完成时版本不一致 或 标记文件缺失。 */
    public static boolean shouldShow(Context context) {
        var prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_COMPLETED, false)) return true;
        String doneVersion = prefs.getString(KEY_VERSION, "");
        if (!currentVersionName(context).equals(doneVersion)) return true;
        // 兜底：标记文件缺失 → 用户主动删除，需强制弹出校准窗口
        return isMarkerFileMissing();
    }

    /** 保存用户调整的值并标记完成（记录当前版本名）。同时写入标记文件。 */
    public static void save(Context context, int topPx, int bottomPx) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_COMPLETED, true)
                .putString(KEY_VERSION, currentVersionName(context))
                .putInt(KEY_TOP, topPx)
                .putInt(KEY_BOTTOM, bottomPx)
                .apply();
        // 同步创建标记文件，确保下次启动不会误触发
        createMarkerFile();
    }

    /** 获取用户覆盖值 {top, bottom}（CSS px）；未完成调整时返回 null。 */
    public static int[] getOverride(Context context) {
        var prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_COMPLETED, false)) return null;
        return new int[]{prefs.getInt(KEY_TOP, 0), prefs.getInt(KEY_BOTTOM, 0)};
    }
}
