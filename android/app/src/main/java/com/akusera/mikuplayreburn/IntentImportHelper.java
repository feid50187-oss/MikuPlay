
package com.akusera.mikuplayreburn;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 处理外部 App 通过 Intent 传入的 .mkp / .zip 插件包。
 * 兼容 API 28-29（requestLegacyExternalStorage）和 API 30+（Scoped Storage）。
 *
 * 整体流程：
 *   1. ContentResolver 读取 URI → 复制到应用内部 tmp
 *   2. 从 ZIP 读取 manifest.json 校验
 *   3. 解压到 Context.getFilesDir()/plugins/{manifestId}/
 *   4. 更新 plugins/registry.json（追加或覆盖条目）
 *   5. 让 MainActivity 退出，下次启动自然 loadFromDisk
 *
 * 全程操作应用私有目录，不受分区存储 / 运行时权限影响。
 */
public class IntentImportHelper {

    private static final String TAG = "IntentImport";

    /**
     * 尝试从 Intent 提取插件包 URI 并执行安装。
     *
     * @return true 表示这是一个插件导入 Intent 且已被接管；调用方应跳过正常初始化
     */
    public static boolean handleImportIntent(Context context, Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        Uri uri = null;

        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }

        if (uri == null) {
            Log.d(TAG, "不是导入 Intent，action=" + action);
            return false;
        }

        final Uri finalUri = uri;
        final Activity activity = context instanceof Activity ? (Activity) context : null;

        // 后台线程执行安装，避免卡主线程
        new Thread(() -> {
            PluginInstallResult result = PluginInstallResult.fail("未知错误");
            try {
                result = installPluginFromUri(context, finalUri);
            } catch (Exception e) {
                Log.e(TAG, "安装异常", e);
                result = PluginInstallResult.fail("安装异常：" + e.getMessage());
            }

            // 回主线程通知用户 + 关闭 Activity
            final PluginInstallResult finalResult = result;
            new Handler(Looper.getMainLooper()).post(() -> {
                if (finalResult.success) {
                    notifyToast(context, "插件「" + finalResult.manifestId + "」安装成功，重启后生效");
                } else {
                    notifyToast(context, "安装失败：" + finalResult.error);
                }
                if (activity != null) {
                    activity.finish();
                }
            });
        }).start();

        return true;
    }

    // ─────────────── 主流程 ───────────────

    private static PluginInstallResult installPluginFromUri(Context context, Uri uri) {
        // Step 1: 把内容复制到内部缓存
        File tmpFile = copyUriToInternal(context, uri);
        if (tmpFile == null) {
            return PluginInstallResult.fail("无法读取文件");
        }

        // Step 2: 校验扩展名（虽然 ZIP 格式相同，但保持语义清晰）
        String name = tmpFile.getName().toLowerCase(Locale.ROOT);
        if (!name.endsWith(".mkp") && !name.endsWith(".zip")) {
            tmpFile.delete();
            return PluginInstallResult.fail("文件扩展名不是 .mkp 或 .zip");
        }

        try {
            // Step 3: 读取并校验 manifest.json
            ManifestInfo manifest = readManifestFromZip(tmpFile);
            if (manifest == null) {
                return PluginInstallResult.fail("无效的插件包：缺少 manifest.json");
            }
            if (manifest.id == null || manifest.id.isEmpty()) {
                return PluginInstallResult.fail("manifest.json 缺少必需字段 id");
            }
            if (manifest.type == null || manifest.type.isEmpty()) {
                return PluginInstallResult.fail("manifest.json 缺少必需字段 type");
            }

            // Step 4: 解压到 plugins/{id}/
            File pluginsDir = new File(context.getFilesDir(), "plugins");
            File targetDir = new File(pluginsDir, manifest.id);
            if (targetDir.exists()) {
                deleteRecursive(targetDir);
            }
            targetDir.mkdirs();
            unzipToDirectory(tmpFile, targetDir);

            // Step 5: 更新 registry.json
            updateRegistry(context, manifest);

            return PluginInstallResult.success(manifest.id, manifest.version);

        } catch (Exception e) {
            Log.e(TAG, "安装流程异常", e);
            return PluginInstallResult.fail(e.getMessage());
        } finally {
            // Step 6: 清理临时文件
            tmpFile.delete();
        }
    }

    // ─────────────── URI → 内部缓存 ───────────────

    private static File copyUriToInternal(Context context, Uri uri) {
        try {
            ContentResolver resolver = context.getContentResolver();

            String fileName = queryDisplayName(context, uri);
            if (fileName == null || fileName.isEmpty()) {
                String path = uri.getPath();
                if (path != null && path.contains("/")) {
                    fileName = path.substring(path.lastIndexOf("/") + 1);
                } else {
                    fileName = "plugin_import.tmp";
                }
            }

            File cacheDir = new File(context.getCacheDir(), "plugin_import");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            // 同名文件替换
            File outFile = new File(cacheDir, fileName);

            try (InputStream in = resolver.openInputStream(uri);
                 OutputStream out = new FileOutputStream(outFile)) {
                if (in == null) return null;
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            }
            Log.d(TAG, "已复制到: " + outFile.getAbsolutePath() + " (" + outFile.length() + " bytes)");
            return outFile;
        } catch (Exception e) {
            Log.e(TAG, "copyUriToInternal failed", e);
            return null;
        }
    }

    private static String queryDisplayName(Context ctx, Uri uri) {
        if ("file".equals(uri.getScheme())) {
            String p = uri.getPath();
            return p != null ? new File(p).getName() : null;
        }
        Cursor c = ctx.getContentResolver().query(uri, null, null, null, null);
        if (c != null) {
            try {
                if (c.moveToFirst()) {
                    int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (idx >= 0) return c.getString(idx);
                }
            } finally {
                c.close();
            }
        }
        return null;
    }

    // ─────────────── ZIP 读取 ───────────────

    private static ManifestInfo readManifestFromZip(File zipFile) throws Exception {
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.getName().equals("manifest.json")) {
                    StringBuilder sb = new StringBuilder();
                    try (Reader reader = new BufferedReader(
                            new InputStreamReader(zis, StandardCharsets.UTF_8))) {
                        int c;
                        while ((c = reader.read()) != -1) sb.append((char) c);
                    }
                    JSONObject json = new JSONObject(sb.toString());
                    ManifestInfo info = new ManifestInfo();
                    info.id = json.optString("id", null);
                    info.type = json.optString("type", null);
                    info.version = json.optString("version", null);
                    return info;
                }
            }
        }
        return null;
    }

    private static void unzipToDirectory(File zipFile, File targetDir) throws Exception {
        String canonicalTarget = targetDir.getCanonicalPath() + File.separator;
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zis.getNextEntry()) != null) {
                File outFile = new File(targetDir, entry.getName());
                // Zip Slip 防护
                if (!outFile.getCanonicalPath().startsWith(canonicalTarget)) {
                    Log.w(TAG, "跳过恶意条目: " + entry.getName());
                    continue;
                }
                if (entry.isDirectory()) {
                    outFile.mkdirs();
                } else {
                    outFile.getParentFile().mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        int len;
                        while ((len = zis.read(buffer)) > 0) {
                            fos.write(buffer, 0, len);
                        }
                    }
                }
            }
        }
    }

    private static void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) deleteRecursive(child);
            }
        }
        file.delete();
    }

    // ─────────────── registry.json 更新 ───────────────

    /**
     * 追加或覆盖 plugins/registry.json 中对应 manifestId 的条目。
     * 前端 PluginLoader.loadFromDisk() 读取此文件决定加载哪些插件。
     *
     * registry.json 格式（与 RegistryIO.ts 契约一致）：
     * {
     *   "plugins": {
     *     "com.example.myplugin": {
     *       "version": "1.0.0",
     *       "enabled": true,
     *       "installedAt": "2026-09-11T..."
     *     }
     *   }
     * }
     */
    private static void updateRegistry(Context context, ManifestInfo manifest) {
        try {
            File registryFile = new File(
                    new File(context.getFilesDir(), "plugins"), "registry.json");
            JSONObject root;

            if (registryFile.exists()) {
                try (BufferedReader r = new BufferedReader(
                        new InputStreamReader(new FileInputStream(registryFile), StandardCharsets.UTF_8))) {
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                    root = new JSONObject(sb.toString());
                }
            } else {
                root = new JSONObject();
            }

            JSONObject plugins = root.optJSONObject("plugins");
            if (plugins == null) {
                plugins = new JSONObject();
                root.put("plugins", plugins);
            }

            JSONObject entry = new JSONObject();
            entry.put("version", manifest.version != null ? manifest.version : "1.0");
            entry.put("enabled", true);
            entry.put("installedAt", new SimpleDateFormat(
                    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(new Date()));
            plugins.put(manifest.id, entry);

            registryFile.getParentFile().mkdirs();
            try (Writer w = new java.io.OutputStreamWriter(
                    new FileOutputStream(registryFile), StandardCharsets.UTF_8)) {
                w.write(root.toString(2));
            }

            Log.i(TAG, "registry.json 已更新: " + manifest.id);
        } catch (Exception e) {
            Log.e(TAG, "更新 registry.json 失败", e);
        }
    }

    // ─────────────── Toast ───────────────

    private static void notifyToast(Context context, String msg) {
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Toast.makeText(context, msg, Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {}
        });
    }

    // ─────────────── 数据类 ───────────────

    private static class ManifestInfo {
        String id;
        String type;
        String version;
    }

    private static class PluginInstallResult {
        boolean success;
        String manifestId;
        String version;
        String error;

        static PluginInstallResult success(String id, String ver) {
            PluginInstallResult r = new PluginInstallResult();
            r.success = true;
            r.manifestId = id;
            r.version = ver;
            return r;
        }

        static PluginInstallResult fail(String err) {
            PluginInstallResult r = new PluginInstallResult();
            r.success = false;
            r.error = err;
            return r;
        }
    }
}
