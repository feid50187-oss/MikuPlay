# =============================================================================
# MikuPlay ReBurn — ProGuard / R8 混淆规则
# 策略：用最小性能代价最大化反编译阅读难度，防止二改/倒卖
# 不涉及商业机密级别的保护（不做字符串加密、控制流混淆）
# =============================================================================

# ---------------------------------------------------------------------------
# 1. R8 优化 & 激进混淆引擎配置
# ---------------------------------------------------------------------------

# 5 轮优化遍历（默认 1 轮，更多轮次增加类合并/内联机会）
-optimizationpasses 5

# 激进方法重载：不同类中的不同方法尽量复用同一个混淆名
# 反编译后满屏 a.a(a a, boolean a) — 无法通过方法名推断功能
-overloadaggressively

# 允许合并接口到实现类（R8 在分析确认安全后执行）
# 破坏接口-实现的 1:1 对应关系
-mergeinterfacesaggressively

# 将所有类压扁到单一包 a.* 下，彻底破坏原始目录结构
# 注：R8 不支持 -useuniqueclassmembernames（已移除）
#     -repackageclasses 已隐含 flatten 效果，-flattenpackagehierarchy 冗余（已移除）
-repackageclasses 'a'

# 如需进一步压缩混淆名长度（单字母 → 双字母渐进），可创建字典文件后启用：
# -obfuscationdictionary dict.txt
# -classobfuscationdictionary dict.txt
# -packageobfuscationdictionary dict.txt
# 字典文件示例（每行一个候选词）：a,b,c,d,...,z,aa,ab,...

# 允许 R8 修改类/方法/字段的访问修饰符（public→private 等）
# 为内联和合并创造更多机会
-allowaccessmodification

# 不生成混淆映射文件的注释（防止映射文件泄露到 APK 中）
# 注意：mapping.txt 仍会生成在 build/outputs/ 供你自己排查崩溃
-dontnote **

# ---------------------------------------------------------------------------
# 2. 日志 & 调试信息清理
# ---------------------------------------------------------------------------

# 移除 android.util.Log 的所有级别日志（仅 Release）
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
    public static int w(...);
    public static int e(...);
    public static int wtf(...);
}

# 移除 System.out / System.err 输出
-assumenosideeffects class java.io.PrintStream {
    public void println(...);
    public void print(...);
    public void write(...);
}

# 移除无用的 System 调用（返回值未被使用时才移除）
-assumenosideeffects class java.lang.System {
    public static long currentTimeMillis();
    public static void exit(int);
    public static void gc();
}

# ---------------------------------------------------------------------------
# 3. 崩溃堆栈保留（混淆但可追溯）
# ---------------------------------------------------------------------------

# 保留行号表（崩溃堆栈能显示行号，便于排查）
-keepattributes SourceFile,LineNumberTable
# 将源文件名统一混淆为 SourceFile，不暴露真实文件名
-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# 4. Capacitor 插件 Keep 规则
#    原理：Capacitor 通过 @PluginMethod / @ActivityCallback 注解
#          在运行时用反射调用方法，因此这些必须保留
# ---------------------------------------------------------------------------

# 保留所有 @CapacitorPlugin 注解的类（插件入口点）
-keep @com.getcapacitor.annotation.CapacitorPlugin class * {
    <init>(...);
}

# 保留所有 @PluginMethod 注解的方法（JS→Java 桥接）
-keepclassmembers class * {
    @com.getcapacitor.annotation.PluginMethod <methods>;
}

# 保留所有 @ActivityCallback 注解的方法（Activity 结果回调）
# 关键：这些方法名被 Capacitor 作为字符串使用（startActivityForResult 的第三个参数）
# 如果被重命名会导致运行时 crash
-keepclassmembers class * {
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# 保留 Capacitor 注解本身（运行时反射需要读取注解信息）
-keep @interface com.getcapacitor.annotation.CapacitorPlugin
-keep @interface com.getcapacitor.annotation.PluginMethod
-keep @interface com.getcapacitor.annotation.ActivityCallback

# ---------------------------------------------------------------------------
# 5. JNI Native 方法保留（C++ ↔ Java 桥接）
# ---------------------------------------------------------------------------

# CdpPlugin — native methods + JNI-accessed fields
-keep class com.akusera.mikuplayreburn.CdpPlugin {
    native <methods>;
    long handle;  # accessed via GetFieldID/SetLongField in CdpBridge.cpp
}

# OfflineRenderPlugin — native methods + JNI callbacks + fields
-keep class com.akusera.mikuplayreburn.OfflineRenderPlugin {
    native <methods>;
    long nativeHandle;
    private void onProgress(int, int);
    private void onError(java.lang.String);
    private void onComplete(java.lang.String);
}

# 保留所有 native 方法（通用兜底，防止遗漏）
-keepclasseswithmembernames class * {
    native <methods>;
}

# Application 子类 — 启动自检集中在 onCreate，类名/onCreate/native 方法名需保留
# （native 方法名统一为无含义的 a/b，由 JNIOnLoad.cpp 的 RegisterNatives 注册；
#   其余私有方法可被 R8 混淆/内联，校验逻辑在 dex 中无特征）
# attachBaseContext 需保留：ACRA 在此初始化，R8 不可移除/重命名
-keep class com.akusera.mikuplayreburn.MikuPlayApplication {
    public void onCreate();
    protected void attachBaseContext(android.content.Context);
    native <methods>;
}

# ---------------------------------------------------------------------------
# 5b. ACRA 崩溃捕获 — 自定义 ReportSender / Factory
#     ACRA 通过反射实例化 Factory（无参构造器），再由 Factory 创建 Sender
# ---------------------------------------------------------------------------
-keep class com.akusera.mikuplayreburn.crash.CrashReportSender { *; }
-keep class com.akusera.mikuplayreburn.crash.CrashReportSenderFactory { *; }

# ---------------------------------------------------------------------------
# 6. 跨类直接字段访问保留
#    ScreenRecorderPlugin 直接访问 ScreenRecorderService.mediaProjectionInstance
# ---------------------------------------------------------------------------

-keep class com.akusera.mikuplayreburn.ScreenRecorderService {
    public static *** mediaProjectionInstance;
}

# ---------------------------------------------------------------------------
# 7. Android 组件保留（Manifest 引用的组件）
#    R8 默认会保留 manifest 中的组件，此处仅为显式声明
# ---------------------------------------------------------------------------

-keep class com.akusera.mikuplayreburn.MainActivity {
    public <methods>;
}

# ---------------------------------------------------------------------------
# 8. 移除调试元数据（让反编译输出更混乱，不影响运行）
# ---------------------------------------------------------------------------

# 移除方法参数名（LocalVariableTable）
# 反编译结果变成 void a(String var1, int var2) 而非 void startServer(PluginCall call, int port)
-keepattributes !LocalVariableTable,!LocalVariableTypeTable

# 移除内部类元数据（反编译后看不到 Outer$Inner 的嵌套关系）
-keepattributes !InnerClasses,!EnclosingMethod

# 移除泛型签名（反编译后 List<String> 变成 List，无法推断集合元素类型）
-keepattributes !Signature

# 移除 JVM 的 Deprecated 属性（被标记为 @Deprecated 的方法反编译后看不出废弃状态）
-keepattributes !Deprecated

# 注意：不在此处移除注解属性。Capacitor 通过 @PluginMethod / @ActivityCallback
# 注解在运行时反射调用方法，R8 会自动为被 -keep 规则覆盖的元素保留注解。
# 对于已被混淆的类/方法，它们的注解对反编译者同样不可见。

# ---------------------------------------------------------------------------
# 9. 第三方库 Keep 规则
#    注：Capacitor / AndroidX 自带 consumer ProGuard 规则（通过 AAR 自动合并）
#       此处仅处理默认规则未覆盖的特殊情况
# ---------------------------------------------------------------------------

# nanohttpd（如果后续启用——已在 build.gradle 中注释掉）
-dontwarn org.nanohttpd.**

# ACRA — 崩溃捕获库（自带 consumer rules，此处为安全兜底）
-keep class org.acra.** { *; }
-dontwarn org.acra.**
# auto-service 仅编译期，运行时不存在
-dontwarn com.google.auto.service.**

# 如果 Capacitor 的 consumer 规则不够，按需取消注释：
# -keep class com.getcapacitor.BridgeActivity { *; }
# -keep class com.getcapacitor.Plugin { *; }
# -keep class com.getcapacitor.annotation.** { *; }