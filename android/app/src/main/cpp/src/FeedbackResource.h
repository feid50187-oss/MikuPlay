#ifndef FEEDBACK_RESOURCE_H
#define FEEDBACK_RESOURCE_H

#include <jni.h>

#ifdef __cplusplus
extern "C" {
#endif

// 从 SO 嵌入数据中提取赞赏二维码 JPEG 字节。
// 返回 jbyteArray，Java 层通过 BitmapFactory 解码为 Bitmap。
jbyteArray feedback_getQrCodeBytes(JNIEnv* env, jclass clazz);

#ifdef __cplusplus
}
#endif

#endif
