// ==========================================================================
//  CrashHandler — C++ 崩溃/错误捕获 + 运行时函数名栈回溯
// ==========================================================================
//
//  功能：
//   1. 信号崩溃：SIGSEGV / SIGABRT / SIGBUS / SIGFPE / SIGILL / SIGTRAP → 写日志
//   2. terminate：C++ 未捕获异常 / noexcept 违规 / 线程 join 异常 → 写日志
//   3. 已捕获异常：CppError::report(e, extra) → 写日志（应用不退出）
//   4. 日志命名：/sdcard/MikuPlay错误日志YYYYMMDDHHMMSS（BJT）.txt
//   5. 栈回溯：_Unwind_Backtrace (eh_frame DWARF) + dladdr 动态符号
//              + 自定义函数名注册表（hidden 函数回退）
//
//  注册函数名宏 —— 在 JNI 边界 / 关键 hidden 函数首行调用：
//      CPP_FUNC_REG(Name_Of_This_Function);     // 不重复注册，地址取自 __builtin_return_address(0)
//  更通用：JNI 入口包装宏 JNI_SAFE_BEGIN/JNI_SAFE_END 自动注册
//
//  JNI 边界宏：
//      JNI_SAFE_BEGIN(env, default_ret)        // 在 JNI 导出函数第一行
//      try {                                   // 进入 try 块
//      ... 业务逻辑 ...
//      JNI_SAFE_END_NORET                       // 函数无返回值 (void)
//      JNI_SAFE_END(ret_val)                    // 函数有返回值，正常时返回 ret_val
//  JNI 导出内部抛出的任何异常都会被 catch，写崩溃日志（函数名+栈），
//  并返回 default_ret / default_java_ret，避免 C++ 异常泄露到 JVM。
// ==========================================================================

#ifndef MIKUPLAY_CRASH_HANDLER_H
#define MIKUPLAY_CRASH_HANDLER_H

#include <jni.h>
#include <string>
#include <exception>
#include <cstddef>
#include <cstdint>

namespace crash {

// ---------- 初始化 ----------
// 在 JNI_OnLoad 最先调用。重复调用安全（仅首个执行）。
void init();

// ---------- 上报：已捕获异常 / 错误 ----------
// 写入日志（带栈 + 函数名），应用不退出。
// extra 为附加文本（可为空）。
void reportException(const std::exception& e, const char* extra = nullptr);

// 非异常类错误（比如逻辑断言失败），同样写日志 + 栈。
void reportError(const char* what, const char* extra = nullptr);

// ---------- 函数名注册表（运行时按地址二分查找） ----------
// 入口地址取当前函数返回地址（即调用者地址），不需要把自己作为参数传。
// 用法：在函数首行写   CPP_FUNC_REG(MyClass_doWork);
//       名字用字符串形式（不含空格），无需包含 return 类型/参数。
struct __FuncReg {
    __FuncReg(const char* name);
    uintptr_t addr;
    const char* name;
};
#define CPP_FUNC_REG(func_name)  \
    static crash::__FuncReg __func_reg_##func_name(#func_name);

// 宏辅助：取当前函数的返回地址（即调用者，等于"当前函数被调用后要回到的地址"）
// 实际上注册的是 __builtin_return_address(0) 所属的"调用者函数"。
// 为简洁实用，让 CPP_FUNC_REG 在函数开头执行，取 __builtin_extract_return_addr 对应函数。
// 但更稳的做法是注册当前函数起始地址。我们使用 clang/gcc 的 __func__ 结合
// 一个构造函数内联 trick：取"调用 __FuncReg 构造的函数"起始地址不太容易，
// 所以退而求其次：注册 "调用点 return address" 的所属函数，该值属于调用方。
// 为解决此问题，提供显式版本：
void registerFunction(const void* funcAddr, const char* name);
#define CPP_FUNC_REG_AT(func_label, body)  \
    do {                                    \
        static bool __registered = false;    \
        if (!__registered) {                 \
            __registered = true;             \
            crash::registerFunction(reinterpret_cast<const void*>(&&__entry), #func_label); \
        }                                    \
    } while (0); __entry: body

} // namespace crash


// ==========================================================================
//  JNI 边界安全包装（try/catch + 崩溃日志 + 返回默认值）
// ==========================================================================
//
// 使用示例（JNIBridge.cpp）：
//
//   extern "C" jlong orp_nativeCreate(JNIEnv* env, jobject thiz) {
//       JNI_SAFE_BEGIN(env, 0L)
//       ... 正常逻辑 ...
//       JNI_SAFE_END(reinterpret_cast<jlong>(ctx))
//   }
//
//   extern "C" void orp_nativeDestroy(JNIEnv* env, jobject thiz, jlong h) {
//       JNI_SAFE_BEGIN_VOID(env)
//       ...
//       JNI_SAFE_END_VOID
//   }
//
// ==========================================================================

#define JNI_SAFE_BEGIN(env_, default_ret_)                                            \
    /* 注册 JNI 导出函数名（entry = 标签位置） */                                       \
    static bool __jni_safe_reg = false;                                                 \
    if (!__jni_safe_reg) {                                                              \
        __jni_safe_reg = true;                                                          \
        crash::registerFunction(reinterpret_cast<const void*>(&&__jni_safe_entry),      \
                                 __PRETTY_FUNCTION__);                                  \
    }                                                                                   \
    __jni_safe_entry:                                                                   \
    /* ★ env / 默认返回值放在 try 之前：catch 块也需要访问 */                             \
    JNIEnv* const __jni_safe_env = (env_);                                              \
    const auto __jni_safe_defret = (default_ret_);                                      \
    (void)__jni_safe_env; (void)__jni_safe_defret;                                      \
    try {

#define JNI_SAFE_END(retval_)                                                          \
        return (retval_);                                                              \
    } catch (const std::exception& __e) {                                              \
        crash::reportException(__e,                                                    \
            (std::string("JNI 边界捕获异常: ") + __PRETTY_FUNCTION__).c_str());        \
        /* 向 Java 抛 Exception，便于上层看到详情 */                                   \
        if (__jni_safe_env) {                                                          \
            jclass ex = __jni_safe_env->FindClass("java/lang/RuntimeException");       \
            if (ex) __jni_safe_env->ThrowNew(ex, __e.what());                          \
        }                                                                              \
        return __jni_safe_defret;                                                      \
    } catch (...) {                                                                    \
        crash::reportError("JNI 边界捕获未知非标准异常",                                \
            (std::string("出处: ") + __PRETTY_FUNCTION__).c_str());                    \
        if (__jni_safe_env) {                                                          \
            jclass ex = __jni_safe_env->FindClass("java/lang/RuntimeException");       \
            if (ex) __jni_safe_env->ThrowNew(ex, "unknown native exception");          \
        }                                                                              \
        return __jni_safe_defret;                                                      \
    }

#define JNI_SAFE_BEGIN_VOID(env_)                                                      \
    static bool __jni_safe_reg = false;                                                 \
    if (!__jni_safe_reg) {                                                              \
        __jni_safe_reg = true;                                                          \
        crash::registerFunction(reinterpret_cast<const void*>(&&__jni_safe_entry),      \
                                 __PRETTY_FUNCTION__);                                  \
    }                                                                                   \
    __jni_safe_entry:                                                                   \
    JNIEnv* const __jni_safe_env = (env_);                                              \
    (void)__jni_safe_env;                                                               \
    try {

#define JNI_SAFE_END_VOID                                                              \
        return;                                                                         \
    } catch (const std::exception& __e) {                                              \
        crash::reportException(__e,                                                    \
            (std::string("JNI 边界捕获异常: ") + __PRETTY_FUNCTION__).c_str());        \
        if (__jni_safe_env) {                                                          \
            jclass ex = __jni_safe_env->FindClass("java/lang/RuntimeException");       \
            if (ex) __jni_safe_env->ThrowNew(ex, __e.what());                          \
        }                                                                              \
        return;                                                                         \
    } catch (...) {                                                                    \
        crash::reportError("JNI 边界捕获未知非标准异常",                                \
            (std::string("出处: ") + __PRETTY_FUNCTION__).c_str());                    \
        if (__jni_safe_env) {                                                          \
            jclass ex = __jni_safe_env->FindClass("java/lang/RuntimeException");       \
            if (ex) __jni_safe_env->ThrowNew(ex, "unknown native exception");          \
        }                                                                              \
        return;                                                                         \
    }

#endif // MIKUPLAY_CRASH_HANDLER_H
