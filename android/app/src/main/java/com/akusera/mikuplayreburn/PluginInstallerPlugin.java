
package com.akusera.mikuplayreburn;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "PluginInstaller")
public class PluginInstallerPlugin extends Plugin {

    @PluginMethod
    // 安装插件，从ZIP包解压并安装到指定目录
    public void install(PluginCall call) {
        String sourcePath = call.getString("sourcePath");
        String pluginsDir = call.getString("pluginsDir");

        if (sourcePath == null || pluginsDir == null) {
            call.reject("缺少必需参数");
            return;
        }

        try {
            if (sourcePath.startsWith("file://")) {
                sourcePath = sourcePath.substring(7);
            }

            File zipFile = new File(sourcePath);
            if (!zipFile.exists()) {
                call.reject("文件不存在: " + sourcePath);
                return;
            }

            ManifestInfo manifestInfo = readManifestFromZip(zipFile);
            if (manifestInfo == null) {
                call.reject("无效的插件包：缺少 manifest.json");
                return;
            }
            if (manifestInfo.id == null || manifestInfo.type == null) {
                call.reject("manifest.json 缺少必需字段");
                return;
            }

            String nativePluginsDir = pluginsDir;
            if (pluginsDir.startsWith("https://localhost/_capacitor_file_")) {
                nativePluginsDir = pluginsDir.substring("https://localhost/_capacitor_file_".length());
            } else if (pluginsDir.startsWith("file://")) {
                nativePluginsDir = pluginsDir.substring(7);
            }

            File targetDir = new File(nativePluginsDir, manifestInfo.id);
            if (targetDir.exists()) {
                deleteRecursive(targetDir);
            }
            targetDir.mkdirs();

            unzipToDirectory(zipFile, targetDir);

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("manifestId", manifestInfo.id);
            result.put("version", manifestInfo.version != null ? manifestInfo.version : "1.0");
            call.resolve(result);

        } catch (Exception e) {
            call.reject("安装失败: " + e.getMessage());
        }
    }

    // 从ZIP包中读取manifest.json
    private ManifestInfo readManifestFromZip(File zipFile) throws Exception {
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.getName().equals("manifest.json")) {
                    StringBuilder sb = new StringBuilder();
                    BufferedReader reader = new BufferedReader(new InputStreamReader(zis, "UTF-8"));
                    String line;
                    while ((line = reader.readLine()) != null) {
                        sb.append(line);
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

    // 将ZIP包解压到目标目录
    private void unzipToDirectory(File zipFile, File targetDir) throws Exception {
        // 预计算规范路径，避免循环内对每个条目重复文件系统 IO
        String canonicalTarget = targetDir.getCanonicalPath() + File.separator;
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = zis.getNextEntry()) != null) {
                File outFile = new File(targetDir, entry.getName());

                if (!outFile.getCanonicalPath().startsWith(canonicalTarget)) {
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

    // 递归删除文件或目录
    private void deleteRecursive(File file) {
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        file.delete();
    }

    private static class ManifestInfo {
        String id;
        String type;
        String version;
    }
}
