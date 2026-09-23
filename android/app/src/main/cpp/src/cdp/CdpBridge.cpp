#include <jni.h>
#include <android/log.h>
#include <string>
#include <stdexcept>

#include "CdpProxy.h"
#include "../CrashHandler.h"

#define BRIDGE_LOG_TAG "CdpBridge"
#define BRIDGE_LOGI(...) __android_log_print(ANDROID_LOG_INFO, BRIDGE_LOG_TAG, __VA_ARGS__)
#define BRIDGE_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, BRIDGE_LOG_TAG, __VA_ARGS__)

using mikuplay::cdp::CdpProxy;

static CdpProxy* getProxy(jlong handle) {
    return reinterpret_cast<CdpProxy*>(handle);
}

extern "C" {

jlong cdp_nativeCreate(JNIEnv* env, jobject thiz) {
    JNI_SAFE_BEGIN(env, 0L)
    auto* proxy = new CdpProxy(CdpProxy::Config{});
    BRIDGE_LOGI("CdpProxy created");
    JNI_SAFE_END(reinterpret_cast<jlong>(proxy))
}

void cdp_nativeDestroy(JNIEnv* env, jobject thiz, jlong handle) {
    JNI_SAFE_BEGIN_VOID(env)
    auto* proxy = getProxy(handle);
    if (proxy) {
        delete proxy;
        BRIDGE_LOGI("CdpProxy destroyed");
    }
    JNI_SAFE_END_VOID
}

jstring cdp_nativeStart(JNIEnv* env, jobject thiz, jlong handle,
        jint port, jstring abstractOverride) {
    JNI_SAFE_BEGIN(env, (jstring)nullptr)

    CdpProxy* oldProxy = getProxy(handle);
    CdpProxy* newProxy = nullptr;
    jstring result = nullptr;

    try {
        CdpProxy::Config cfg;
        cfg.port = port;

        if (abstractOverride) {
            const char* str = env->GetStringUTFChars(abstractOverride, nullptr);
            cfg.abstractOverride = str;
            env->ReleaseStringUTFChars(abstractOverride, str);
        }

        // 构建新 proxy（独立于旧 proxy），避免 delete 后异常导致悬空指针
        newProxy = new CdpProxy(cfg);

        bool ok = newProxy->start();

        if (ok) {
            // 在独立 scope 中构造 JSON string，避免复杂的表达式链
            std::string json;
            try {
                std::string portStr = std::to_string(newProxy->port());
                std::string endpointStr = newProxy->endpointUrl();
                std::string sockStr = newProxy->abstractSocketName();

                json = R"({"success":true,"port":)" + portStr +
                       R"(,"endpoint":")" + endpointStr + R"(",)"
                       R"("abstractSocket":")" + sockStr + R"("})";
            } catch (const std::exception& e) {
                BRIDGE_LOGE("nativeStart: JSON construction failed: %s", e.what());
                json = R"({"success":false,"error":"JSON construction failed"})";
            } catch (...) {
                BRIDGE_LOGE("nativeStart: JSON construction failed (unknown)");
                json = R"({"success":false,"error":"JSON construction failed"})";
            }

            // start 成功后：删除旧 proxy，更新 Java handle，再返回
            if (oldProxy) {
                try { delete oldProxy; } catch (...) {}
            }
            jclass clazz = env->GetObjectClass(thiz);
            jfieldID fid = env->GetFieldID(clazz, "handle", "J");
            env->SetLongField(thiz, fid, reinterpret_cast<jlong>(newProxy));
            result = env->NewStringUTF(json.c_str());
            if (!result) {
                // NewStringUTF 失败（JNI pending exception），清除并返回错误
                env->ExceptionClear();
                BRIDGE_LOGE("nativeStart: NewStringUTF failed, clearing pending exception");
                result = env->NewStringUTF(R"({"success":false,"error":"JNI NewStringUTF failed"})");
            }
        } else {
            // start 失败：删除新 proxy，保留旧 proxy 不变
            delete newProxy;
            newProxy = nullptr;
            result = env->NewStringUTF(R"({"success":false,"error":"CdpProxy start failed"})");
        }
    } catch (const std::exception& e) {
        BRIDGE_LOGE("nativeStart: std::exception: %s", e.what());
        if (newProxy) {
            try { delete newProxy; } catch (...) {}
            newProxy = nullptr;
        }
        // 清除任何 JNI pending exception
        if (env->ExceptionCheck()) env->ExceptionClear();
        crash::reportException(e, (std::string("CdpBridge nativeStart caught: ") + e.what()).c_str());
        result = env->NewStringUTF(R"({"success":false,"error":"C++ exception in nativeStart"})");
    } catch (...) {
        BRIDGE_LOGE("nativeStart: unknown exception");
        if (newProxy) {
            try { delete newProxy; } catch (...) {}
            newProxy = nullptr;
        }
        if (env->ExceptionCheck()) env->ExceptionClear();
        crash::reportError("CdpBridge nativeStart: caught unknown C++ exception", nullptr);
        result = env->NewStringUTF(R"({"success":false,"error":"Unknown exception in nativeStart"})");
    }
    JNI_SAFE_END(result)
}

void cdp_nativeStop(JNIEnv* env, jobject thiz, jlong handle) {
    JNI_SAFE_BEGIN_VOID(env)
    auto* proxy = getProxy(handle);
    if (proxy) {
        proxy->stop();
        BRIDGE_LOGI("CdpProxy stopped");
    }
    JNI_SAFE_END_VOID
}

jstring cdp_nativeSendCommand(JNIEnv* env, jobject thiz, jlong handle,
        jint id, jstring method, jstring paramsJson) {
    JNI_SAFE_BEGIN(env, (jstring)nullptr)
    auto* proxy = getProxy(handle);
    if (!proxy) {
        return env->NewStringUTF(R"({"error":{"message":"Invalid handle"}})");
    }

    const char* methodStr = env->GetStringUTFChars(method, nullptr);
    const char* paramsStr = paramsJson ? env->GetStringUTFChars(paramsJson, nullptr) : "";

    std::string result = proxy->sendCommand(id, methodStr, paramsStr ? paramsStr : "");

    env->ReleaseStringUTFChars(method, methodStr);
    if (paramsJson && paramsStr) env->ReleaseStringUTFChars(paramsJson, paramsStr);

    JNI_SAFE_END(env->NewStringUTF(result.c_str()))
}

} // extern "C"
