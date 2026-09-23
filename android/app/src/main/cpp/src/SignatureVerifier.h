#ifndef SIGNATURE_VERIFIER_H
#define SIGNATURE_VERIFIER_H

#include <jni.h>

// JNI 可调用入口 — 由 JNIOnLoad.cpp 以无含义名 a 注册到 MikuPlayApplication
// 参数：jbyteArray — APK 签名证书 DER 编码字节
//       jboolean  — enforce：JNI_TRUE 时校验失败将触发随机延迟静默崩溃
// 返回：jboolean — JNI_TRUE 表示校验通过
jboolean verifySignature(JNIEnv* env, jbyteArray certBytes, jboolean enforce);

#endif
