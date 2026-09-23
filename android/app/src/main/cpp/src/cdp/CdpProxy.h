// CdpProxy.h —— CDP 命令直通，不依赖前端 WebSocket
#pragma once
#include <android/log.h>
#include <atomic>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>
#include <sys/socket.h>

#define CDP_LOG_TAG "CdpProxy"
#define CDP_LOGI(...) __android_log_print(ANDROID_LOG_INFO, CDP_LOG_TAG, __VA_ARGS__)
#define CDP_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, CDP_LOG_TAG, __VA_ARGS__)
#define CDP_LOGW(...) __android_log_print(ANDROID_LOG_WARN, CDP_LOG_TAG, __VA_ARGS__)

namespace mikuplay::cdp {

class CdpProxy {
public:
    using EventCallback = std::function<void(const std::string&)>;

    struct Config {
        int         port        = 9222;
        pid_t       preferPid   = 0;
        std::string abstractOverride;
        EventCallback onEvent;       // CDP 事件回调（可选）
    };

    explicit CdpProxy(Config cfg);
    ~CdpProxy();

    bool start();
    void stop();

    bool isRunning() const { return running_.load(); }
    int  port() const { return actualPort_; }
    std::string endpointUrl() const;
    std::string abstractSocketName() const;

    // 发送 CDP 命令并等待响应（同步，带超时）
    // 返回完整响应 JSON，超时或错误返回空串
    std::string sendCommand(int id, const std::string& method, const std::string& paramsJson);

private:
    // 抽象 socket 发现
    static std::string discoverAbstractSocketName(pid_t prefer, const std::string& override_);
    static std::string scanProcSelfNetUnix(pid_t pid);
    static std::string scanProcNetUnix();
    static std::string fallbackByPid(pid_t pid);

    // AF_UNIX 连接
    static int connectAbstract(const std::string& name);
    int probeAbstractSocket(const std::string& name);

    // Chromium WebSocket 客户端
    static bool wsClientHandshake(int fd, const std::string& path);
    static bool wsClientSendText(int fd, std::string_view payload);
    static bool wsClientReadFrame(int fd, std::string& outPayload, uint8_t& outOpcode);

    // 确保 Chromium 连接可用
    bool ensureChromiumConnection();

    // Chromium 读取线程
    void chromiumReadThread();

    // 从 Chromium 抽象 socket 获取 target 列表（HTTP）
    std::string fetchTargetsFromDevTools();

    Config                  cfg_;
    int                     actualPort_ = 0;
    std::atomic<bool>       running_{false};
    std::string             sockName_;

    // Chromium WebSocket 连接
    int                     chromiumFd_ = -1;
    std::string             pageTargetPath_;   // /devtools/page/<id>
    std::mutex              chromiumMtx_;       // 保护 chromiumFd_ 和发送操作
    std::thread             readThread_;

    // 命令响应等待
    std::mutex              respMtx_;
    std::condition_variable respCv_;
    std::unordered_map<int, std::string> pendingResponses_;

    // 事件缓冲
    std::mutex              eventMtx_;
    std::vector<std::string> eventQueue_;
};

} // namespace mikuplay::cdp
