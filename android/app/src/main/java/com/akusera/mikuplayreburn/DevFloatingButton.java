package com.akusera.mikuplayreburn;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * pdev 变体专用：可拖动悬浮刷新按钮。
 *
 * 行为：
 * - 点击 → webView.reload() 整页刷新（与 JS 侧按钮职责分离：JS 按钮只热重载插件，本按钮只刷新页面）
 *
 * 按钮始终悬浮在 WebView 之上，可自由拖动到任意位置，无长按动作。
 * 样式（深色底 + 绿色图标 + DEV 标签）与 JS 侧蓝色圆钮刻意区分。
 */
public class DevFloatingButton {

    private static final String TAG = "DevFloatingButton";

    private final Context context;
    private final WebView webView;
    private final WindowManager windowManager;
    private FrameLayout buttonView;
    private boolean isShowing = false;

    // 拖拽状态
    private float initialTouchX, initialTouchY;
    private float initialX, initialY;
    private boolean hasMoved;
    private static final int DRAG_THRESHOLD = 10; // dp

    public DevFloatingButton(Context context, WebView webView) {
        this.context = context;
        this.webView = webView;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    /**
     * 显示悬浮按钮。
     */
    public void show() {
        if (isShowing || windowManager == null) return;

        float density = context.getResources().getDisplayMetrics().density;
        int buttonSize = (int) (42 * density);

        // 创建按钮容器，使用 FrameLayout 避免 LinearLayout 垂直布局时的尺寸挤压
        FrameLayout container = new FrameLayout(context);

        // 深色底 + 绿色描边，与 JS 侧蓝色圆钮区分
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xF221252B);
        bg.setStroke((int) (1.5f * density), 0x6600E676);
        container.setBackground(bg);
        
        // 显式设置容器的 LayoutParams 为固定尺寸
        FrameLayout.LayoutParams containerParams = new FrameLayout.LayoutParams(buttonSize, buttonSize);
        container.setLayoutParams(containerParams);

        // 内部容器，用于垂直排列图标和文字
        LinearLayout innerContainer = new LinearLayout(context);
        innerContainer.setOrientation(LinearLayout.VERTICAL);
        innerContainer.setGravity(Gravity.CENTER);
        
        // 为内部容器设定相同的固定尺寸，确保完全填充父容器
        FrameLayout.LayoutParams innerParams = new FrameLayout.LayoutParams(buttonSize, buttonSize);
        innerContainer.setLayoutParams(innerParams);

        // 刷新图标（绿色，与 JS 白色图标区分）
        ImageView icon = new ImageView(context);
        icon.setImageResource(android.R.drawable.ic_popup_sync);
        icon.setColorFilter(0xFF00E676);
        int iconSize = (int) (22 * density);
        LinearLayout.LayoutParams iconParams = new LinearLayout.LayoutParams(iconSize, iconSize);
        innerContainer.addView(icon, iconParams);

        // "DEV" 标签
        TextView label = new TextView(context);
        label.setText("刷新");
        label.setTextColor(0xFF00E676);
        label.setTextSize(8);
        label.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
        label.setIncludeFontPadding(false);
        label.setGravity(Gravity.CENTER);
        innerContainer.addView(label);
        
        container.addView(innerContainer);

        // WindowManager 参数，设定为固定尺寸
        WindowManager.LayoutParams layoutParams = new WindowManager.LayoutParams(
                buttonSize,
                buttonSize,
                WindowManager.LayoutParams.TYPE_APPLICATION,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                android.graphics.PixelFormat.TRANSLUCENT
        );
        layoutParams.gravity = Gravity.TOP | Gravity.START;
        layoutParams.x = context.getResources().getDisplayMetrics().widthPixels - buttonSize - (int) (16 * density);
        layoutParams.y = (int) (80 * density);

        // 拖拽 + 点击（无长按）
        int thresholdPx = (int) (DRAG_THRESHOLD * density);
        container.setOnTouchListener((v, event) -> {
            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    initialTouchX = event.getRawX();
                    initialTouchY = event.getRawY();
                    initialX = layoutParams.x;
                    initialY = layoutParams.y;
                    hasMoved = false;
                    return true;

                case MotionEvent.ACTION_MOVE:
                    float dx = event.getRawX() - initialTouchX;
                    float dy = event.getRawY() - initialTouchY;
                    if (Math.abs(dx) > thresholdPx || Math.abs(dy) > thresholdPx) {
                        hasMoved = true;
                    }
                    layoutParams.x = (int) (initialX + dx);
                    layoutParams.y = (int) (initialY + dy);
                    windowManager.updateViewLayout(container, layoutParams);
                    return true;

                case MotionEvent.ACTION_UP:
                    if (!hasMoved) {
                        // 点击 → 整页刷新（仅刷新页面，不重载插件）
                        Log.d(TAG, "点击 → WebView reload");
                        Toast.makeText(context, "页面刷新中…", Toast.LENGTH_SHORT).show();
                        webView.reload();
                    }
                    return true;
            }
            return false;
        });

        buttonView = container;
        windowManager.addView(buttonView, layoutParams);
        isShowing = true;
        Log.d(TAG, "悬浮刷新按钮已显示");
    }

    /**
     * 隐藏并移除悬浮按钮。
     */
    public void hide() {
        if (!isShowing || buttonView == null) return;
        try {
            windowManager.removeView(buttonView);
        } catch (Exception e) {
            Log.w(TAG, "移除悬浮按钮失败", e);
        }
        buttonView = null;
        isShowing = false;
    }

    public boolean isShowing() {
        return isShowing;
    }
}
