package com.akusera.mikuplayreburn;

import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.util.Log;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private boolean isImmersiveMode = false;
    // 上次注入的安全区值（top,bottom,left,right，CSS px），-1 表示尚未注入，用于去重
    private final int[] lastSafeAreaCss = {-1, -1, -1, -1};
    // 安全区手动调整窗口相关
    private boolean isTuning = false;                       // 调整中：抑制 insets 监听器覆盖试用值
    private boolean safeAreaTunerShownThisSession = false;  // 本进程已展示过调整窗口
    // 调整窗展示双条件：应用 UI 就绪 + 公告全部关闭，二者先后无关
    private volatile boolean appUiReady = false;
    private volatile boolean announcementsComplete = false;
    private volatile boolean feedbackComplete = false;
    private boolean tunerArmed = false;  // 已启动 UI 就绪轮询，防止 onPageLoaded 重复触发
    private Dialog safeAreaTunerDialog = null;  // 当前安全区调整对话框引用，用于重复调用时关闭旧对话框
    private CountDownTimer safeAreaConfirmTimer = null;  // 确认按钮 5 秒倒计时器，重开/关闭时取消，避免泄漏
    // pdev 变体专用：悬浮刷新按钮
    private DevFloatingButton devFloatingButton = null;

    @Override
    // 初始化Activity，注册插件并配置WebView
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FilePickerPlugin.class);
        registerPlugin(FullscreenPlugin.class);
        registerPlugin(ScreenRecorderPlugin.class);
        registerPlugin(OfflineRenderPlugin.class);
        registerPlugin(MediaPickerPlugin.class);
        registerPlugin(PluginInstallerPlugin.class);
        registerPlugin(CdpPlugin.class);
        registerPlugin(VideoPostProcessPlugin.class);
        super.onCreate(savedInstanceState);

        // === 处理外部 App 传入的 .mkp / .zip 插件包 ===
        if (IntentImportHelper.handleImportIntent(this, getIntent())) {
            return; // 是插件导入 Intent，跳过正常初始化（WebView 等）
        }

        WebView.setWebContentsDebuggingEnabled(true);

        setupSystemBars();
        keepScreenOn();

        // pdev 变体：显示悬浮刷新按钮（依赖 WebView，待 onPageLoaded 后挂载）
        if (BuildConfig.PDEV) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    showDevFloatingButton(view);
                }
            });
        }

        // 检查并显示公告（后台线程加载，不阻塞 UI；无公告时静默跳过）
        // onComplete 在无公告 / 全部关闭 / 加载出错 时于主线程触发，
        // 用于在公告遮罩消失后再展示安全区调整窗口，避免遮罩影响观察。
        AnnouncementLauncher.show(this, () -> {
            announcementsComplete = true;
            // 公告关闭后检查反馈弹窗（基于启动次数控制）
            FeedbackLauncher.showIfDue(this, () -> {
                feedbackComplete = true;
                tryShowSafeAreaTuner();
            });
        });
    }

    // 保持屏幕常亮
    private void keepScreenOn() {
        Window window = getWindow();
        if (window != null) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    // pdev 变体：显示可拖动悬浮刷新按钮（首次创建，后续复用）
    private void showDevFloatingButton(WebView webView) {
        if (devFloatingButton == null) {
            devFloatingButton = new DevFloatingButton(this, webView);
        }
        if (!devFloatingButton.isShowing()) {
            devFloatingButton.show();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // singleTask 模式下，已运行的 Activity 被再次 Intent 唤起时走这里
        if (IntentImportHelper.handleImportIntent(this, intent)) {
            return;
        }
    }

    @Override
    public void onDestroy() {
        if (safeAreaConfirmTimer != null) {
            safeAreaConfirmTimer.cancel();
            safeAreaConfirmTimer = null;
        }
        if (devFloatingButton != null) {
            devFloatingButton.hide();
            devFloatingButton = null;
        }
        super.onDestroy();
    }

    // 配置系统状态栏和导航栏
    private void setupSystemBars() {
        Window window = getWindow();
        if (window == null) return;

        // Android 12+ 禁用系统栏对比度强制执行，确保透明效果一致
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        // 内容延伸到系统栏下方，由 WebView 和 CSS safe-area 处理安全区域
        WindowCompat.setDecorFitsSystemWindows(window, false);

        setupWebViewSafeArea();
    }

    // 设置沉浸式模式
    public void setImmersiveMode(boolean enabled) {
        Window window = getWindow();
        if (window == null) return;

        isImmersiveMode = enabled;

        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, window.getDecorView());
        if (enabled) {
            controller.hide(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        } else {
            controller.show(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars());
        }

        // 强制重新分发 insets，确保安全区CSS变量在沉浸切换后及时更新
        // （部分 ROM 切换系统栏可见性后不会自动向 WebView 重新分发 insets）
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.post(webView::requestApplyInsets);
        } else {
            window.getDecorView().requestApplyInsets();
        }

        Log.d(TAG, "沉浸模式: " + (enabled ? "已启用" : "已禁用"));
    }

    // 获取沉浸式模式状态
    public boolean isImmersiveMode() {
        return isImmersiveMode;
    }

    // 设置WebView安全区域 - 使用原生WindowInsets监听并注入CSS变量
    private void setupWebViewSafeArea() {
        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        // 设置WindowInsets监听器，获取真实系统栏高度
        // 底部安全区取值要点（修复"部分设备底部安全区过高 / 部分设备翻倍"）：
        // 1) 系统手势区(mandatorySystemGestures)在部分 ROM 被报得过大，绝不能用 max() 永远取大值；
        // 2) 优先信任实测：navBars.bottom>0 时直接采用（三键/二键本就可靠，手势下若有正确小值也可用），
        //    并钳制合理上限；仅当 navBars.bottom==0（手势导航）才回退到 mandatory 手势区并 min 钳制；
        // 3) 不再用 getNavigationMode() 的 Settings 键推断取值源——该键各 OEM 语义不一致，
        //    误判为手势会把原本准确的设备推到被高估的兜底分支，导致安全区翻倍；
        // 4) 任何来源最终都钳制到合理上限，防止个别系统返回异常大值。
        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            // 手动调整中：由调整窗口直接注入试用值，跳过自动注入避免覆盖
            if (isTuning) return insets;

            Insets statusBars = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets navBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
            Insets mandatory = insets.getInsets(WindowInsetsCompat.Type.mandatorySystemGestures());

            // 获取屏幕密度，将物理像素转换为CSS像素
            float density = getResources().getDisplayMetrics().density;
            // 手势提示/手势区上限（约 48 CSS px）与三键/二键导航栏上限（约 96 CSS px），杜绝 ROM 报大值
            int gestureCapPx = Math.round(48 * density);
            int navCapPx = Math.round(96 * density);

            // 顶部/底部：若用户已手动校准，使用覆盖值；否则按系统 insets 自动计算
            int topCss, bottomCss;
            int[] override = SafeAreaPrefs.getOverride(MainActivity.this);
            if (override != null) {
                topCss = override[0];
                bottomCss = override[1];
            } else {
                topCss = Math.round(statusBars.top / density);
                // 底部安全区（物理像素）：优先信任实测导航栏高度
                // —— navBars.bottom>0（三键/二键，或手势下 ROM 仍报正确小值）时直接采用并钳制；
                // 仅当其=0（手势导航）时回退到 mandatory 手势区，且取 min 钳制上限，
                // 避免部分 ROM 把 mandatory/gesture 区报大导致安全区翻倍。
                // 关键：不再用 getNavigationMode() 的 Settings 键推断取值源——该键各 OEM 语义不一致，
                // 误判为手势会把原本准确的设备推到被高估的兜底分支，反而让底部安全区翻倍。
                int bottomPx = navBars.bottom > 0
                        ? Math.min(navBars.bottom, navCapPx)
                        : Math.min(mandatory.bottom, gestureCapPx);
                bottomCss = Math.round(bottomPx / density);
            }
            // 横屏时导航栏可能位于左右两侧（始终自动）
            int leftCss = Math.round(Math.max(statusBars.left, navBars.left) / density);
            int rightCss = Math.round(Math.max(statusBars.right, navBars.right) / density);

            injectSafeAreaCss(webView, topCss, bottomCss, leftCss, rightCss);

            // 返回insets，不消费（让其他监听器也能收到）
            return insets;
        });

        // 配置WebView设置
        webView.post(() -> {
            WebSettings settings = webView.getSettings();
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            setupWebViewHardwareAcceleration(webView);
        });

        // 监听页面加载完成：文档（重）加载会替换 documentElement，导致已注入的 CSS 变量丢失，
        // 需在每次 onPageLoaded 后用最近一次的安全区值重新注入（不替换 Capacitor 的 WebViewClient）。
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                // 重新注入：优先用户覆盖值，其次最近自动值；left/right 用已知值兜底 0
                int[] override = SafeAreaPrefs.getOverride(MainActivity.this);
                int top = override != null ? override[0]
                        : (lastSafeAreaCss[0] >= 0 ? lastSafeAreaCss[0] : 0);
                int bottom = override != null ? override[1]
                        : (lastSafeAreaCss[1] >= 0 ? lastSafeAreaCss[1] : 0);
                int left = lastSafeAreaCss[2] >= 0 ? lastSafeAreaCss[2] : 0;
                int right = lastSafeAreaCss[3] >= 0 ? lastSafeAreaCss[3] : 0;
                evaluateSafeAreaJs(view, top, bottom, left, right);
                // 再请求一次 insets，让监听器用真实值刷新（含覆盖的 top/bottom 与自动 left/right）
                view.post(view::requestApplyInsets);

                // 首次启动 / 版本更新后展示安全区调整窗口（每进程仅一次）
                // 实际展示由 tryShowSafeAreaTuner 门控：需应用 UI 就绪 + 公告全部关闭
                if (!tunerArmed && SafeAreaPrefs.shouldShow(MainActivity.this)) {
                    tunerArmed = true;
                    waitForAppUiThenShowTuner(view);
                }
            }
        });
    }

    /**
     * 等待应用主 UI（.main-window）就绪后再尝试展示调整窗口，确保实时预览有意义。
     * 轮询最多约 10s，超时则视为就绪（兜底）。
     */
    private void waitForAppUiThenShowTuner(WebView webView) {
        final WebView wv = webView;
        final int[] checks = {0};
        wv.postDelayed(new Runnable() {
            @Override
            public void run() {
                wv.evaluateJavascript(
                    "(function(){return document.querySelector('.main-window')?'1':'0';})();",
                    value -> {
                        boolean ready = "\"1\"".equals(value);
                        if (ready || checks[0]++ >= 50) {
                            appUiReady = true;
                            tryShowSafeAreaTuner();
                        } else {
                            wv.postDelayed(this, 200);
                        }
                    });
            }
        }, 800);
    }

    /**
     * 安全区调整窗展示门控：应用 UI 就绪 + 公告全部关闭 + 反馈对话框流程结束 + 未展示过 + 需要展示（版本比对）。
     * 由 appUiReady、announcementsComplete、feedbackComplete 三个条件各自达成时调用。
     */
    private void tryShowSafeAreaTuner() {
        if (appUiReady && announcementsComplete && feedbackComplete && !safeAreaTunerShownThisSession
                && SafeAreaPrefs.shouldShow(this)) {
            safeAreaTunerShownThisSession = true;
            showSafeAreaTuner();
        }
    }

    /**
     * 展示安全区手动调整窗口。
     * 实时预览可行（注入CSS变量即时触发重排），故仅 1 个"确定"按钮，无"预览"按钮。
     * 拖动 SeekBar 即时注入试用值，确定后持久化。
     */
    private void showSafeAreaTuner() {
        final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;

        // 如果已有调整对话框在显示，先关闭（同时取消旧倒计时，避免旧按钮被继续更新）
        if (safeAreaConfirmTimer != null) {
            safeAreaConfirmTimer.cancel();
            safeAreaConfirmTimer = null;
        }
        if (safeAreaTunerDialog != null && safeAreaTunerDialog.isShowing()) {
            safeAreaTunerDialog.dismiss();
            safeAreaTunerDialog = null;
        }

        final int MAX = 120; // CSS px，覆盖状态栏+导航栏常见范围
        int[] override = SafeAreaPrefs.getOverride(this);
        int initTop = override != null ? override[0]
                : (lastSafeAreaCss[0] >= 0 ? lastSafeAreaCss[0] : 0);
        int initBottom = override != null ? override[1]
                : (lastSafeAreaCss[1] >= 0 ? lastSafeAreaCss[1] : 0);
        initTop = Math.max(0, Math.min(MAX, initTop));
        initBottom = Math.max(0, Math.min(MAX, initBottom));
        final int leftCur = lastSafeAreaCss[2] >= 0 ? lastSafeAreaCss[2] : 0;
        final int rightCur = lastSafeAreaCss[3] >= 0 ? lastSafeAreaCss[3] : 0;

        isTuning = true;
        // 立即注入初始试用值，确保用户看到当前状态
        evaluateSafeAreaJs(webView, initTop, initBottom, leftCur, rightCur);

        final float density = getResources().getDisplayMetrics().density;
        final Context ctx = this;
        final int[] topVal = {initTop};
        final int[] bottomVal = {initBottom};

        // === 根卡片 ===
        LinearLayout root = new LinearLayout(ctx);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(20 * density);
        root.setPadding(pad, pad, pad, pad);
        GradientDrawable card = new GradientDrawable();
        card.setColor(0xFFFFFFFF);
        card.setCornerRadius(24 * density);
        card.setStroke(Math.round(1 * density), 0xFFE0E0E0);
        root.setBackground(card);

        // 标题
        TextView title = new TextView(ctx);
        title.setText(R.string.safe_area_tuner_title);
        title.setTextSize(18);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setTextColor(0xFF212121);
        root.addView(title);

        // 提示
        TextView hint = new TextView(ctx);
        hint.setText(R.string.safe_area_tuner_hint);
        hint.setTextSize(13);
        hint.setTextColor(0xFF616161);
        hint.setLineSpacing(0, 1.4f);
        LinearLayout.LayoutParams hintLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hintLp.topMargin = Math.round(8 * density);
        root.addView(hint, hintLp);

        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = Math.round(16 * density);

        // 顶部滑块行
        root.addView(makeSliderRow(ctx, R.string.safe_area_tuner_top, initTop, MAX, density,
                progress -> {
                    topVal[0] = progress;
                    evaluateSafeAreaJs(webView, topVal[0], bottomVal[0], leftCur, rightCur);
                }), rowLp);

        // 底部滑块行
        root.addView(makeSliderRow(ctx, R.string.safe_area_tuner_bottom, initBottom, MAX, density,
                progress -> {
                    bottomVal[0] = progress;
                    evaluateSafeAreaJs(webView, topVal[0], bottomVal[0], leftCur, rightCur);
                }), rowLp);

        // 确定按钮
        Button ok = new Button(ctx);
        ok.setText(R.string.safe_area_tuner_ok);
        ok.setTextColor(0xFFFFFFFF);
        ok.setAllCaps(false);
        GradientDrawable okBg = new GradientDrawable();
        okBg.setColor(0xFFFF6699);
        okBg.setCornerRadius(16 * density);
        ok.setBackground(okBg);
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Math.round(44 * density));
        okLp.topMargin = Math.round(24 * density);
        root.addView(ok, okLp);

        // 确认按钮 5 秒倒计时：倒计时期间按钮不可点击，强制用户先核对顶/底栏留白预览再确认，
        // 避免误点确认导致顶/底安全区高度不正确。文案依次显示：
        //   请确认顶/底栏留白高度正确(5/4/3/2/1)
        // 重开对话框时取消旧计时器，避免旧按钮被继续更新。
        if (safeAreaConfirmTimer != null) {
            safeAreaConfirmTimer.cancel();
            safeAreaConfirmTimer = null;
        }
        ok.setEnabled(false);
        GradientDrawable okBgDisabled = new GradientDrawable();
        okBgDisabled.setColor(0xFFBDBDBD);   // 倒计时期间置灰
        okBgDisabled.setCornerRadius(16 * density);
        ok.setBackground(okBgDisabled);
        ok.setText("请确认顶/底栏留白高度正确(5)");
        safeAreaConfirmTimer = new CountDownTimer(5000, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                int remain = (int) Math.ceil(millisUntilFinished / 1000.0);
                ok.setText("请确认顶/底栏留白高度正确(" + remain + ")");
            }
            @Override
            public void onFinish() {
                ok.setText(R.string.safe_area_tuner_ok);
                ok.setBackground(okBg);        // 恢复粉色可点击态
                ok.setEnabled(true);
                safeAreaConfirmTimer = null;
            }
        };
        safeAreaConfirmTimer.start();

        // === Dialog 配置：透明无遮罩，令 WebView 安全区边缘可见以供实时预览 ===
        Dialog dialog = new Dialog(ctx);
        dialog.setContentView(root, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        dialog.setCancelable(false);
        Window dw = dialog.getWindow();
        if (dw != null) {
            dw.setBackgroundDrawable(new ColorDrawable(0x00000000));
            dw.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            dw.setLayout(Math.round(320 * density), WindowManager.LayoutParams.WRAP_CONTENT);
            dw.setGravity(Gravity.CENTER);
        }

        ok.setOnClickListener(v -> {
            if (safeAreaConfirmTimer != null) {
                safeAreaConfirmTimer.cancel();
                safeAreaConfirmTimer = null;
            }
            SafeAreaPrefs.save(this, topVal[0], bottomVal[0]);
            lastSafeAreaCss[0] = topVal[0];
            lastSafeAreaCss[1] = bottomVal[0];
            isTuning = false;
            evaluateSafeAreaJs(webView, topVal[0], bottomVal[0], leftCur, rightCur);
            // 让监听器刷新 left/right（及确认最终值）
            webView.post(webView::requestApplyInsets);
            dialog.dismiss();
            safeAreaTunerDialog = null;
            Log.d(TAG, "安全区调整完成: top=" + topVal[0] + " bottom=" + bottomVal[0]);
        });

        safeAreaTunerDialog = dialog;
        dialog.show();
    }

    /**
     * 主动呼出安全区调整窗口（供前端插件调用，用于用户需要重新校准安全区时）。
     * 与自动展示不同，此方法忽略版本检查和展示门控，允许用户随时触发。
     */
    public void showSafeAreaTunerManually() {
        runOnUiThread(() -> {
            safeAreaTunerShownThisSession = false;  // 重置标志，允许再次展示
            showSafeAreaTuner();
        });
    }

    /** 滑块行：标签 + 当前值 + SeekBar。progress 变化通过 cb 回调实时注入。 */
    private View makeSliderRow(Context ctx, int labelRes, int init, int max, float density,
                               OnProgressChanged cb) {
        LinearLayout row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.VERTICAL);

        LinearLayout labelLine = new LinearLayout(ctx);
        labelLine.setOrientation(LinearLayout.HORIZONTAL);
        labelLine.setGravity(Gravity.CENTER_VERTICAL);
        TextView label = new TextView(ctx);
        label.setText(labelRes);
        label.setTextSize(15);
        label.setTextColor(0xFF212121);
        TextView value = new TextView(ctx);
        value.setText(init + "px");
        value.setTextSize(15);
        value.setTextColor(0xFFFF6699);
        value.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        labelLine.addView(label);
        labelLine.addView(new View(ctx), new LinearLayout.LayoutParams(0, 1, 1f));
        labelLine.addView(value);
        row.addView(labelLine);

        SeekBar seek = new SeekBar(ctx);
        seek.setMax(max);
        seek.setProgress(init);
        LinearLayout.LayoutParams seekLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        seekLp.topMargin = Math.round(4 * density);
        row.addView(seek, seekLp);

        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar s, int progress, boolean fromUser) {
                value.setText(progress + "px");
                cb.onProgressChanged(progress);
            }
            @Override
            public void onStartTrackingTouch(SeekBar s) {}
            @Override
            public void onStopTrackingTouch(SeekBar s) {}
        });
        return row;
    }

    private interface OnProgressChanged {
        void onProgressChanged(int progress);
    }

    /**
     * 注入安全区CSS变量到WebView（带去重）。
     * - 仅在值变化时注入，避免重复JS调用；
     * 由 WindowInsets 监听器调用。
     */
    private void injectSafeAreaCss(WebView webView, int top, int bottom, int left, int right) {
        // 值未变化则跳过
        if (lastSafeAreaCss[0] == top && lastSafeAreaCss[1] == bottom
                && lastSafeAreaCss[2] == left && lastSafeAreaCss[3] == right) {
            return;
        }
        lastSafeAreaCss[0] = top;
        lastSafeAreaCss[1] = bottom;
        lastSafeAreaCss[2] = left;
        lastSafeAreaCss[3] = right;
        evaluateSafeAreaJs(webView, top, bottom, left, right);
    }

    /**
     * 执行安全区CSS变量注入的JS。
     * - JS 内自带 documentElement 就绪重试，解决 insets 早于页面就绪的时序竞态；
     * - 注入完成派发 safe-area-insets-change 事件，供前端失效缓存。
     * 注：本方法不做去重，页面（重）加载后需强制重新注入时直接调用。
     */
    private void evaluateSafeAreaJs(WebView webView, int top, int bottom, int left, int right) {
        String js = String.format(
            "(function(){" +
            "  function apply(){" +
            "    var d=document.documentElement;" +
            "    if(!d){ setTimeout(apply,30); return; }" +   // 页面未就绪则重试
            "    d.style.setProperty('--safe-area-top','%dpx');" +
            "    d.style.setProperty('--safe-area-bottom','%dpx');" +
            "    d.style.setProperty('--safe-area-left','%dpx');" +
            "    d.style.setProperty('--safe-area-right','%dpx');" +
            "    window.dispatchEvent(new Event('safe-area-insets-change'));" +
            "  }" +
            "  apply();" +
            "})();",
            top, bottom, left, right);

        webView.post(() -> webView.evaluateJavascript(js, null));
        Log.d(TAG, "注入安全区CSS: top=" + top + " bottom=" + bottom
                + " left=" + left + " right=" + right);
    }

    /**
     * 配置WebView硬件加速和性能优化
     */
    private void setupWebViewHardwareAcceleration(WebView webView) {
        WebSettings settings = webView.getSettings();

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        Log.d(TAG, "WebView硬件加速已启用");

        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setRenderPriority(WebSettings.RenderPriority.HIGH);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Android 8.0+ 优化
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(false);
        }

        Log.d(TAG, "WebView性能优化配置完成");
    }
}
