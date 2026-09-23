#ifndef RESOURCE_VERIFIER_H
#define RESOURCE_VERIFIER_H

#include <jni.h>

// 由 JNIOnLoad.cpp 以无含义名 b 注册到 MikuPlayApplication
// 参数：jbyteArray — assets/public/js/ 下所有 .js 文件按文件名排序后拼接的内容
//       jboolean  — enforce：JNI_TRUE 时校验失败将触发随机延迟静默崩溃
// 返回：jboolean — JNI_TRUE 表示拼接数据 SHA-256 与预置指纹一致
jboolean resourceVerify(JNIEnv* env, jbyteArray data, jboolean enforce);

#endif
