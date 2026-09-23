
package com.akusera.mikuplayreburn;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.MediaScannerConnection;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Display;
import android.view.Surface;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

@CapacitorPlugin(
    name = "ScreenRecorder",
    permissions = {
        @Permission(strings = {android.Manifest.permission.RECORD_AUDIO}, alias = "audio")
    }
)
public class ScreenRecorderPlugin extends Plugin {
    private static final String TAG = "ScreenRecorderPlugin";
    private static final int REQUEST_CODE_SCREEN_CAPTURE = 1001;

    private MediaProjectionManager mediaProjectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private MediaRecorder mediaRecorder;
    private boolean isRecording = false;
    private String currentOutputPath;
    private int screenDensity;
    private int screenWidth;
    private int screenHeight;
    private int targetFrameRate = 30;
    private int targetBitrate = 6000000; // 6 Mbps
    
    // 保存权限回调相关数据
    private PluginCall pendingPermissionCall;
    private int pendingResultCode;
    private Intent pendingData;

    @Override
    // 插件加载时初始化MediaProjectionManager和屏幕参数
    public void load() {
        super.load();
        mediaProjectionManager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        WindowManager windowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        if (windowManager != null) {
            windowManager.getDefaultDisplay().getMetrics(metrics);
            screenDensity = metrics.densityDpi;
            screenWidth = metrics.widthPixels;
            screenHeight = metrics.heightPixels;
        }
    }

    @PluginMethod
    // 请求屏幕录制权限
    public void requestPermission(PluginCall call) {
        saveCall(call);
        Intent captureIntent = mediaProjectionManager.createScreenCaptureIntent();
        startActivityForResult(call, captureIntent, "screenCaptureResult");
    }

    @ActivityCallback
    // 处理屏幕录制权限请求结果
    private void screenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() == Activity.RESULT_OK) {
            Intent data = result.getData();
            
            try {
                // 启动前台服务，并将 MediaProjection 数据传递给服务
                Intent serviceIntent = new Intent(getActivity(), ScreenRecorderService.class);
                serviceIntent.putExtra("resultCode", result.getResultCode());
                serviceIntent.putExtra("data", data);
                
                getActivity().startForegroundService(serviceIntent);
                
                // 延迟 1000ms 等待服务完全启动并创建 MediaProjection
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    mediaProjection = ScreenRecorderService.mediaProjectionInstance;
                    
                    if (mediaProjection != null) {
                        Log.d(TAG, "从服务成功获取 MediaProjection");
                        JSObject ret = new JSObject();
                        ret.put("granted", true);
                        call.resolve(ret);
                    } else {
                        Log.e(TAG, "服务启动后 MediaProjection 为空");
                        JSObject ret = new JSObject();
                        ret.put("granted", false);
                        ret.put("error", "Failed to obtain MediaProjection from service");
                        call.resolve(ret);
                    }
                }, 1000);
            } catch (Exception e) {
                Log.e(TAG, "启动前台服务传递 MediaProjection 失败", e);
                JSObject ret = new JSObject();
                ret.put("granted", false);
                ret.put("error", e.getMessage());
                call.resolve(ret);
            }
        } else {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("error", "Permission denied by user");
            call.resolve(ret);
        }
    }

    @PluginMethod
    // 开始屏幕录制
    public void startRecording(PluginCall call) {
        if (isRecording) {
            call.reject("已在录制中");
            return;
        }

        if (mediaProjection == null) {
            call.reject("未授予屏幕录制权限，请先调用 requestPermission");
            return;
        }

        // 获取码率参数，帧率固定为60
        Integer bitrate = call.getInt("bitrate", 6); // MB/s

        targetFrameRate = 60;
        targetBitrate = bitrate * 1000000; // 转换为 bps

        // 根据当前显示方向动态获取屏幕尺寸（横屏时交换宽高）
        updateScreenDimensions();

        try {
            setupMediaRecorder();
            startScreenRecording();
            
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("outputPath", currentOutputPath);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "启动录制失败", e);
            call.reject("启动录制失败: " + e.getMessage());
        }
    }

    @PluginMethod
    // 停止屏幕录制
    public void stopRecording(PluginCall call) {
        if (!isRecording) {
            call.reject("没有正在进行的录制");
            return;
        }

        try {
            stopScreenRecording();

            // 编码成功后通知系统扫描媒体文件，将其加入媒体库（相册可见）
            scanMediaFile(currentOutputPath);
            
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("outputPath", currentOutputPath);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "停止录制失败", e);
            call.reject("停止录制失败: " + e.getMessage());
        }
    }

    @PluginMethod
    // 获取当前是否正在录制
    public void isRecording(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isRecording", isRecording);
        call.resolve(ret);
    }

    @PluginMethod
    // 获取录制状态（包含输出路径）
    public void getRecordingStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isRecording", isRecording);
        ret.put("outputPath", isRecording ? currentOutputPath : null);
        call.resolve(ret);
    }

    // 根据当前显示方向动态更新屏幕尺寸。
    //
    // 判向信号的选择（关键）：
    // 旧实现只用 getResources().getConfiguration().orientation 判断横竖屏。
    // 在部分 OEM ROM、旋转刚发生（configuration 尚未派发到该 context）、
    // 或"强制旋转"场景下，该 context 的 Resources Configuration 不会立即
    // （甚至不会）刷新到新朝向，于是物理已是横屏却读到 PORTRAIT ——
    // 最终 setVideoSize 用竖屏尺寸录制，而 AUTO_MIRROR 镜像出的真实画面是
    // 横屏 → 录出"竖屏视频中间嵌一个横屏"（用户反馈的故障现象）。
    //
    // 改用 display.getRotation()（取自 SurfaceFlinger，反映物理面板真实旋转，
    // 与 Resources Configuration 是否及时刷新无关）作为朝向的唯一真相来源，
    // 并用 getRealMetrics() 反推设备"自然朝向"尺寸。二者结合可在以下两类设备
    // 上都得到正确结果：
    //   (A) getRealMetrics() 返回当前旋转后尺寸（多数设备）
    //   (B) getRealMetrics() 始终返回自然朝向尺寸（少数设备 / 旧 API）
    // 同时它也能正确处理原注释担心的"强制旋转"场景（系统已把显示面板旋成横屏，
    // getRotation() 即返回 90/270），比原实现更鲁棒。
    //
    // configuration.orientation 保留为交叉校验：仅打日志告警、不再覆盖判定。
    private void updateScreenDimensions() {
        WindowManager windowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) return;

        Display display = windowManager.getDefaultDisplay();
        int rotation = display.getRotation(); // Surface.ROTATION_0/90/180/270

        DisplayMetrics metrics = new DisplayMetrics();
        display.getRealMetrics(metrics);
        screenDensity = metrics.densityDpi;

        int rawW = metrics.widthPixels;
        int rawH = metrics.heightPixels;

        // 由当前 rotation 反推设备"自然（未旋转）朝向"下的宽高。
        // rotation 0/180 → 当前即自然朝向；90/270 → 当前已转 90°，交换宽高得自然尺寸。
        int naturalW, naturalH;
        if (rotation == Surface.ROTATION_0 || rotation == Surface.ROTATION_180) {
            naturalW = rawW;
            naturalH = rawH;
        } else { // ROTATION_90 / ROTATION_270
            naturalW = rawH;
            naturalH = rawW;
        }
        boolean naturalIsLandscape = naturalW > naturalH;

        // 当前真实朝向：是否相对自然朝向旋转了 90°/270°
        boolean isLandscape = naturalIsLandscape
                ? (rotation == Surface.ROTATION_0 || rotation == Surface.ROTATION_180)
                : (rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270);

        int wide = Math.max(naturalW, naturalH);
        int tall = Math.min(naturalW, naturalH);

        screenWidth = isLandscape ? wide : tall;
        screenHeight = isLandscape ? tall : wide;

        // 确保尺寸为偶数（视频编码要求）
        screenWidth &= ~1;
        screenHeight &= ~1;

        // 交叉校验：configuration.orientation 仅作告警，不覆盖 rotation 判定，
        // 避免旧实现中"configuration 滞后导致误判竖屏"的问题复发。
        int cfgOrientation = getContext().getResources().getConfiguration().orientation;
        boolean cfgLandscape = cfgOrientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        if (cfgLandscape != isLandscape) {
            Log.w(TAG, "朝向信号不一致：rotation 判定 landscape=" + isLandscape
                    + "，但 configuration.orientation="
                    + (cfgLandscape ? "LANDSCAPE" : "PORTRAIT")
                    + "，已采用 rotation 判定结果");
        }

        Log.d(TAG, "录制分辨率: " + screenWidth + "x" + screenHeight
                + " landscape=" + isLandscape
                + " rotation=" + rotation
                + " (raw " + rawW + "x" + rawH + ", natural " + naturalW + "x" + naturalH + ")");
    }

    // 配置MediaRecorder（设置输出文件、编码格式等）
    private void setupMediaRecorder() throws IOException {
        // 创建输出目录
        File outputDir = new File(Environment.getExternalStorageDirectory(), "MikuPlay");
        if (!outputDir.exists()) {
            outputDir.mkdirs();
        }

        // 生成文件名（时间戳）：录制结果「MikuPlay录制MMDDHHMMSS.mp4」（MMddHHmmss = 月日时分秒，10 位）
        String timestamp = new SimpleDateFormat("MMddHHmmss", Locale.getDefault()).format(new Date());
        String fileName = "MikuPlay录制" + timestamp + ".mp4";
        File outputFile = new File(outputDir, fileName);
        currentOutputPath = outputFile.getAbsolutePath();

        mediaRecorder = new MediaRecorder();
        mediaRecorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
        mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        mediaRecorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
        mediaRecorder.setVideoEncodingBitRate(targetBitrate);
        mediaRecorder.setVideoFrameRate(targetFrameRate);
        mediaRecorder.setVideoSize(screenWidth, screenHeight);
        mediaRecorder.setOutputFile(currentOutputPath);

        try {
            mediaRecorder.prepare();
        } catch (IOException e) {
            Log.e(TAG, "MediaRecorder 准备失败", e);
            throw e;
        }
    }

    // 开始屏幕录制（创建VirtualDisplay并启动MediaRecorder）
    private void startScreenRecording() {
        if (mediaProjection == null) {
            mediaProjection = ScreenRecorderService.mediaProjectionInstance;
        }
        
        if (mediaProjection == null) {
            throw new IllegalStateException("MediaProjection is not initialized");
        }
        
        Surface surface = mediaRecorder.getSurface();
        
        virtualDisplay = mediaProjection.createVirtualDisplay(
            "ScreenRecorder",
            screenWidth,
            screenHeight,
            screenDensity,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            surface,
            null,
            null
        );

        mediaRecorder.start();
        isRecording = true;
        
        Log.d(TAG, "屏幕录制已开始: " + currentOutputPath);
    }

    // 停止屏幕录制（释放MediaRecorder和VirtualDisplay）
    private void stopScreenRecording() {
        isRecording = false;

        if (mediaRecorder != null) {
            try {
                mediaRecorder.stop();
                mediaRecorder.reset();
                mediaRecorder.release();
            } catch (Exception e) {
                Log.e(TAG, "停止媒体录制器出错", e);
            }
            mediaRecorder = null;
        }

        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }

        // MediaProjection 由服务管理，停止服务时会停止它
        mediaProjection = null;

        // 停止前台服务（服务内部会停止 MediaProjection）
        try {
            Intent serviceIntent = new Intent(getActivity(), ScreenRecorderService.class);
            getActivity().stopService(serviceIntent);
        } catch (Exception e) {
            Log.e(TAG, "停止服务出错", e);
        }

        Log.d(TAG, "屏幕录制已停止: " + currentOutputPath);
    }

    // 通知系统媒体库扫描指定视频文件
    private void scanMediaFile(String filePath) {
        if (filePath == null || filePath.isEmpty()) {
            showToast("媒体库扫描失败：输出路径为空");
            return;
        }
        try {
            File file = new File(filePath);
            if (!file.exists()) {
                Log.e(TAG, "待扫描的视频文件不存在: " + filePath);
                showToast("媒体库扫描失败：文件不存在");
                return;
            }
            MediaScannerConnection.scanFile(getContext(),
                new String[]{filePath},
                new String[]{"video/mp4"},
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
            Log.d(TAG, "已通知系统扫描视频文件: " + filePath);
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
    // 插件销毁时停止录制并清理资源
    protected void handleOnDestroy() {
        if (isRecording) {
            stopScreenRecording();
        }
        super.handleOnDestroy();
    }
}
