
package com.akusera.mikuplayreburn;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(
    name = "FilePicker",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "StorageRead"),
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "StorageWrite")
    }
)
public class FilePickerPlugin extends Plugin {

    private static final int REQUEST_CODE_MANAGE_STORAGE = 1001;
    private static final String ROOT_PATH = "/storage/emulated/0";
    private static final String CANONICAL_ROOT;

    static {
        String root;
        try {
            root = new File(ROOT_PATH).getCanonicalPath();
        } catch (IOException e) {
            root = ROOT_PATH;
        }
        CANONICAL_ROOT = root;
    }

    @PluginMethod
    // 检查存储权限状态
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+：使用 MANAGE_EXTERNAL_STORAGE 权限
            granted = Environment.isExternalStorageManager();
        } else {
            // API 28-29：使用传统读写权限
            granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                    && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        }

        result.put("granted", granted);
        result.put("needRequest", !granted);
        call.resolve(result);
    }

    @PluginMethod
    // 请求存储管理权限
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // API 30+：跳转到 MANAGE_EXTERNAL_STORAGE 设置页面
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, intent, "manageStorageResult");
        } else {
            // API 28-29：请求传统读写权限
            requestPermissionForAliases(new String[]{ "StorageRead", "StorageWrite" }, call, "legacyStorageResult");
        }
    }

    @ActivityCallback
    // 处理 API 30+ 存储权限请求结果
    private void manageStorageResult(PluginCall call, ActivityResult result) {
        JSObject checkResult = new JSObject();
        boolean granted = Environment.isExternalStorageManager();
        checkResult.put("granted", granted);
        call.resolve(checkResult);
    }

    @PermissionCallback
    // 处理 API 28-29 传统读写权限请求结果
    private void legacyStorageResult(PluginCall call) {
        JSObject checkResult = new JSObject();
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        checkResult.put("granted", granted);
        call.resolve(checkResult);
    }

    @PluginMethod
    // 列出指定目录下的文件和文件夹
    public void listFiles(PluginCall call) {
        String path = call.getString("path", ROOT_PATH);

        if (!isPathAllowed(path)) {
            call.reject("无权访问该路径: " + path);
            return;
        }

        File directory = new File(path);
        if (!directory.exists() || !directory.isDirectory()) {
            call.reject("路径不存在或不是目录: " + path);
            return;
        }

        File[] files = directory.listFiles();
        JSArray filesArray = new JSArray();

        if (files != null) {
            for (File file : files) {
                JSObject fileObj = new JSObject();
                fileObj.put("name", file.getName());
                fileObj.put("path", file.getAbsolutePath());
                fileObj.put("isDirectory", file.isDirectory());

                if (!file.isDirectory()) {
                    fileObj.put("size", file.length());
                    fileObj.put("extension", getFileExtension(file.getName()));
                    long lastModified = file.lastModified();
                    fileObj.put("lastModified", lastModified);
                }

                filesArray.put(fileObj);
            }
        }

        JSObject result = new JSObject();
        result.put("files", filesArray);
        call.resolve(result);
    }

    @PluginMethod
    // 获取指定路径的父目录
    public void getParentPath(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("路径不能为空");
            return;
        }

        File file = new File(path);
        File parent = file.getParentFile();

        JSObject result = new JSObject();
        if (parent != null && isPathAllowed(parent.getAbsolutePath())) {
            result.put("parentPath", parent.getAbsolutePath());
        } else {
            result.put("parentPath", ROOT_PATH);
        }
        call.resolve(result);
    }

    @PluginMethod
    // 读取指定文件内容并返回Base64编码
    public void readFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("路径不能为空");
            return;
        }

        if (!isPathAllowed(path)) {
            call.reject("无权访问该路径: " + path);
            return;
        }

        File file = new File(path);
        if (!file.exists() || file.isDirectory()) {
            call.reject("文件不存在或是目录: " + path);
            return;
        }

        try {
            byte[] fileBytes = java.nio.file.Files.readAllBytes(file.toPath());
            String base64Data = android.util.Base64.encodeToString(fileBytes, android.util.Base64.NO_WRAP);

            JSObject result = new JSObject();
            result.put("data", base64Data);
            result.put("mimeType", getMimeType(file.getName()));
            call.resolve(result);
        } catch (IOException e) {
            call.reject("读取文件失败: " + e.getMessage());
        }
    }

    // 检查路径是否在允许访问的范围内（canonical root 已在 static 块中缓存）
    private boolean isPathAllowed(String path) {
        if (path == null) return false;

        try {
            String canonicalPath = new File(path).getCanonicalPath();
            return canonicalPath.startsWith(CANONICAL_ROOT);
        } catch (IOException e) {
            return false;
        }
    }

    // 获取文件扩展名
    private String getFileExtension(String fileName) {
        if (fileName == null || fileName.lastIndexOf(".") == -1) {
            return "";
        }
        return fileName.substring(fileName.lastIndexOf(".") + 1).toLowerCase();
    }

    // 根据文件名获取MIME类型
    private String getMimeType(String fileName) {
        String extension = getFileExtension(fileName);
        switch (extension.toLowerCase()) {
            case "jpg":
            case "jpeg":
                return "image/jpeg";
            case "png":
                return "image/png";
            case "gif":
                return "image/gif";
            case "bmp":
                return "image/bmp";
            case "tga":
                return "image/targa";

            case "mp3":
                return "audio/mpeg";
            case "wav":
                return "audio/wav";
            case "ogg":
                return "audio/ogg";
            case "flac":
                return "audio/flac";
            case "m4a":
                return "audio/mp4";
            case "aac":
                return "audio/aac";

            default:
                return "application/octet-stream";
        }
    }
}
