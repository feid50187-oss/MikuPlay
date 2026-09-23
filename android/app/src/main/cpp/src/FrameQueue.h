#pragma once

#include <deque>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <vector>
#include <cstdint>
#include <functional>
#include <thread>
#include <chrono>
#include <string>
#include <android/log.h>

// 内联日志宏，避免跨翻译单元重复定义
#define FQ_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "FrameQueue", __VA_ARGS__)
#define FQ_LOGI(...) __android_log_print(ANDROID_LOG_INFO, "FrameQueue", __VA_ARGS__)

/**
 * 信用窗口 FIFO 帧队列。
 *
 * 与旧 FrameReorderQueue（index 寻址环形槽 + 严格顺序消费）的根本区别：
 *  - 旧设计在队列满时拒帧（应用层丢弃），被拒帧留下不可填补的空洞，
 *    writer 严格按 nextExpectedIndex_ 消费时永久卡在 cv_.wait —— 结构性死锁。
 *  - 本设计采用"端到端信用窗口"：客户端在 sentHigh - ackedHigh >= window 时停止发送，
 *    因此 submit() 永不溢出、永不拒帧、永不产生空洞；writer 按 FIFO 顺序消费，
 *    不存在"等一个永不来的帧"的状态。
 *
 * 消费成功的帧即释放一个信用（累积 ACK 回调 onAck_），编码器慢则 ACK 慢、
 * 客户端自动节流 —— 进度自然匹配，无需旁路水印信号。
 *
 * 完成语义：finalize 路径先 setEOF() 再 join()，writer 排空队列后退出，
 * 保证尾端在途帧全部编码，杜绝旧设计 shutdown() 直接杀线程导致的截断丢帧。
 */
class FrameQueue {
public:
    /** 编码器消费回调：返回 true 表示成功消费（释放一个信用） */
    using ConsumeCallback = std::function<bool(int index, const uint8_t* data, size_t size)>;
    /** 累积 ACK 回调：index 为已消费的最高帧号（帧按序到达，单调递增） */
    using AckCallback = std::function<void(int index)>;
    /** 错误回调：看门狗超时等不可恢复故障 */
    using ErrorCallback = std::function<void(const std::string& msg)>;
    /** finalize 回调：排空完成（或 eof_ 已置位的其他退出路径）后，在 writer 线程执行 */
    using FinalizeCallback = std::function<void()>;

    FrameQueue(int windowSize, ConsumeCallback onConsume, AckCallback onAck, ErrorCallback onError)
        : windowSize_(windowSize)
        , onConsume_(std::move(onConsume))
        , onAck_(std::move(onAck))
        , onError_(std::move(onError))
    {
        writerThread_ = std::thread(&FrameQueue::writerLoop, this);
    }

    ~FrameQueue() {
        shutdown();
    }

    /**
     * 入队。信用窗口由客户端保证，永不溢出，因此永不拒绝、永不丢帧。
     * 队列深度异常（远超窗口）仅记日志，用于诊断客户端信用失效。
     * finalize 已开始（eof_）后拒绝新帧，防止客户端迟到帧堆积。
     */
    bool submit(int frameIndex, std::vector<uint8_t> frameData) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (eof_) return false;   // finalize 已开始，拒绝迟到帧
            queue_.push_back(Frame{frameIndex, std::move(frameData)});
            if (static_cast<int>(queue_.size()) > windowSize_ * 2) {
                FQ_LOGE("队列深度异常（客户端信用窗口失效?）: size=%zu window=%d",
                        queue_.size(), windowSize_);
            }
        }
        cv_.notify_one();
        return true;
    }

    /** 注册 finalize 回调：writer 排空完成（或 eof_ 已置位的退出路径）后在 writer 线程执行 */
    void setFinalizeCallback(FinalizeCallback cb) {
        onFinalize_ = std::move(cb);
    }

    /** finalize 信号：置 EOF，writer 排空队列后退出（需配合 join() 等待） */
    void setEOF() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            eof_ = true;
        }
        cv_.notify_all();
    }

    /** 等待 writer 排空并退出（finalize 路径；阻塞直到排空完成） */
    void join() {
        // 防御自 join：writer 线程内调用 join 会导致死锁（虽然正常 finalize 流程不会）
        if (writerThread_.joinable() &&
            std::this_thread::get_id() != writerThread_.get_id()) {
            writerThread_.join();
        }
    }

    /** 当前队列深度（诊断用） */
    int pendingCount() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return static_cast<int>(queue_.size());
    }

    /** 中止：立即停止消费并丢弃未处理帧（取消/错误路径） */
    void shutdown() {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (!running_) return;
            running_ = false;
        }
        cv_.notify_all();
        // 防御自 join：writer 线程里（如 onFinalize 回调）不能 shutdown→join 自己
        if (writerThread_.joinable() &&
            std::this_thread::get_id() != writerThread_.get_id()) {
            writerThread_.join();
        }
    }

private:
    struct Frame {
        int index;
        std::vector<uint8_t> data;
    };

    std::deque<Frame> queue_;
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::thread writerThread_;
    std::atomic<bool> running_{true};
    bool eof_ = false; // 受 mutex_ 保护
    int windowSize_;
    ConsumeCallback onConsume_;
    AckCallback onAck_;
    ErrorCallback onError_;
    FinalizeCallback onFinalize_;

    // 看门狗：最近一次成功消费的时间戳
    std::chrono::steady_clock::time_point lastProgressTime_;
    std::atomic<int> consumedHigh_{-1};

    void writerLoop() {
        lastProgressTime_ = std::chrono::steady_clock::now();

        // 编码器背压重试用的局部帧缓存（不写回队列，避免与入队路径竞争）
        std::vector<uint8_t> retryData;
        int retryIndex = -1;

        while (running_) {
            // 优先重试编码器背压帧（submitFrame 内部已做输出排空，短暂背压属正常）
            if (retryIndex >= 0) {
                if (onConsume_(retryIndex, retryData.data(), retryData.size())) {
                    consumedHigh_.store(retryIndex);
                    if (onAck_) onAck_(retryIndex);
                    lastProgressTime_ = std::chrono::steady_clock::now();
                    retryData.clear();
                    retryIndex = -1;
                } else {
                    if (watchdogFired()) break;
                    std::this_thread::sleep_for(std::chrono::milliseconds(10));
                }
                continue;
            }

            Frame frame;
            {
                std::unique_lock<std::mutex> lock(mutex_);
                cv_.wait_for(lock, std::chrono::milliseconds(100), [this]() {
                    return !running_.load() || !queue_.empty() || eof_;
                });
                if (!running_) break;
                if (queue_.empty()) {
                    if (eof_) {
                        // finalize 排空完成：退出 writer，join() 随即返回
                        FQ_LOGI("finalize 排空完成，已消费至帧 %d", consumedHigh_.load());
                        break;
                    }
                    // 队列空且未收到 finalize：客户端仍在推进，或已停顿（由看门狗兜底）
                    if (watchdogFired()) break;
                    continue;
                }
                frame = std::move(queue_.front());
                queue_.pop_front();
            }

            if (onConsume_(frame.index, frame.data.data(), frame.data.size())) {
                consumedHigh_.store(frame.index);
                if (onAck_) onAck_(frame.index);
                lastProgressTime_ = std::chrono::steady_clock::now();
            } else {
                retryData = std::move(frame.data);
                retryIndex = frame.index;
            }
        }

        // 循环退出后统一执行 finalize 回调（本线程）。
        // 覆盖所有"eof_ 已置位"的退出路径：正常排空、看门狗、shutdown；
        // 保证上层 finalizing_ 状态总能复位，不会因某条路径跳过回调而卡死。
        bool runFinalize = false;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            runFinalize = eof_;
        }
        if (runFinalize && onFinalize_) {
            onFinalize_();
        }
    }

    /**
     * 看门狗：已开始消费但 60 秒无成功消费 → 中止会话并通知错误。
     * 唯一的永久阻塞来源是编码器硬件挂起，此时必须显式失败而非静默自旋。
     */
    bool watchdogFired() {
        auto elapsed = std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::steady_clock::now() - lastProgressTime_).count();
        if (consumedHigh_.load() >= 0 && elapsed > 60) {
            FQ_LOGE("看门狗触发：60 秒无编码进度（已消费至帧 %d）", consumedHigh_.load());
            if (onError_) {
                onError_("编码 60 秒无进度，会话中止");
            }
            running_.store(false);
            cv_.notify_all();
            return true;
        }
        return false;
    }
};
