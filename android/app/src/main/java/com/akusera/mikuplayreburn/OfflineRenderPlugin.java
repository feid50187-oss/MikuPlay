package com.akusera.mikuplayreburn;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaScannerConnection;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

//fuck Google! 该死的谷歌竟然阉了WebView的SharedArrayBuffer，害得老子用这么曲折的方式读取帧
@CapacitorPlugin(name = "OfflineRender")
public class OfflineRenderPlugin extends Plugin {
    private static final String TAG = "OfflineRenderPlugin";

    // 加载 native 库
    static {
        System.loadLibrary("mikuplay_encoder");
    }

    // Native 实例指针
    private long nativeHandle = 0;

    // Native methods
    private native long nativeCreate();
    private native void nativeDestroy(long handle);
    private native boolean nativeStartServer(long handle, int port);
    private native void nativeStopServer(long handle);

    @Override
    public void load() {
        super.load();
        nativeHandle = nativeCreate();
        Log.d(TAG, "Native context created, handle: " + nativeHandle);
    }

    @PluginMethod
    public void startServer(PluginCall call) {
        try {
            if (nativeHandle == 0) {
                nativeHandle = nativeCreate();
            }

            int port = 8765;
            boolean success = nativeStartServer(nativeHandle, port);

            Log.d(TAG, "WebSocket服务器启动" + (success ? "成功" : "失败") + "，端口: " + port);

            JSObject ret = new JSObject();
            ret.put("success", success);
            ret.put("port", port);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "启动WebSocket服务器失败", e);
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        try {
            if (nativeHandle != 0) {
                nativeStopServer(nativeHandle);
                Log.d(TAG, "WebSocket服务器已停止");
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "停止WebSocket服务器失败", e);
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void getOutputPath(PluginCall call) {
        try {
            File baseDir = new File(Environment.getExternalStorageDirectory(), "MikuPlay");
            if (!baseDir.exists()) {
                baseDir.mkdirs();
            }

            JSObject ret = new JSObject();
            ret.put("path", baseDir.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "获取输出路径失败", e);
            JSObject ret = new JSObject();
            ret.put("success", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }


    // JNI 回调方法，由 C++ 层调用
    @SuppressWarnings("unused")
    private void onProgress(int encodedFrames, int totalFrames) {
        notifyListeners("renderProgress", new JSObject()
            .put("currentFrame", encodedFrames)
            .put("totalFrames", totalFrames));
    }

    @SuppressWarnings("unused")
    private void onEncodingProgress(int current, int total) {
        notifyListeners("encodingProgress", new JSObject()
            .put("currentFrame", current)
            .put("totalFrames", total));
    }

    @SuppressWarnings("unused")
    private void onError(String message) {
        notifyListeners("renderError", new JSObject()
            .put("error", message));
    }

    @SuppressWarnings("unused")
    private void onComplete(String outputPath) {
        notifyListeners("renderComplete", new JSObject()
            .put("outputPath", outputPath));
        // 编码成功后通知系统扫描媒体文件，将其加入媒体库（相册可见）
        scanMediaFile(outputPath);
    }

    // 通知系统媒体库扫描指定文件（视频或图片）
    private void scanMediaFile(String filePath) {
        if (filePath == null || filePath.isEmpty()) {
            showToast("媒体库扫描失败：输出路径为空");
            return;
        }
        try {
            File file = new File(filePath);
            if (!file.exists()) {
                Log.e(TAG, "待扫描的媒体文件不存在: " + filePath);
                showToast("媒体库扫描失败：文件不存在");
                return;
            }

            // 根据文件扩展名判断媒体类型
            String lowerPath = filePath.toLowerCase();
            String mimeType;
            if (lowerPath.endsWith(".png") || lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) {
                mimeType = "image/*";
            } else if (lowerPath.endsWith(".webm") || lowerPath.endsWith(".mp4")) {
                mimeType = "video/*";
            } else {
                mimeType = "*/*";
            }

            MediaScannerConnection.scanFile(getContext(),
                new String[]{filePath},
                new String[]{mimeType},
                new MediaScannerConnection.OnScanCompletedListener() {
                    @Override
                    public void onScanCompleted(String path, android.net.Uri uri) {
                        if (uri != null) {
                            showToast("已更新媒体库：" + new File(path).getName());
                        } else {
                            Log.e(TAG, "媒体库扫描未生成记录: " + path);
                            showToast("媒体库扫描失败：系统未收录该文件");
                        }
                    }
                });
            Log.d(TAG, "已通知系统扫描媒体文件: " + filePath + " (type=" + mimeType + ")");
        } catch (Exception e) {
            Log.e(TAG, "通知媒体库扫描失败: " + filePath, e);
            showToast("媒体库扫描失败：" + e.getMessage());
        }
    }

    // 在主线程弹出 Toast，避免在非 UI 线程调用崩溃
    private void showToast(final String message) {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (getContext() != null) {
                Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (nativeHandle != 0) {
            final long h = nativeHandle;
            nativeHandle = 0;
            // 后台线程销毁：nativeDestroy 需等待 finalize/编码线程结束，
            // 在后台线程执行可避免阻塞 UI 线程导致 ANR
            new Thread(() -> nativeDestroy(h), "native-destroy").start();
        }
        super.handleOnDestroy();
    }
}
