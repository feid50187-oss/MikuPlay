#pragma once

#include <App.h>
#include <functional>
#include <memory>
#include <atomic>
#include <thread>
#include <string>
#include <mutex>
#include <android/log.h>

#include "MediaCodecEncoder.h"

#undef LOG_TAG
#define LOG_TAG "FrameServer"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

struct PerSocketData {
    bool isActive = false;
    int frameCount = 0;
};

// WebSocket 类型别名
using WsType = uWS::WebSocket<false, true, PerSocketData>;

class FrameServer {
public:
    using BinaryMessageCallback = std::function<void(int frameIndex, const uint8_t* data, size_t size)>;
    using ControlMessageCallback = std::function<std::string(const std::string& message)>;
    using CloseCallback = std::function<void()>;

    // 渲染分辨率像素上限（宽×高），须与前端 MAX_RENDER_PIXELS 保持一致
    static constexpr size_t kMaxRenderPixels = 4096 * 4096;

    explicit FrameServer(int port = 8765) : port_(port) {}
    ~FrameServer() { stop(); }

    bool start() {
        if (running_.load()) return true;

        running_ = true;
        loopThread_ = std::thread([this]() {
            // 在 uWS 线程中创建 App 和 Loop
            auto app = uWS::App()
                .ws<PerSocketData>("/*", uWS::TemplatedApp<false>::WebSocketBehavior<PerSocketData>{
                    .maxPayloadLength = kMaxRenderPixels * 4 + 4,  // 4096×4096 RGBA(4 bytes/px ≈67MB)+4字节帧头；覆盖 NV12/NV12A/RGBA 三种管线
                    .idleTimeout = 0,                      // 不超时，渲染期间保持连接
                    .maxBackpressure = 68 * 1024 * 1024,  // 68MB 上限，覆盖 RGBA 单帧(≈67MB)+余量  
                    .open = [this](auto* ws) {
                        auto* data = ws->getUserData();
                        std::lock_guard<std::mutex> lock(sessionMutex_);
                        if (hasSession_) {
                            ws->send("{\"type\":\"error\",\"message\":\"Session already active\"}", uWS::OpCode::TEXT);
                            ws->close();
                            return;
                        }
                        data->isActive = true;
                        data->frameCount = 0;
                        activeWs_ = ws;
                        hasSession_ = true;
                        LOGI("WebSocket 客户端已连接");
                    },
                    .message = [this](auto* ws, std::string_view message, uWS::OpCode opCode) {
                        if (opCode == uWS::BINARY) {
                            handleBinaryMessage(ws, message);
                        } else {
                            handleControlMessage(ws, message);
                        }
                    },
                    .drain = [this](auto* ws) {
                        LOGW("WebSocket 背压排水: %zu", (size_t)ws->getBufferedAmount());
                    },
                    .close = [this](auto* ws, int code, std::string_view message) {
                        LOGI("WebSocket 关闭码: %d, 原因: %.*s", code, (int)message.size(), message.data());
                        handleClose(ws);
                    }
                })
                .listen(port_, [this](auto* listenSocket) {
                    if (listenSocket) {
                        listenSocket_ = listenSocket;
                        LOGI("FrameServer 正在监听端口 %d", port_);
                    } else {
                        LOGE("监听端口 %d 失败", port_);
                    }
                });

            // 保存 loop 指针（在 uWS 线程中获取）
            loop_ = uWS::Loop::get();

            // 运行事件循环（阻塞直到 loop 自然退出）
            uWS::Loop::get()->run();

            LOGI("FrameServer 循环已退出");
        });

        // 等待 loop 初始化
        int waitMs = 0;
        while (!loop_ && waitMs < 3000) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            waitMs += 10;
        }

        return loop_ != nullptr;
    }

    void stop() {
        if (!running_.load()) return;

        // 检测自 join：如果当前线程就是 loopThread_，不能 join 自己（会死锁）。
        // 此时只 defer 关闭资源，让 loop 自然退出；thread join 交给后续其他线程或析构。
        const bool selfJoin = loopThread_.joinable() &&
            (std::this_thread::get_id() == loopThread_.get_id());

        // 在 uWS 线程中关闭所有 socket，使 loop 自然退出
        if (loop_) {
            loop_->defer([this]() {
                // 关闭活跃的 WebSocket 连接
                if (activeWs_) {
                    activeWs_->close();
                    activeWs_ = nullptr;
                }
                // 关闭 listen socket
                if (listenSocket_) {
                    us_listen_socket_close(0, listenSocket_);
                    listenSocket_ = nullptr;
                }
                hasSession_ = false;
            });
        }

        running_ = false;
        if (!selfJoin) {
            if (loopThread_.joinable()) {
                loopThread_.join();
            }
            loop_ = nullptr;
        } else {
            LOGW("FrameServer::stop: 检测到自 join，跳过 loopThread_.join()，资源将在析构或后续 stop 中回收");
            // detach 以便后续其他线程或析构时不会重复 join；loop_ 指针仍保留到线程退出
            if (loopThread_.joinable()) {
                loopThread_.detach();
            }
            // loop_ 不置空，detached 线程退出前会用到它
        }
    }

    bool isRunning() const { return running_.load(); }

    /** 判断当前调用线程是否就是 uWS 事件循环线程（loopThread_）。
     *  用于 doCleanup 等清理路径决策：若在 loopThread_ 内调用 stop() 会触发自 join 死锁，
     *  需移交清扫线程异步释放 FrameServer。 */
    bool isRunningOnLoopThread() const {
        return loopThread_.joinable() &&
               (std::this_thread::get_id() == loopThread_.get_id());
    }

    void setOnBinaryMessage(BinaryMessageCallback cb) { onBinary_ = std::move(cb); }
    void setOnControlMessage(ControlMessageCallback cb) { onControl_ = std::move(cb); }
    void setOnClose(CloseCallback cb) { onClose_ = std::move(cb); }

    /**
     * 发送累积 ACK 控制帧：告知客户端 ≤frameIndex 的帧均已被编码器消费
     * （客户端据此释放信用窗口继续发送）。异步 defer，不在调用线程阻塞。
     */
    void sendAck(int frameIndex) {
        if (!loop_) return;
        loop_->defer([this, frameIndex]() {
            std::lock_guard<std::mutex> lock(sessionMutex_);
            if (!activeWs_) return;
            std::string msg = "{\"type\":\"ack\",\"index\":" + std::to_string(frameIndex) + "}";
            activeWs_->send(msg, uWS::OpCode::TEXT);
        });
    }

    /**
     * 补发 finalize 完成响应（供 finalize 工作线程调用）。
     * 异步 defer 回 uWS 线程发送，不在调用线程阻塞；携带 requestId 供前端 promise resolve。
     * 若连接已断开（activeWs_ 为空），前端 onclose 已 reject 挂起请求，此处静默放弃。
     */
    void sendFinalizeResponse(const std::string& json) {
        if (!loop_) return;
        loop_->defer([this, json]() {
            std::lock_guard<std::mutex> lock(sessionMutex_);
            if (!activeWs_) return;
            activeWs_->send(json, uWS::OpCode::TEXT);
        });
    }

    /**
     * 仅关闭当前连接（异步，不 join 事件循环线程）。
     * 供看门狗等从 writer 线程调用：若此时 uWS 线程正阻塞在 finalize 排空上，
     * 同步 stop() 会 join 事件循环线程造成互相等待的死锁，因此这里只 defer 关闭。
     */
    void closeConnection() {
        if (!loop_) return;
        loop_->defer([this]() {
            std::lock_guard<std::mutex> lock(sessionMutex_);
            if (activeWs_) {
                activeWs_->close();
                activeWs_ = nullptr;
            }
            hasSession_ = false;
        });
    }

private:
    int port_;
    std::thread loopThread_;
    std::atomic<bool> running_{false};
    uWS::Loop* loop_ = nullptr;
    us_listen_socket_t* listenSocket_ = nullptr;

    bool hasSession_ = false;
    std::mutex sessionMutex_;
    WsType* activeWs_ = nullptr;

    BinaryMessageCallback onBinary_;
    ControlMessageCallback onControl_;
    CloseCallback onClose_;

    void handleBinaryMessage(WsType* ws, std::string_view data) {
        if (data.size() < 4) {
            LOGW("帧数据太小，忽略");
            return;
        }

        // 读取 4 字节大端序帧索引
        int frameIndex = ((uint8_t)data[0] << 24) |
                         ((uint8_t)data[1] << 16) |
                         ((uint8_t)data[2] << 8) |
                         ((uint8_t)data[3]);

        // 帧数据（跳过 4 字节 header）
        const uint8_t* frameData = reinterpret_cast<const uint8_t*>(data.data()) + 4;
        size_t frameSize = data.size() - 4;

        // 信用窗口由客户端在发送侧硬性保证，submit() 永不拒帧，
        // 因此这里不存在"队列满→紧急暂停"的应用层丢弃路径。
        if (onBinary_) {
            onBinary_(frameIndex, frameData, frameSize);
        }
    }

    void handleControlMessage(WsType* ws, std::string_view message) {
        LOGI("控制消息: %.*s", (int)message.size(), message.data());
        if (onControl_) {
            std::string response = onControl_(std::string(message));
            if (!response.empty()) {
                ws->send(response, uWS::OpCode::TEXT);
            }
        }
    }

    void handleClose(WsType* ws) {
        std::lock_guard<std::mutex> lock(sessionMutex_);
        if (activeWs_ == ws) {
            activeWs_ = nullptr;
        }
        hasSession_ = false;
        LOGI("WebSocket 客户端已断开连接");

        if (onClose_) {
            onClose_();
        }
    }
};
