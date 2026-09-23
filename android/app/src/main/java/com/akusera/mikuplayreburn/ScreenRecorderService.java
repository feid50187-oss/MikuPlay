//新版安卓必须创建服务才能开始录屏
package com.akusera.mikuplayreburn;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.IBinder;

public class ScreenRecorderService extends Service {
    private static final String CHANNEL_ID = "ScreenRecorderChannel";
    private static final int NOTIFICATION_ID = 1;
    
    public static MediaProjection mediaProjectionInstance;
    public static int resultCode;
    public static Intent data;
    
    // MediaProjection状态变化回调
    private MediaProjection.Callback mediaProjectionCallback = new MediaProjection.Callback() {
        @Override
        public void onStop() {
            android.util.Log.d("ScreenRecorderService", "MediaProjection 被系统或用户停止");
            mediaProjectionInstance = null;
            stopForeground(true);
            stopSelf();
        }
    };

    @Override
    // Service创建时初始化通知渠道
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    // 处理Service启动命令，创建MediaProjection并转为前台服务
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = createNotification();
        startForeground(NOTIFICATION_ID, notification);
        
        if (intent != null) {
            resultCode = intent.getIntExtra("resultCode", 0);
            data = intent.getParcelableExtra("data");
            
            if (resultCode != 0 && data != null) {
                try {
                    MediaProjectionManager manager = 
                        (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
                    mediaProjectionInstance = manager.getMediaProjection(resultCode, data);
                    
                    if (mediaProjectionInstance != null) {
                        mediaProjectionInstance.registerCallback(mediaProjectionCallback, null);
                        android.util.Log.d("ScreenRecorderService", "MediaProjection 回调已注册");
                    }
                } catch (Exception e) {
                    android.util.Log.e("ScreenRecorderService", "创建 MediaProjection 失败", e);
                }
            }
        }
        
        return START_NOT_STICKY;
    }

    @Override
    // 不支持绑定服务，返回null
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    // Service销毁时释放MediaProjection资源
    public void onDestroy() {
        super.onDestroy();
        if (mediaProjectionInstance != null) {
            mediaProjectionInstance.unregisterCallback(mediaProjectionCallback);
            mediaProjectionInstance.stop();
            mediaProjectionInstance = null;
        }
        stopForeground(true);
    }

    // 创建通知渠道（Android O及以上版本必需）
    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "屏幕录制服务",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("用于屏幕录制的后台服务通知");
        channel.setShowBadge(false);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    // 创建前台服务通知
    private Notification createNotification() {
        return new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("正在录制屏幕")
            .setContentText("MikuPlay ReBurn 正在录制屏幕内容")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setOngoing(true)
            .build();
    }
}
