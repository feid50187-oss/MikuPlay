#include <jni.h>
#include "FeedbackResource.h"

// 构建时由 generate_qrcode_header.py 生成的嵌入资源头文件
#include "qrcode_embedded.h"

extern "C" {

jbyteArray feedback_getQrCodeBytes(JNIEnv* env, jclass /*clazz*/) {
    jbyteArray arr = env->NewByteArray(qrcode_jpg_len);
    if (!arr) return nullptr;
    env->SetByteArrayRegion(arr, 0, qrcode_jpg_len,
                            reinterpret_cast<const jbyte*>(qrcode_jpg));
    return arr;
}

} // extern "C"
