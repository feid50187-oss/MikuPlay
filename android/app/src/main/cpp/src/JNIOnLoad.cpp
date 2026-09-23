#include <jni.h>
#include <android/log.h>
#include <string>
#include "SignatureVerifier.h"
#include "ResourceVerifier.h"
#include "AnnouncementManager.h"
#include "FeedbackResource.h"
#include "CrashHandler.h"

#define TAG "JNIOnLoad"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

// Forward declarations — defined in JNIBridge.cpp 和 CdpBridge.cpp
extern "C" {
jlong   orp_nativeCreate(JNIEnv*, jobject);
void    orp_nativeDestroy(JNIEnv*, jobject, jlong);
jboolean orp_nativeStartServer(JNIEnv*, jobject, jlong, jint);
void    orp_nativeStopServer(JNIEnv*, jobject, jlong);

jlong   cdp_nativeCreate(JNIEnv*, jobject);
void    cdp_nativeDestroy(JNIEnv*, jobject, jlong);
jstring cdp_nativeStart(JNIEnv*, jobject, jlong, jint, jstring);
void    cdp_nativeStop(JNIEnv*, jobject, jlong);
jstring cdp_nativeSendCommand(JNIEnv*, jobject, jlong, jint, jstring, jstring);

// 公告系统 — 定义在 AnnouncementManager.cpp（静态 native 方法，第二参数为 jclass）
jstring  ann_nativeGetVisibleAnnouncements(JNIEnv*, jclass, jobject);
void     ann_nativeMarkDontShow(JNIEnv*, jclass, jobject, jstring);
jboolean ann_nativeSyncIfNeeded(JNIEnv*, jclass, jobject);

// 反馈/赞赏 — 定义在 FeedbackResource.cpp
jbyteArray feedback_getQrCodeBytes(JNIEnv*, jclass);
}

// 薄包装 — 为 MikuPlayApplication 提供匹配的 JNI 函数签名 (jclass)
static jboolean chk_nativeSig(JNIEnv* env, jclass /*clazz*/, jbyteArray certBytes, jboolean enforce) {
    JNI_SAFE_BEGIN(env, JNI_FALSE)
    JNI_SAFE_END(verifySignature(env, certBytes, enforce))
}
static jboolean chk_nativeRes(JNIEnv* env, jclass /*clazz*/, jbyteArray data, jboolean enforce) {
    JNI_SAFE_BEGIN(env, JNI_FALSE)
    JNI_SAFE_END(resourceVerify(env, data, enforce))
}

// ── 给公告/反馈方法做二次包装：保持原来的 C extern 名字不变，
//    但 RegisterNatives 时不直接注册外部定义的实现，而是注册我们的
//    包装函数，包装函数带 JNI_SAFE_*。这样原实现不必改。
static jstring wrap_ann_nativeGetVisibleAnnouncements(JNIEnv* env, jclass cls, jobject ctx) {
    JNI_SAFE_BEGIN(env, (jstring)nullptr)
    JNI_SAFE_END(ann_nativeGetVisibleAnnouncements(env, cls, ctx))
}
static void wrap_ann_nativeMarkDontShow(JNIEnv* env, jclass cls, jobject ctx, jstring key) {
    JNI_SAFE_BEGIN_VOID(env)
    ann_nativeMarkDontShow(env, cls, ctx, key);
    JNI_SAFE_END_VOID
}
static jboolean wrap_ann_nativeSyncIfNeeded(JNIEnv* env, jclass cls, jobject ctx) {
    JNI_SAFE_BEGIN(env, JNI_FALSE)
    JNI_SAFE_END(ann_nativeSyncIfNeeded(env, cls, ctx))
}
static jbyteArray wrap_feedback_getQrCodeBytes(JNIEnv* env, jclass cls) {
    JNI_SAFE_BEGIN(env, (jbyteArray)nullptr)
    JNI_SAFE_END(feedback_getQrCodeBytes(env, cls))
}

static int registerOfflineRenderPlugin(JNIEnv* env) {
    const char* cls = "com/akusera/mikuplayreburn/OfflineRenderPlugin";
    const JNINativeMethod methods[] = {
        {"nativeCreate",      "()J",   (void*)orp_nativeCreate},
        {"nativeDestroy",     "(J)V",  (void*)orp_nativeDestroy},
        {"nativeStartServer", "(JI)Z", (void*)orp_nativeStartServer},
        {"nativeStopServer",  "(J)V",  (void*)orp_nativeStopServer},
    };
    jclass clazz = env->FindClass(cls);
    if (!clazz) { LOGE("FindClass 失败: %s", cls); return JNI_ERR; }
    jint ret = env->RegisterNatives(clazz, methods, 4);
    if (ret != JNI_OK) { LOGE("RegisterNatives 失败: %s", cls); return JNI_ERR; }
    LOGD("已注册 %s 的 4 个方法", cls);
    return JNI_OK;
}

static int registerCdpPlugin(JNIEnv* env) {
    const char* cls = "com/akusera/mikuplayreburn/CdpPlugin";
    const JNINativeMethod methods[] = {
        {"nativeCreate",      "()J",                                                 (void*)cdp_nativeCreate},
        {"nativeDestroy",     "(J)V",                                                (void*)cdp_nativeDestroy},
        {"nativeStart",       "(JILjava/lang/String;)Ljava/lang/String;",            (void*)cdp_nativeStart},
        {"nativeStop",        "(J)V",                                                (void*)cdp_nativeStop},
        {"nativeSendCommand", "(JILjava/lang/String;Ljava/lang/String;)Ljava/lang/String;", (void*)cdp_nativeSendCommand},
    };
    jclass clazz = env->FindClass(cls);
    if (!clazz) { LOGE("FindClass 失败: %s", cls); return JNI_ERR; }
    jint ret = env->RegisterNatives(clazz, methods, 5);
    if (ret != JNI_OK) { LOGE("RegisterNatives 失败: %s", cls); return JNI_ERR; }
    LOGD("已注册 %s 的 5 个方法", cls);
    return JNI_OK;
}

static int registerChecks(JNIEnv* env) {
    // 启动自检统一注册到 Application 类（类名由 Manifest 引用，必须保留，
    // 方法名用无含义的 a/b，避免在 dex/so 中留下可检索的校验特征）
    const char* cls = "com/akusera/mikuplayreburn/MikuPlayApplication";
    const JNINativeMethod methods[] = {
        {"a", "([BZ)Z", (void*)chk_nativeSig},  // 签名证书校验
        {"b", "([BZ)Z", (void*)chk_nativeRes},  // 资源指纹校验
    };
    jclass clazz = env->FindClass(cls);
    if (!clazz) { LOGE("FindClass 失败: %s", cls); return JNI_ERR; }
    jint ret = env->RegisterNatives(clazz, methods, 2);
    if (ret != JNI_OK) { LOGE("RegisterNatives 失败: %s", cls); return JNI_ERR; }
    return JNI_OK;
}

static int registerAnnouncementBridge(JNIEnv* env) {
    const char* cls = "com/akusera/mikuplayreburn/AnnouncementBridge";
    const JNINativeMethod methods[] = {
        {"nativeGetVisibleAnnouncements", "(Landroid/content/Context;)Ljava/lang/String;",
            (void*)wrap_ann_nativeGetVisibleAnnouncements},
        {"nativeMarkDontShow", "(Landroid/content/Context;Ljava/lang/String;)V",
            (void*)wrap_ann_nativeMarkDontShow},
        {"nativeSyncIfNeeded", "(Landroid/content/Context;)Z",
            (void*)wrap_ann_nativeSyncIfNeeded},
    };
    jclass clazz = env->FindClass(cls);
    if (!clazz) { LOGE("FindClass 失败: %s", cls); return JNI_ERR; }
    jint ret = env->RegisterNatives(clazz, methods, 3);
    if (ret != JNI_OK) { LOGE("RegisterNatives 失败: %s", cls); return JNI_ERR; }
    LOGD("已注册 %s 的 3 个方法", cls);
    return JNI_OK;
}

static int registerFeedbackBridge(JNIEnv* env) {
    const char* cls = "com/akusera/mikuplayreburn/FeedbackBridge";
    const JNINativeMethod methods[] = {
        {"nativeGetQrCodeBytes", "()[B", (void*)wrap_feedback_getQrCodeBytes},
    };
    jclass clazz = env->FindClass(cls);
    if (!clazz) { LOGE("FindClass 失败: %s", cls); return JNI_ERR; }
    jint ret = env->RegisterNatives(clazz, methods, 1);
    if (ret != JNI_OK) { LOGE("RegisterNatives 失败: %s", cls); return JNI_ERR; }
    LOGD("已注册 %s 的 1 个方法", cls);
    return JNI_OK;
}

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
    // 崩溃捕获最先初始化：后续 JNI 注册 / 自检若抛异常或崩溃，都能写日志
    crash::init();

    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        LOGE("JNI_OnLoad: GetEnv 失败");
        return JNI_ERR;
    }
    if (registerOfflineRenderPlugin(env) != JNI_OK) return JNI_ERR;
    if (registerCdpPlugin(env) != JNI_OK) return JNI_ERR;
    if (registerChecks(env) != JNI_OK) return JNI_ERR;
    if (registerAnnouncementBridge(env) != JNI_OK) return JNI_ERR;
    if (registerFeedbackBridge(env) != JNI_OK) return JNI_ERR;
    return JNI_VERSION_1_6;
}
