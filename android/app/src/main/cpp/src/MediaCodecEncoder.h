#pragma once

#include <media/NdkMediaCodec.h>
#include <media/NdkMediaFormat.h>
#include <media/NdkMediaMuxer.h>
#include <vector>
#include <string>
#include <atomic>
#include <functional>
#include <thread>
#include <chrono>
#include <cstring>
#include <fcntl.h>  // for open()
#include <unistd.h> // for close()
#include <android/log.h>

// Android MediaCodec color format 常量（NDK 头文件中可能未定义）
#ifndef COLOR_FormatYUV420Planar
#define COLOR_FormatYUV420Planar 19
#endif
#ifndef COLOR_FormatYUV420SemiPlanar
#define COLOR_FormatYUV420SemiPlanar 21
#endif

// AMediaMuxer output format 常量（NDK 27+ 使用 OutputFormat 枚举）
// 注意：NDK 27 中 OutputFormat 是枚举类型，但底层值与 Java 层一致
// MUXER_OUTPUT_MPEG_4 = 0, MUXER_OUTPUT_WEBM = 1, MUXER_OUTPUT_3GPP = 2
#ifndef AMEDIAMUXER_OUTPUT_FORMAT_MPEG4
// 使用 static_cast 将 0 转换为 OutputFormat 类型
#define AMEDIAMUXER_OUTPUT_FORMAT_MPEG4 static_cast<OutputFormat>(0)
#endif

#undef LOG_TAG
#define LOG_TAG "MediaCodecEncoder"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

class MediaCodecEncoder {
public:
    struct Config {
        int width = 1920;
        int height = 1080;
        int frameRate = 30;
        int bitrateMbps = 6;
        int totalFrames = 0;
        std::string outputPath;
        std::string forceColorFormat = "auto"; // "auto" | "nv12" | "i420"
        std::string pixelFormat = "nv12";       // "nv12" | "nv12a" (nv12a 需剥离前 1.5*WH 给 MediaCodec)
        bool skipAudio = false;                  // 透明模式：跳过敏音频处理，直接输出无声视频
    };

    using ProgressCallback = std::function<void(int encoded, int total)>;
    using ErrorCallback = std::function<void(const std::string& msg)>;
    using CompleteCallback = std::function<void(const std::string& outputPath)>;
    using PreMuxerStartCallback = std::function<void(AMediaMuxer* muxer)>;

    MediaCodecEncoder() = default;
    ~MediaCodecEncoder() { release(); }

    bool configure(const Config& config) {
        config_ = config;
        frameDurationUs_ = 1000000LL / config.frameRate;

        // 复位取消标志：configure 是每次会话（createSession）在真正编码前的唯一入口，
        // 而 stopServer 的 requestCancel() 会在上一次会话结束时污染复用编码器的
        // cancelled_。若此处不复位，新会话所有帧都会被 submitFrame 静默拒绝，
        // 客户端因收不到 ACK 在信用窗口处永久阻塞（进度冻结、取消无效）。
        cancelled_.store(false);

        if (!setupMediaCodec(config)) return false;
        if (!setupMediaMuxer(config.outputPath.c_str())) return false;
        configured_ = true;
        return true;
    }

    bool submitFrame(int frameIndex, const uint8_t* frameData, size_t size) {
        if (!encoder_ || !encoderStarted_ || cancelled_.load()) return false;

        // NV12A 管线：前 1.5*W*H = NV12 部分送入 MediaCodec，Alpha 由调用方另行保存
        const size_t nv12Size = config_.width * config_.height * 3 / 2;
        const uint8_t* nv12Data = frameData;
        size_t inputSize = size;
        if (config_.pixelFormat == "nv12a") {
            if (size < nv12Size + config_.width * config_.height) {
                LOGE("NV12A 帧太小: size=%zu need=%zu", size, nv12Size + config_.width * config_.height);
                return false;
            }
            inputSize = nv12Size; // 仅 NV12 部分交给 MediaCodec
        }

        // 如果编码器使用 I420 而非 NV12，需要格式转换
        std::vector<uint8_t> convertedData;
        const uint8_t* inputData = nv12Data;

        if (selectedColorFormat_ == COLOR_FormatYUV420Planar) {
            // NV12 → I420 转换
            convertedData = nv12ToI420(nv12Data, config_.width, config_.height);
            inputData = convertedData.data();
            inputSize = convertedData.size();
        }

        constexpr int MAX_RETRIES = 3;
        for (int retry = 0; retry < MAX_RETRIES; ++retry) {
            ssize_t inputIdx = AMediaCodec_dequeueInputBuffer(encoder_, 10000);
            if (inputIdx >= 0) {
                size_t outSize = 0;
                uint8_t* buf = AMediaCodec_getInputBuffer(encoder_, inputIdx, &outSize);
                if (!buf || outSize < inputSize) {
                    LOGE("输入缓冲区太小: %zu < %zu", outSize, inputSize);
                    return false;
                }

                memcpy(buf, inputData, inputSize);

                int64_t pts = (int64_t)frameIndex * frameDurationUs_;
                media_status_t status = AMediaCodec_queueInputBuffer(
                    encoder_, inputIdx, 0, inputSize, pts, 0);

                if (status != AMEDIA_OK) {
                    LOGE("queueInputBuffer 失败: %d", status);
                    return false;
                }

                processEncoderOutput(false);
                encodedCount_++;
                return true;
            }

            // 获取不到 input buffer → drain 输出释放空间
            // ★ 关键修复：用 10ms 超时等待输出就绪，而非 0 超时立即返回。
            // 原实现用 0 超时，编码器输出未就绪时立即返回，输出缓冲区无法排空，
            // 输入缓冲区持续被占用，编码器进入 inputFps=0 死锁状态。
            // 10ms 等待给编码器足够时间产出输出、释放输入缓冲区。
            processEncoderOutput(false, 10000);
        }

        // 重试后仍无法获取 input buffer
        return false;
    }

    bool finalize() {
        if (!encoder_) return false;

        // 发送 EOF 信号
        ssize_t inputIdx = AMediaCodec_dequeueInputBuffer(encoder_, 10000);
        if (inputIdx >= 0) {
            AMediaCodec_queueInputBuffer(encoder_, inputIdx, 0, 0, 0,
                AMEDIACODEC_BUFFER_FLAG_END_OF_STREAM);
        }

        // 持续 drain 输出直到收到 EOS
        constexpr int MAX_DRAIN_ITERATIONS = 3000; // 最多等 30 秒
        for (int i = 0; i < MAX_DRAIN_ITERATIONS; ++i) {
            if (cancelled_.load()) {
                LOGI("编码器 finalize 被取消");
                break;
            }
            if (processEncoderOutput(true)) {
                break;
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }

        // 注意：不在此处 stop Muxer，由外部在音频写入后统一调用 stopMuxer()
        return true;
    }

    /** 停止 Muxer（在视频+音频都写入后调用）。幂等：重复调用安全。 */
    void stopMuxer() {
        if (muxer_ && muxerStarted_) {
            AMediaMuxer_stop(muxer_);
            muxerStarted_ = false;
            LOGI("MediaMuxer 已停止，输出: %s", config_.outputPath.c_str());
        }
    }

    /** 获取 Muxer 指针（供 AudioEncoder 添加音频轨） */
    AMediaMuxer* getMuxer() const { return muxer_; }

    void release() {
        // 1. 先停止 Muxer（需要 codec 存活来 flush 最终输出并写入 moov atom，
        //    否则直接 AMediaCodec_delete 后 Muxer 无法封口，产出损坏 MP4 或 SIGSEGV）
        stopMuxer();

        // 2. 再停止并删除 codec
        if (encoder_) {
            if (encoderStarted_) {
                AMediaCodec_stop(encoder_);
            }
            AMediaCodec_delete(encoder_);
            encoder_ = nullptr;
            encoderStarted_ = false;
        }

        // 3. 最后删除 muxer（已封口完毕）
        if (muxer_) {
            AMediaMuxer_delete(muxer_);
            muxer_ = nullptr;
        }
        pendingCSD_.clear();
        cancelled_.store(false);   // 重置取消标志，便于编码器复用
        configured_ = false;
    }

    int getEncodedCount() const { return encodedCount_.load(); }
    bool isConfigured() const { return configured_; }

    /** 请求取消：让 submitFrame/finalize 快速退出（供销毁/停止流程使用） */
    void cancel() { cancelled_.store(true); }

    void setProgressCallback(ProgressCallback cb) { onProgress_ = std::move(cb); }
    void setErrorCallback(ErrorCallback cb) { onError_ = std::move(cb); }
    void setCompleteCallback(CompleteCallback cb) { onComplete_ = std::move(cb); }
    void setPreMuxerStartCallback(PreMuxerStartCallback cb) { onPreMuxerStart_ = std::move(cb); }

private:
    AMediaCodec* encoder_ = nullptr;
    AMediaMuxer* muxer_ = nullptr;
    int videoTrack_ = -1;
    bool encoderStarted_ = false;
    bool muxerStarted_ = false;
    int64_t frameDurationUs_ = 33333;
    int32_t selectedColorFormat_ = 0;

    Config config_;
    std::atomic<int> encodedCount_{0};
    std::atomic<bool> cancelled_{false};
    bool configured_ = false;

    struct CSDFrame {
        std::vector<uint8_t> data;
        AMediaCodecBufferInfo info;
    };
    std::vector<CSDFrame> pendingCSD_;

    ProgressCallback onProgress_;
    ErrorCallback onError_;
    CompleteCallback onComplete_;
    PreMuxerStartCallback onPreMuxerStart_;

    bool setupMediaCodec(const Config& config) {
        encoder_ = AMediaCodec_createEncoderByType("video/avc");
        if (!encoder_) {
            LOGE("创建编码器失败");
            return false;
        }

        // 尝试颜色格式：默认 NV12 优先，偏色修复模式下 I420 优先
        const bool preferI420 = config_.forceColorFormat == "i420";
        int32_t colorFormats[] = {
            preferI420 ? COLOR_FormatYUV420Planar      : COLOR_FormatYUV420SemiPlanar,  // 首选
            preferI420 ? COLOR_FormatYUV420SemiPlanar   : COLOR_FormatYUV420Planar,      // 回退
        };

        for (int32_t fmt : colorFormats) {
            AMediaFormat* format = AMediaFormat_new();
            AMediaFormat_setString(format, AMEDIAFORMAT_KEY_MIME, "video/avc");
            AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_WIDTH, config.width);
            AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_HEIGHT, config.height);
            AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_FRAME_RATE, config.frameRate);
            AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_BIT_RATE, config.bitrateMbps * 1000000);
            AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_COLOR_FORMAT, fmt);
            AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_I_FRAME_INTERVAL, 2); // 每2秒一个 I 帧 @30fps

            media_status_t status = AMediaCodec_configure(
                encoder_, format, nullptr, nullptr, AMEDIACODEC_CONFIGURE_FLAG_ENCODE);
            AMediaFormat_delete(format);

            if (status == AMEDIA_OK) {
                selectedColorFormat_ = fmt;
                LOGI("编码器已配置，颜色格式: %s (模式: %s)",
                    fmt == COLOR_FormatYUV420SemiPlanar ? "NV12" : "I420",
                    config_.forceColorFormat.c_str());
                break;
            }

            LOGW("不支持的颜色格式 %d，尝试下一个", fmt);
            // 重置编码器重试
            AMediaCodec_delete(encoder_);
            encoder_ = AMediaCodec_createEncoderByType("video/avc");
            if (!encoder_) {
                LOGE("重新创建编码器失败");
                return false;
            }
        }

        if (selectedColorFormat_ == 0) {
            LOGE("未找到支持的颜色格式");
            return false;
        }

        media_status_t status = AMediaCodec_start(encoder_);
        if (status != AMEDIA_OK) {
            LOGE("启动编码器失败: %d", status);
            return false;
        }
        encoderStarted_ = true;

        LOGI("编码器已启动: %dx%d @%dfps, %dMbps",
            config.width, config.height, config.frameRate, config.bitrateMbps);

        return true;
    }

    bool setupMediaMuxer(const char* outputPath) {
        // 使用文件描述符创建 muxer（兼容旧版 NDK）
        int fd = open(outputPath, O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (fd < 0) {
            LOGE("打开输出文件失败: %s", outputPath);
            return false;
        }
        muxer_ = AMediaMuxer_new(fd, AMEDIAMUXER_OUTPUT_FORMAT_MPEG4);
        if (!muxer_) {
            LOGE("为 %s 创建 muxer 失败", outputPath);
            close(fd);
            return false;
        }
        // fd 被 muxer 接管，不需要关闭
        LOGI("Muxer 已创建: %s", outputPath);
        return true;
    }

    bool processEncoderOutput(bool eof, int64_t waitTimeoutUs = 0) {
        AMediaCodecBufferInfo info;
        ssize_t outputIdx;

        // 首次 dequeue 使用 waitTimeoutUs（可阻塞等待输出就绪），
        // 后续 drain 用 0（非阻塞，快速排空已就绪的输出）。
        outputIdx = AMediaCodec_dequeueOutputBuffer(encoder_, &info, waitTimeoutUs);
        while (outputIdx >= 0) {
            if (info.flags & AMEDIACODEC_BUFFER_FLAG_CODEC_CONFIG) {
                // CSD (SPS/PPS) 帧
                if (muxerStarted_) {
                    uint8_t* src = AMediaCodec_getOutputBuffer(encoder_, outputIdx, nullptr);
                    if (src) {
                        AMediaMuxer_writeSampleData(muxer_, videoTrack_, src, &info);
                    }
                } else {
                    // muxer 尚未启动，暂存 CSD
                    uint8_t* src = AMediaCodec_getOutputBuffer(encoder_, outputIdx, nullptr);
                    if (src) {
                        CSDFrame csd;
                        // 拷贝时已剥离原 offset（数据从 csd.data[0] 开始），
                        // 必须将 info.offset 重置为 0，否则后续 AMediaMuxer_writeSampleData
                        // 会按 buffer + info.offset 读取，造成越界读或写入错误数据。
                        csd.data.assign(src + info.offset, src + info.offset + info.size);
                        csd.info = info;
                        csd.info.offset = 0;
                        pendingCSD_.push_back(std::move(csd));
                    }
                }
                AMediaCodec_releaseOutputBuffer(encoder_, outputIdx, false);
                outputIdx = AMediaCodec_dequeueOutputBuffer(encoder_, &info, 0);
                continue;
            }

            if (info.size > 0 && muxerStarted_) {
                uint8_t* src = AMediaCodec_getOutputBuffer(encoder_, outputIdx, nullptr);
                if (src) {
                    AMediaMuxer_writeSampleData(muxer_, videoTrack_, src, &info);
                }
            }

            AMediaCodec_releaseOutputBuffer(encoder_, outputIdx, false);

            if (info.flags & AMEDIACODEC_BUFFER_FLAG_END_OF_STREAM) {
                LOGI("编码器输出 EOS");
                return true;
            }

            outputIdx = AMediaCodec_dequeueOutputBuffer(encoder_, &info, 0);
        }

        if (outputIdx == AMEDIACODEC_INFO_OUTPUT_FORMAT_CHANGED && muxer_) {
            AMediaFormat* format = AMediaCodec_getOutputFormat(encoder_);
            videoTrack_ = AMediaMuxer_addTrack(muxer_, format);
            AMediaFormat_delete(format);

            // 在 start() 前允许外部添加更多轨道（如音频轨）
            if (onPreMuxerStart_) {
                onPreMuxerStart_(muxer_);
            }

            AMediaMuxer_start(muxer_);
            muxerStarted_ = true;

            LOGI("Muxer 已启动，视频轨道: %d", videoTrack_);

            // 写入之前暂存的 CSD 帧
            for (auto& csd : pendingCSD_) {
                AMediaMuxer_writeSampleData(muxer_, videoTrack_, csd.data.data(), &csd.info);
            }
            pendingCSD_.clear();
        }

        return false;
    }

    // NV12 → I420 转换
    static std::vector<uint8_t> nv12ToI420(const uint8_t* nv12, int width, int height) {
        int ySize = width * height;
        int uvSize = width * (height / 2);
        int totalSize = ySize + uvSize;

        std::vector<uint8_t> i420(totalSize);
        // Y 平面直接拷贝
        memcpy(i420.data(), nv12, ySize);

        // NV12 UV 交错 → I420 U/V 分离
        const uint8_t* nv12UV = nv12 + ySize;
        uint8_t* i420U = i420.data() + ySize;
        uint8_t* i420V = i420U + (uvSize / 2);

        int uvStride = width;
        for (int i = 0; i < uvSize / 2; ++i) {
            i420U[i] = nv12UV[i * 2];
            i420V[i] = nv12UV[i * 2 + 1];
        }

        return i420;
    }
};
