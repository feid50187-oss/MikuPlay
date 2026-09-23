package com.akusera.mikuplayreburn;

import android.app.Application;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;

import org.acra.ACRA;
import org.acra.config.CoreConfigurationBuilder;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Arrays;

/**
 * 启动期自检（APK 签名 + 内置资源完整性）。
 * 逻辑集中在本类，核心比对在 native 层（libmikuplay_encoder.so）完成。
 *
 * 反 dex 特征策略：
 * 1. 校验相关 Java 代码全部收拢到本类，不再有 SignatureVerifier / ResourceVerifier 类名；
 * 2. native 方法名统一为无含义的 a/b（由 JNIOnLoad.cpp 的 RegisterNatives 注册）；
 * 3. 所有敏感字符串（库名、资源目录、反射用 API 名等）运行时 XOR 还原，dex 中无明文；
 * 4. 框架 API 全部走反射 + 运行期解密，避免 signingInfo 等特征字符串入 dex。
 */
public class MikuPlayApplication extends Application {

    // native 入口 — JNIOnLoad.cpp 以无含义名称 a/b 注册到本类
    // enforce=true（release 构建）时校验失败由 native 触发随机延迟静默崩溃
    private static native boolean a(byte[] certDer, boolean enforce); // 签名证书 SHA-256 校验
    private static native boolean b(byte[] data, boolean enforce);    // 资源拼接数据 SHA-256 校验

    @Override
    protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        // ACRA 初始化 — 捕获 Java 未处理异常/崩溃，写入本地文件
        // CrashReportSenderFactory 通过 @AutoService 自动注册，ACRA 经 ServiceLoader 发现
        ACRA.init(this, new CoreConfigurationBuilder()
                .withBuildConfigClass(BuildConfig.class)
        );
    }

    @Override
    public void onCreate() {
        // 1) 加载 native 库（触发 JNI_OnLoad 注册全部 native 方法）
        System.loadLibrary(decode(new byte[]{
                0x37, 0x32, 0x37, 0x28, 0x2E, 0x33, 0x01, 0x18,
                0x3D, 0x06, 0x0A, 0x06, 0x09, 0x03, 0x0D, 0x1B
        }));

        // 仅 release（非 debuggable）强制拦截；debug 构建不阻断，便于开发期证书/资源变动
        boolean enforce = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0;

        // 2) APK 签名校验
        verifySignature(this, enforce);

        // 3) 内置资源校验
        verifyResources(this, enforce);

        super.onCreate();
    }

    /**
     * APK 签名证书校验。
     * 框架 API（getPackageInfo / signingInfo / getApkContentsSigners / toByteArray）
     * 全部经反射调用，方法名在运行期解密，dex 中无特征字符串；
     * GET_SIGNING_CERTIFICATES 直接使用数值 0x08000000，避免字段名入 dex。
     */
    private static void verifySignature(Context ctx, boolean enforce) {
        try {
            PackageManager pm = ctx.getPackageManager();

            Object info = m(pm, decode(new byte[]{
                    0x3D, 0x3E, 0x28, 0x0D, 0x3F, 0x3C, 0x0B, 0x00,
                    0x05, 0x06, 0x2D, 0x0B, 0x00, 0x08}), String.class, int.class)
                    .invoke(pm, ctx.getPackageName(), 0x08000000);

            Object signingInfo = f(info, decode(new byte[]{
                    0x29, 0x32, 0x3B, 0x33, 0x37, 0x31, 0x07, 0x28,
                    0x0C, 0x05, 0x0B})).get(info);
            if (signingInfo == null) {
                return;
            }

            Object[] sigs = (Object[]) m(signingInfo, decode(new byte[]{
                    0x3D, 0x3E, 0x28, 0x1C, 0x2E, 0x34, 0x23, 0x0E, 0x0C,
                    0x17, 0x01, 0x0B, 0x12, 0x14, 0x3B, 0x00, 0x0D, 0x05,
                    0x09, 0x1F, 0x1D})).invoke(signingInfo);
            if (sigs == null || sigs.length == 0) {
                return;
            }

            byte[] der = (byte[]) m(sigs[0], decode(new byte[]{
                    0x2E, 0x34, 0x1E, 0x24, 0x2A, 0x3A, 0x21, 0x13,
                    0x10, 0x02, 0x1D})).invoke(sigs[0]);

            a(der, enforce);
        } catch (Throwable ignored) {
            // 校验失败静默返回（与既有行为一致；需要拦截时在此接入崩溃逻辑）
        }
    }

    /**
     * 内置资源完整性校验。
     * 读取 assets/public/js/ 下所有 .js 文件，按文件名排序后拼接，
     * 交给 native 层计算 SHA-256 并与预置指纹比对。
     */
    private static void verifyResources(Context ctx, boolean enforce) {
        try {
            AssetManager am = ctx.getAssets();
            String dir = decode(new byte[]{0x2A, 0x2E, 0x3E, 0x31, 0x37, 0x3C, 0x4F, 0x0B, 0x11});
            String suffix = decode(new byte[]{0x74, 0x31, 0x2F});

            String[] files = am.list(dir);
            if (files == null) {
                return;
            }
            Arrays.sort(files);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            int count = 0;
            byte[] buf = new byte[8192];
            for (String name : files) {
                if (!name.endsWith(suffix)) {
                    continue;
                }
                try (InputStream is = am.open(dir + "/" + name)) {
                    int n;
                    while ((n = is.read(buf)) != -1) {
                        out.write(buf, 0, n);
                    }
                }
                count++;
            }
            if (count == 0) {
                return;
            }

            b(out.toByteArray(), enforce);
        } catch (Throwable ignored) {
            // 校验失败静默返回（与既有行为一致；需要拦截时在此接入崩溃逻辑）
        }
    }

    /** 运行期 XOR 还原字符串（key 随字节下标递增，dex 中仅存密文字节）。 */
    private static String decode(byte[] d) {
        char[] c = new char[d.length];
        for (int i = 0; i < d.length; i++) {
            c[i] = (char) ((d[i] & 0xFF) ^ (0x5A + i));
        }
        return new String(c);
    }

    private static Method m(Object o, String name, Class<?>... params) throws Exception {
        return o.getClass().getMethod(name, params);
    }

    private static Field f(Object o, String name) throws Exception {
        return o.getClass().getField(name);
    }
}
