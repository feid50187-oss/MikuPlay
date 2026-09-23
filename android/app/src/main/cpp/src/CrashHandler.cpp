// ==========================================================================
//  CrashHandler.cpp — 实现
// ==========================================================================
//  栈回溯：_Unwind_Backtrace() + _Unwind_GetIP()
//  符号解析：
//    1) dladdr() 从动态符号表 (.dynsym) → JNI 导出 extern "C" 函数 / 系统库 / default 可见性
//    2) 注册表里按地址范围二分查找 → hidden visibility 函数（CPP_FUNC_REG / JNI_SAFE_BEGIN 注册）
//  输出文件路径优先级:
//    /storage/emulated/0 (MANAGE_EXTERNAL_STORAGE 已授权)
//    → context.getExternalFilesDir(null)   （不可用则回退）
//    → context.getFilesDir()               （最终兜底）
//  外部存储路径没有 Context 可用时，直接用 libc 的 access() 试探 /sdcard/MikuPlay 是否可写，
//  否则退到 /data/data/<pkg>/files。
// ==========================================================================

#include "CrashHandler.h"

#include <android/log.h>
#include <unwind.h>                 // _Unwind_Backtrace
#include <dlfcn.h>                  // dladdr, Dl_info
#include <signal.h>                 // sigaction, siginfo_t
#include <ucontext.h>               // ucontext_t, sigcontext
#include <execinfo.h>               // backtrace_symbols (备选)
#include <cxxabi.h>                 // abi::__cxa_demangle

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <csetjmp>
#include <ctime>
#include <string>
#include <vector>
#include <algorithm>
#include <atomic>
#include <mutex>
#include <memory>

// POSIX 文件/系统调用（信号处理器中用 open/write 写日志）
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>

// Android 特有：没有 filesystem，但有 <fstream> 就行
#include <fstream>
#include <sstream>

#define LOG_TAG "CrashHandler"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)

namespace crash {

// ==========================================================================
//  函数名注册表（按 addr 升序，崩溃发生时 O(log n) 二分查找）
// ==========================================================================
struct FuncEntry {
    uintptr_t   addr;   // 函数起始地址
    const char* name;   // 名称（静态字符串，不释放）
    bool operator<(const FuncEntry& o) const { return addr < o.addr; }
};

static std::mutex& regMutex() {
    static std::mutex m;
    return m;
}
static std::vector<FuncEntry>& regEntries() {
    static std::vector<FuncEntry> v;
    return v;
}
static std::atomic<bool> regSorted{false};

void registerFunction(const void* funcAddr, const char* name) {
    if (!funcAddr || !name) return;
    std::lock_guard<std::mutex> lk(regMutex());
    auto& v = regEntries();
    // 去重：同地址不重复插入
    for (auto& e : v) {
        if (e.addr == reinterpret_cast<uintptr_t>(funcAddr)) return;
    }
    v.push_back({reinterpret_cast<uintptr_t>(funcAddr), name});
    regSorted.store(false, std::memory_order_release);
}

static const char* lookupFuncNameInRegistry(uintptr_t pc) {
    auto& v = regEntries();
    if (v.empty()) return nullptr;

    // 必要时排序（最多排序一次，之后只追加；每次追加都把 sorted=false）
    if (!regSorted.load(std::memory_order_acquire)) {
        std::lock_guard<std::mutex> lk(regMutex());
        if (!regSorted.load(std::memory_order_relaxed)) {
            std::sort(v.begin(), v.end());
            regSorted.store(true, std::memory_order_release);
        }
    }

    // 二分查找：找最大 addr <= pc
    std::lock_guard<std::mutex> lk(regMutex());
    if (v.empty()) return nullptr;
    int lo = 0, hi = (int)v.size();
    while (lo < hi) {
        int mid = (lo + hi) / 2;
        if (v[mid].addr <= pc) lo = mid + 1;
        else                    hi = mid;
    }
    // 若 lo == 0 没找到；否则 lo-1 是候选（addr <= pc 且最大）
    if (lo == 0) return nullptr;
    const auto& cand = v[(size_t)(lo - 1)];
    // 范围兜底：距离函数起点不超过 2MB（保守，防止跨库误匹配）
    if (pc - cand.addr > 2u * 1024u * 1024u) return nullptr;
    return cand.name;
}

__FuncReg::__FuncReg(const char* name) {
    // 按调用约定，this->addr 取构造点所在的调用者的地址：
    // 没有好的办法取函数首址；__FuncReg 实际上不再用（推荐直接用 registerFunction + 标签地址），
    // 但保持对外 API 不报错。
    (void)name;
    this->addr = 0;
    this->name = nullptr;
}

// ==========================================================================
//  栈回溯（_Unwind_Backtrace）
// ==========================================================================
struct BacktraceCtx {
    static constexpr int MAX = 64;
    uintptr_t pcs[MAX];
    int depth = 0;
};

static _Unwind_Reason_Code unwindCallback(struct _Unwind_Context* uc, void* arg) {
    BacktraceCtx* c = static_cast<BacktraceCtx*>(arg);
    if (c->depth >= BacktraceCtx::MAX) return _URC_END_OF_STACK;
    uintptr_t pc = _Unwind_GetIP(uc);
    // 跳过 0 / 非法地址
    if (pc == 0) return _URC_NO_REASON;
    c->pcs[c->depth++] = pc;
    return _URC_NO_REASON;
}

static void captureBacktrace(BacktraceCtx& out) {
    out.depth = 0;
    _Unwind_Backtrace(&unwindCallback, &out);
    // 第一帧通常是 CrashHandler 自己的函数，渲染时跳过
}

static std::string demangle(const char* sym) {
    if (!sym || !*sym) return {};
    int status = 0;
    char* d = abi::__cxa_demangle(sym, nullptr, nullptr, &status);
    if (d && status == 0) {
        std::string r(d);
        free(d);
        return r;
    }
    return std::string(sym);
}

// 渲染一帧为 "#n 0xaddr 库 (func+offset)"
static std::string renderFrame(int idx, uintptr_t pc) {
    char line[512];
    Dl_info info;
    memset(&info, 0, sizeof(info));
    bool dlok = (dladdr(reinterpret_cast<void*>(pc), &info) != 0);

    const char* dli_name = (dlok && info.dli_sname) ? info.dli_sname : nullptr;
    uintptr_t dli_saddr = (dlok && info.dli_saddr) ? reinterpret_cast<uintptr_t>(info.dli_saddr) : 0;

    // 名字优先级：dladdr 动态符号 → 自定义注册表
    std::string func;
    uintptr_t base = 0;
    if (dli_name) {
        func = demangle(dli_name);
        base = dli_saddr;
    } else {
        const char* reg = lookupFuncNameInRegistry(pc);
        if (reg) {
            func = demangle(reg);
            // 注册表只存起始地址，没存 dli_saddr 精确值
            base = 0;
        }
    }

    const char* lib = (dlok && info.dli_fname) ? info.dli_fname : "???";
    // 计算偏移
    char offset[40];
    if (base != 0 && pc >= base) {
        snprintf(offset, sizeof(offset), "+0x%x", (unsigned)(pc - base));
    } else {
        offset[0] = 0;
    }
    if (func.empty()) {
        // 没有名字，用库里的基址算偏移
        uintptr_t fbase = (dlok && info.dli_fbase) ? reinterpret_cast<uintptr_t>(info.dli_fbase) : 0;
        if (fbase != 0 && pc >= fbase) {
            snprintf(line, sizeof(line), "#%-2d 0x%016llx  %s (offset 0x%llx)",
                     idx, (unsigned long long)pc, lib,
                     (unsigned long long)(pc - fbase));
        } else {
            snprintf(line, sizeof(line), "#%-2d 0x%016llx  %s",
                     idx, (unsigned long long)pc, lib);
        }
    } else {
        snprintf(line, sizeof(line), "#%-2d 0x%016llx  %s (%s%s)",
                 idx, (unsigned long long)pc, lib, func.c_str(), offset);
    }
    return std::string(line);
}

static std::string formatStack(const BacktraceCtx& bt, int skip = 0) {
    std::string s;
    for (int i = skip; i < bt.depth; ++i) {
        s += renderFrame(i - skip, bt.pcs[i]);
        s += "\n";
    }
    if (bt.depth <= skip) s += "  (empty backtrace)\n";
    return s;
}

// ==========================================================================
//  文件路径 / 写日志
// ==========================================================================

// 生成文件时间戳：YYYYMMDDHHMMSS（北京时间，Asia/Shanghai）
static std::string bjtStamp() {
    time_t t = time(nullptr);
    // tzset 可设置 TZ，但 localtime_r 依赖系统 TZ；若系统时区默认非东八，我们手动加 8h
    // 简单做法：始终按 UTC+8 计算，不依赖 /system TZ
    time_t bjt = t + 8LL * 3600LL;
    struct tm utc;
    gmtime_r(&bjt, &utc);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y%m%d%H%M%S", &utc);
    return std::string(buf);
}

static std::string readableBJT() {
    time_t t = time(nullptr);
    time_t bjt = t + 8LL * 3600LL;
    struct tm utc;
    gmtime_r(&bjt, &utc);
    char buf[32];
    strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", &utc);
    return std::string(buf);
}

// 选日志输出目录：用 /sdcard/ (即 /storage/emulated/0/)；不可写则 fallback
static std::string pickLogDir() {
    const char* candidates[] = {
        "/sdcard",
        "/storage/emulated/0",
        nullptr
    };
    for (int i = 0; candidates[i]; ++i) {
        std::string test = std::string(candidates[i]) + "/.MikuPlayWriteTest_XXXXXX";
        // mkstemp 需要可写 char* 缓冲区
        std::vector<char> path(test.begin(), test.end());
        path.push_back(0);
        int fd = mkstemp(path.data());
        if (fd >= 0) {
            close(fd);
            unlink(path.data());
            return std::string(candidates[i]);
        }
    }
    // fallback: /data/data/<pkg>/files 或 /data/local/tmp
    const char* alt = "/data/local/tmp";
    std::string test = std::string(alt) + "/.MikuPlayWriteTest_XXXXXX";
    std::vector<char> p(test.begin(), test.end());
    p.push_back(0);
    int fd = mkstemp(p.data());
    if (fd >= 0) {
        close(fd);
        unlink(p.data());
        return alt;
    }
    return "/sdcard";  // 最后兜底
}

static std::string currentLogDir() {
    static std::string cache;
    static std::once_flag once;
    std::call_once(once, []() { cache = pickLogDir(); });
    return cache;
}

static std::string makeLogPath(const char* kind) {
    return currentLogDir() + "/MikuPlay错误日志" + bjtStamp() + "（BJT）.txt";
}

// 写日志正文
static void writeLogFile(const std::string& title,
                         const std::string& what,
                         const std::string& extra,
                         const BacktraceCtx& bt,
                         int btSkip) {
    std::string path = makeLogPath("crash");
    std::ofstream f(path, std::ios::app);
    if (!f) {
        LOGE("写崩溃日志失败: %s", path.c_str());
        return;
    }
    f << "═══════════════════════════════════════════════════════════\n";
    f << "              MikuPlay 原生 (C++) 错误日志\n";
    f << "═══════════════════════════════════════════════════════════\n";
    f << "  时间: " << readableBJT() << " (BJT, UTC+8)\n";
    f << "  类型: " << title << "\n";
    f << "  文件: " << path << "\n";
    f << "═══════════════════════════════════════════════════════════\n\n";

    f << "【错误信息】\n";
    f << "  " << what << "\n\n";

    if (!extra.empty()) {
        f << "【附加说明】\n";
        f << "  " << extra << "\n\n";
    }

    f << "【调用栈 (运行时函数名)】\n";
    f << formatStack(bt, btSkip);
    f << "\n";

    // 注册表统计
    {
        size_t n;
        {
            std::lock_guard<std::mutex> lk(regMutex());
            n = regEntries().size();
        }
        if (n > 0) {
            f << "【自定义函数名注册表】 已注册 " << n << " 项\n";
        }
    }

    f << "═══════════════════════════════════════════════════════════\n";
    f << "                       日志结束\n";
    f << "═══════════════════════════════════════════════════════════\n";

    f.flush();
    LOGI("已写入 %s 日志: %s", title.c_str(), path.c_str());
}

// ==========================================================================
//  已捕获异常 / 错误上报
// ==========================================================================
void reportException(const std::exception& e, const char* extra) {
    BacktraceCtx bt;
    captureBacktrace(bt);
    writeLogFile("C++ 已捕获异常 (reportException)",
                 e.what() ? e.what() : "(std::exception with empty what())",
                 extra ? extra : "",
                 bt, 1);  // skip: 1 for reportException self
}

void reportError(const char* what, const char* extra) {
    BacktraceCtx bt;
    captureBacktrace(bt);
    writeLogFile("C++ 错误 (reportError)",
                 what ? what : "(no description)",
                 extra ? extra : "",
                 bt, 1);
}

// ==========================================================================
//  信号崩溃处理器
// ==========================================================================
// 为信号处理器提供的 write 函数（不能用 std::ofstream / malloc，因为
// 信号上下文异步不安全），用 open/write 系统调用。
static volatile bool gHandlingCrash = false;

static void asyncWriteAll(int fd, const char* buf, size_t n) {
    while (n > 0) {
        ssize_t w = write(fd, buf, n);
        if (w <= 0) return;
        buf += w;
        n -= (size_t)w;
    }
}

static void asyncWriteStr(int fd, const char* s) {
    if (!s) return;
    asyncWriteAll(fd, s, strlen(s));
}

static void asyncWriteNum(int fd, unsigned long long v, int base = 16, int minWidth = 1) {
    char buf[32];
    int i = 0;
    if (v == 0) buf[i++] = '0';
    else while (v > 0) {
        int d = (int)(v % base);
        buf[i++] = (char)((d < 10) ? ('0' + d) : ('a' + d - 10));
        v /= base;
    }
    while (i < minWidth) buf[i++] = '0';
    // reverse
    for (int j = 0; j < i / 2; ++j) {
        char t = buf[j]; buf[j] = buf[i - 1 - j]; buf[i - 1 - j] = t;
    }
    asyncWriteAll(fd, buf, (size_t)i);
}

// 信号名
static const char* signame(int sig) {
    switch (sig) {
        case SIGSEGV: return "SIGSEGV (内存访问越界 / 空指针)";
        case SIGABRT: return "SIGABRT (abort() / NDEBUG 断言失败 / std::terminate)";
        case SIGBUS:  return "SIGBUS  (总线错误 / 未对齐访存)";
        case SIGFPE:  return "SIGFPE  (浮点错误 / 整数除零)";
        case SIGILL:  return "SIGILL  (非法指令)";
        case SIGTRAP: return "SIGTRAP (调试陷阱)";
        default:      return "UNKNOWN";
    }
}

// 信号上下文取 PC（aarch64 / arm / x86_64 兼容）
static uintptr_t extractPcFromSigContext(int sig, siginfo_t* si, void* uctx) {
    (void)sig; (void)si;
    if (!uctx) return 0;
    auto* uc = static_cast<ucontext_t*>(uctx);
    mcontext_t& mc = uc->uc_mcontext;
#if defined(__aarch64__)
    // NDK aarch64 mcontext_t = struct sigcontext，含 .pc 字段
    auto* sc = reinterpret_cast<struct sigcontext*>(&mc);
    return sc->pc;
#elif defined(__arm__)
    return mc.arm_pc;
#elif defined(__x86_64__)
    return mc.gregs[REG_RIP];
#elif defined(__i386__)
    return mc.gregs[REG_EIP];
#else
    (void)mc;
    return 0;
#endif
}

static void signalHandler(int sig, siginfo_t* si, void* uctx) {
    // 防重入：连续信号不递归处理
    if (gHandlingCrash) {
        const char* msg = "[CrashHandler] 信号重入，终止进程\n";
        (void)!write(STDERR_FILENO, msg, strlen(msg));
        // 重置默认处理器并重新触发
        signal(sig, SIG_DFL);
        raise(sig);
        return;
    }
    gHandlingCrash = true;

    // ---- 打开日志文件 ----
    std::string stamp = bjtStamp();
    std::string dir = pickLogDir();
    std::string path = dir + "/MikuPlay错误日志" + stamp + "（BJT）.txt";
    int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_APPEND, 0666);
    if (fd < 0) {
        // fallback stderr
        fd = STDERR_FILENO;
    }

    asyncWriteStr(fd, "═══════════════════════════════════════════════════════════\n");
    asyncWriteStr(fd, "            MikuPlay 原生 (C++) 崩溃日志 (信号)\n");
    asyncWriteStr(fd, "═══════════════════════════════════════════════════════════\n");
    asyncWriteStr(fd, "  时间: "); asyncWriteStr(fd, readableBJT().c_str()); asyncWriteStr(fd, " (BJT, UTC+8)\n");
    asyncWriteStr(fd, "  信号: "); asyncWriteStr(fd, signame(sig));
    char nbuf[32]; snprintf(nbuf, sizeof(nbuf), " (%d)\n", sig); asyncWriteStr(fd, nbuf);
    if (si) {
        char sfault[64];
        snprintf(sfault, sizeof(sfault), "  故障地址: 0x%016llx\n", (unsigned long long)si->si_addr);
        asyncWriteStr(fd, sfault);
        snprintf(sfault, sizeof(sfault), "  si_code:  %d\n", si->si_code);
        asyncWriteStr(fd, sfault);
    }
    asyncWriteStr(fd, "  文件: "); asyncWriteStr(fd, path.c_str()); asyncWriteStr(fd, "\n");
    asyncWriteStr(fd, "═══════════════════════════════════════════════════════════\n\n");

    // ---- 从信号上下文抽取 PC / SP 作为栈首帧 ----
    uintptr_t sigPc = extractPcFromSigContext(sig, si, uctx);
    if (sigPc != 0) {
        asyncWriteStr(fd, "【信号崩溃现场 PC】\n");
        std::string line = renderFrame(0, sigPc);
        asyncWriteStr(fd, line.c_str());
        asyncWriteStr(fd, "\n\n");
    }

    // ---- 栈回溯（注意：信号处理函数上下文不保证 _Unwind 稳定，
    //                 但 aarch64/arm/x86_64 + eh_frame 情况下可用）----
    BacktraceCtx bt;
    captureBacktrace(bt);

    asyncWriteStr(fd, "【调用栈 (运行时函数名)】\n");
    // 跳过：0 captureBacktrace / 1 signalHandler, 即从 signalHandler 调用方的上一层起展示
    int skip = 2;
    // 若 sigPc 不为 0，把它当做首帧输出；其余为普通 unwind
    if (sigPc != 0) {
        // sigPc 已经在上面单独展示过，但堆栈里再连起来：
        asyncWriteStr(fd, "# 0 (signal PC) -> 已在上方列出\n");
    }
    for (int i = skip; i < bt.depth; ++i) {
        std::string line = renderFrame(i - skip, bt.pcs[i]);
        asyncWriteStr(fd, line.c_str());
        asyncWriteStr(fd, "\n");
    }
    asyncWriteStr(fd, "\n");

    // ---- 注册表大小信息 ----
    size_t n;
    {
        std::unique_lock<std::mutex> lk(regMutex(), std::try_to_lock);
        if (lk.owns_lock()) n = regEntries().size();
        else n = (size_t)-1;
    }
    if (n != (size_t)-1) {
        char buf[80];
        snprintf(buf, sizeof(buf), "【自定义函数名注册表】 已注册 %zu 项\n", n);
        asyncWriteStr(fd, buf);
    }

    asyncWriteStr(fd, "═══════════════════════════════════════════════════════════\n");
    asyncWriteStr(fd, "                    日志结束，退出进程\n");
    asyncWriteStr(fd, "═══════════════════════════════════════════════════════════\n");

    if (fd != STDERR_FILENO) close(fd);
    else fsync(fd);

    // ---- 恢复默认处理器并重新发送信号让内核写 tombstone / 产生正确退出码 ----
    signal(sig, SIG_DFL);
    raise(sig);
}

// ==========================================================================
//  terminate 处理器
// ==========================================================================
static std::terminate_handler gOldTerminate = nullptr;
[[noreturn]] static void terminateHandler() {
    // 尝试获取当前未捕获异常
    std::string what = "std::terminate — 未捕获 C++ 异常 / noexcept 违规 / 线程 join 失败 / pure-virtual-call";
    if (std::exception_ptr ep = std::current_exception()) {
        try {
            std::rethrow_exception(ep);
        } catch (const std::exception& e) {
            what = std::string("std::terminate — ") + (e.what() ? e.what() : "(std::exception with empty what())");
        } catch (...) {
            what = "std::terminate — 抛出了非标准异常";
        }
    }
    BacktraceCtx bt;
    captureBacktrace(bt);
    writeLogFile("C++ 崩溃 (std::terminate)",
                 what, "",
                 bt, 1);  // skip 1 = terminateHandler self

    // 交给旧处理器 / abort()
    if (gOldTerminate) gOldTerminate();
    std::abort();
}

// ==========================================================================
//  init()
// ==========================================================================
static std::atomic<bool> gInited{false};

void init() {
    if (gInited.exchange(true)) return;

    // 1. 信号处理器（sigaction，使用 SA_SIGINFO + SA_ONSTACK 以便栈溢出时仍可用）
    static stack_t sigstack{};
    static char sigstack_buf[SIGSTKSZ + 16384];   // 64K+16K 兜底
    sigstack.ss_sp   = sigstack_buf;
    sigstack.ss_size = sizeof(sigstack_buf);
    sigstack.ss_flags = 0;
    if (sigaltstack(&sigstack, nullptr) != 0) {
        LOGE("sigaltstack 失败: %s", strerror(errno));
    }

    struct sigaction sa{};
    sa.sa_sigaction = signalHandler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_RESTART;

    int sigs[] = { SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGTRAP, 0 };
    for (int i = 0; sigs[i]; ++i) {
        if (sigaction(sigs[i], &sa, nullptr) != 0) {
            LOGE("sigaction(%d) 失败: %s", sigs[i], strerror(errno));
        }
    }

    // 2. terminate
    gOldTerminate = std::set_terminate(terminateHandler);

    LOGI("CrashHandler::init() 完成 — 信号 + terminate 已安装，日志目录: %s", currentLogDir().c_str());
}

} // namespace crash
