#pragma once

#include <media/NdkMediaCodec.h>
#include <media/NdkMediaFormat.h>
#include <media/NdkMediaMuxer.h>
#include <media/NdkMediaExtractor.h>
#include <vector>
#include <string>
#include <cstring>
#include <cstdio>
#include <functional>
#include <fcntl.h>
#include <unistd.h>
#include <thread>
#include <chrono>
#include <atomic>
#include <android/log.h>

#undef LOG_TAG
#define LOG_TAG "AudioEncoder"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

/**
 * AudioEncoder — 方案 A：手动构造 AAC CSD-0，完全解耦音频管线
 *
 * 流程：
 *   configure()           → 解析格式 + 后台解码(MP3/AAC) + 预构造 AMediaFormat(含CSD-0)
 *   addTrackToMuxer()     → O(1)，直接 addTrack(muxer, prebuiltFormat)，不创建编码器
 *   encodeAll()           → 创建AAC编码器，PCM→AAC→writeSampleData，跳过CSD帧
 */
class AudioEncoder {
public:
    struct Config {
        std::string audioPath;
        int bitrate = 128000;
        int64_t maxDurationUs = 0;
        int64_t startOffsetUs = 0;  // 帧范围渲染：跳过视频起始时刻之前的前缀 PCM
    };

    using ErrorCallback = std::function<void(const std::string&)>;

    AudioEncoder() = default;
    ~AudioEncoder() { release(); }

    void setErrorCallback(ErrorCallback cb) { errorCallback_ = std::move(cb); }

    bool configure(const Config& config) {
        config_ = config;
        if (isWavFile(config.audioPath)) {
            if (!configureFromWav(config.audioPath)) return false;
        } else {
            if (!configureFromExtractor(config.audioPath)) return false;
        }
        // 预构造 AAC AMediaFormat（含手动 CSD-0），供 addTrackToMuxer 直接使用
        prebuiltFormat_ = buildAacFormat(srcSampleRate_, srcChannelCount_);
        if (!prebuiltFormat_) {
            LOGE("构造 AAC 格式失败");
            if (errorCallback_) errorCallback_("构造 AAC 格式失败：采样率 " +
                std::to_string(srcSampleRate_) + "Hz 或声道数 " +
                std::to_string(srcChannelCount_) + " 不支持");
            return false;
        }
        return true;
    }

    /**
     * O(1) 操作：直接用预构造的格式添加音频轨，不创建编码器，不等待解码
     */
    bool addTrackToMuxer(AMediaMuxer* muxer) {
        if (!muxer || !prebuiltFormat_) {
            LOGE("addTrackToMuxer: muxer 或 format 为空");
            if (errorCallback_) errorCallback_("音频轨添加失败：Muxer 或格式未就绪");
            return false;
        }
        audioTrack_ = AMediaMuxer_addTrack(muxer, prebuiltFormat_);
        if (audioTrack_ < 0) {
            LOGE("addTrack 失败: %d", audioTrack_);
            if (errorCallback_) errorCallback_("音频轨添加失败：addTrack 返回错误 " + std::to_string(audioTrack_));
            return false;
        }
        trackAdded_ = true;
        LOGI("音频轨已添加: track=%d", audioTrack_);
        return true;
    }

    /**
     * 第二阶段：创建 AAC 编码器，编码全部 PCM → AAC → 写入 Muxer
     * 在视频 finalize 之后调用
     */
    bool encodeAll(AMediaMuxer* muxer) {
        if (!muxer || !trackAdded_) {
            LOGE("encodeAll: muxer 或音频轨未就绪");
            if (errorCallback_) errorCallback_("音频编码失败：Muxer 或音频轨未就绪");
            return false;
        }

        // 等待后台解码线程完成
        if (decodeThread_.joinable()) {
            LOGI("等待音频解码完成...");
            decodeThread_.join();
        }
        if (decodeFailed_.load()) {
            LOGE("音频解码失败");
            if (errorCallback_) errorCallback_("音频解码失败");
            return false;
        }

        // 帧范围渲染：跳过视频起始时刻之前的前缀 PCM
        // （对齐 1024-sample AAC 帧边界，避免编码器帧错位；偏移超过音频时长时输出无声）
        if (config_.startOffsetUs > 0 && !pcmData_.empty()) {
            const size_t frameBytes = 1024 * srcChannelCount_ * 2;
            size_t skipBytes = (size_t)(config_.startOffsetUs * srcSampleRate_ * srcChannelCount_ * 2 / 1000000LL);
            skipBytes = (skipBytes / frameBytes) * frameBytes;
            if (skipBytes > 0) {
                if (skipBytes >= pcmData_.size()) {
                    LOGW("音频偏移 %.2f 秒超过音频时长，本次输出无声视频",
                         config_.startOffsetUs / 1000000.0);
                    pcmData_.clear();
                } else {
                    LOGI("音频偏移 %.2f 秒：跳过 %zu 字节 PCM",
                         config_.startOffsetUs / 1000000.0, skipBytes);
                    pcmData_.erase(pcmData_.begin(), pcmData_.begin() + skipBytes);
                }
            }
        }

        // 按视频时长截断 PCM
        if (config_.maxDurationUs > 0 && !pcmData_.empty()) {
            int64_t audioDurationUs = (int64_t)pcmData_.size() * 1000000LL
                / (srcSampleRate_ * srcChannelCount_ * 2);
            if (audioDurationUs > config_.maxDurationUs) {
                size_t maxBytes = (size_t)(config_.maxDurationUs * srcSampleRate_ * srcChannelCount_ * 2 / 1000000LL);
                size_t frameBytes = 1024 * srcChannelCount_ * 2;
                maxBytes = (maxBytes / frameBytes) * frameBytes;
                if (maxBytes < pcmData_.size()) {
                    LOGI("音频截断: %.1f 秒 → %.1f 秒",
                        audioDurationUs / 1000000.0,
                        (double)maxBytes / (srcSampleRate_ * srcChannelCount_ * 2));
                    pcmData_.resize(maxBytes);
                }
            }
        }

        if (pcmData_.empty()) {
            LOGE("encodeAll: PCM 数据为空");
            if (errorCallback_) errorCallback_("音频编码失败：PCM 数据为空");
            return false;
        }
        if (cancelled_.load()) {
            LOGI("音频编码已取消");
            return false;
        }

        // 创建 AAC 编码器
        encoder_ = AMediaCodec_createEncoderByType("audio/mp4a-latm");
        if (!encoder_) {
            LOGE("创建 AAC 编码器失败");
            if (errorCallback_) errorCallback_("创建 AAC 编码器失败");
            return false;
        }

        AMediaFormat* format = AMediaFormat_new();
        AMediaFormat_setString(format, AMEDIAFORMAT_KEY_MIME, "audio/mp4a-latm");
        AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_SAMPLE_RATE, srcSampleRate_);
        AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_CHANNEL_COUNT, srcChannelCount_);
        AMediaFormat_setInt32(format, AMEDIAFORMAT_KEY_BIT_RATE, config_.bitrate);
        AMediaFormat_setInt32(format, "aac-profile", 2); // AAC-LC

        media_status_t status = AMediaCodec_configure(encoder_, format, nullptr, nullptr, AMEDIACODEC_CONFIGURE_FLAG_ENCODE);
        AMediaFormat_delete(format);
        if (status != AMEDIA_OK) {
            LOGE("AAC 编码器配置失败: %d", status);
            if (errorCallback_) errorCallback_("AAC 编码器配置失败 (status=" + std::to_string(status) + ")");
            return false;
        }
        status = AMediaCodec_start(encoder_);
        if (status != AMEDIA_OK) {
            LOGE("AAC 编码器启动失败: %d", status);
            if (errorCallback_) errorCallback_("AAC 编码器启动失败 (status=" + std::to_string(status) + ")");
            return false;
        }
        LOGI("AAC 编码器已启动: %dHz %dch %dbps", srcSampleRate_, srcChannelCount_, config_.bitrate);

        // 编码循环
        const int bytesPerSample = srcChannelCount_ * 2;
        size_t inputOffset = 0;
        int64_t pts = 0;
        bool eosSent = false;
        bool eosReceived = false;

        while (!eosReceived && !cancelled_.load()) {
            if (!eosSent) {
                ssize_t inputIdx = AMediaCodec_dequeueInputBuffer(encoder_, 50000);
                if (inputIdx >= 0) {
                    size_t outSize = 0;
                    uint8_t* buf = AMediaCodec_getInputBuffer(encoder_, inputIdx, &outSize);
                    if (!buf) {
                        LOGE("获取音频输入缓冲区失败");
                        break;
                    }
                    size_t remaining = pcmData_.size() - inputOffset;
                    if (remaining > 0) {
                        size_t copySize = (remaining < outSize) ? remaining : outSize;
                        memcpy(buf, pcmData_.data() + inputOffset, copySize);
                        inputOffset += copySize;
                        AMediaCodec_queueInputBuffer(encoder_, inputIdx, 0, copySize, pts, 0);
                        pts += (int64_t)(copySize / bytesPerSample) * 1000000LL / srcSampleRate_;
                    } else {
                        AMediaCodec_queueInputBuffer(encoder_, inputIdx, 0, 0, pts,
                            AMEDIACODEC_BUFFER_FLAG_END_OF_STREAM);
                        eosSent = true;
                        LOGI("音频 EOS 已发送");
                    }
                }
            }

            AMediaCodecBufferInfo info;
            ssize_t outputIdx = AMediaCodec_dequeueOutputBuffer(encoder_, &info, 0);
            if (outputIdx >= 0) {
                // 跳过 CSD 帧（CSD-0 已通过预构造格式写入 Muxer）
                if (info.size > 0 && !(info.flags & AMEDIACODEC_BUFFER_FLAG_CODEC_CONFIG)) {
                    uint8_t* src = AMediaCodec_getOutputBuffer(encoder_, outputIdx, nullptr);
                    if (src) {
                        AMediaMuxer_writeSampleData(muxer, audioTrack_, src, &info);
                    }
                }
                if (info.flags & AMEDIACODEC_BUFFER_FLAG_END_OF_STREAM) {
                    eosReceived = true;
                    LOGI("音频编码完成");
                }
                AMediaCodec_releaseOutputBuffer(encoder_, outputIdx, false);
            } else if (outputIdx == AMEDIACODEC_INFO_TRY_AGAIN_LATER && eosSent) {
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }

        std::vector<uint8_t>().swap(pcmData_);
        LOGI("音频编码结束，共处理 %zu 字节 PCM", inputOffset);
        return true;
    }

    void release() {
        // 防御自 join：decodeThread_ 内部异常路径不应用本线程 join 自己
        if (decodeThread_.joinable() &&
            std::this_thread::get_id() != decodeThread_.get_id()) {
            decodeThread_.join();
        }
        if (encoder_) {
            AMediaCodec_stop(encoder_);
            AMediaCodec_delete(encoder_);
            encoder_ = nullptr;
        }
        if (extractor_) {
            AMediaExtractor_delete(extractor_);
            extractor_ = nullptr;
        }
        if (prebuiltFormat_) {
            AMediaFormat_delete(prebuiltFormat_);
            prebuiltFormat_ = nullptr;
        }
        std::vector<uint8_t>().swap(pcmData_);
        trackAdded_ = false;
        cancelled_.store(false);
    }

    bool hasAudio() const {
        return prebuiltFormat_ != nullptr;
    }

    /** 请求取消：让解码/编码循环快速退出（供销毁/停止流程使用） */
    void cancel() { cancelled_.store(true); }

private:
    Config config_;
    AMediaCodec* encoder_ = nullptr;
    AMediaExtractor* extractor_ = nullptr;
    AMediaFormat* prebuiltFormat_ = nullptr;

    ErrorCallback errorCallback_;

    int srcSampleRate_ = 44100;
    int srcChannelCount_ = 2;
    int srcBitsPerSample_ = 16;

    std::vector<uint8_t> pcmData_;
    std::thread decodeThread_;
    std::atomic<bool> decodeFailed_{false};
    std::atomic<bool> cancelled_{false};

    int audioTrack_ = -1;
    bool trackAdded_ = false;

    // ---- 手动构造 AAC CSD-0 ----

    /**
     * 构造含 CSD-0 的 AAC AMediaFormat
     * AudioSpecificConfig (2 bytes, AAC-LC):
     *   5 bits: audioObjectType = 2
     *   4 bits: samplingFrequencyIndex
     *   4 bits: channelConfiguration
     *   3 bits: padding (0,0,0)
     */
    static AMediaFormat* buildAacFormat(int sampleRate, int channels) {
        static const int freqMap[] = {
            96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
            16000, 12000, 11025, 8000, 7350
        };
        int freqIndex = -1;
        for (int i = 0; i < 13; i++) {
            if (freqMap[i] == sampleRate) {
                freqIndex = i;
                break;
            }
        }
        if (freqIndex < 0) {
            LOGE("不支持的采样率: %d", sampleRate);
            return nullptr;
        }
        if (channels < 1 || channels > 2) {
            LOGE("不支持的声道数: %d", channels);
            return nullptr;
        }
        uint8_t csd0[2];
        csd0[0] = ((2 & 0x1F) << 3) | ((freqIndex & 0x0E) >> 1);
        csd0[1] = ((freqIndex & 0x01) << 7) | ((channels & 0x0F) << 3);

        AMediaFormat* fmt = AMediaFormat_new();
        AMediaFormat_setString(fmt, AMEDIAFORMAT_KEY_MIME, "audio/mp4a-latm");
        AMediaFormat_setInt32(fmt, AMEDIAFORMAT_KEY_SAMPLE_RATE, sampleRate);
        AMediaFormat_setInt32(fmt, AMEDIAFORMAT_KEY_CHANNEL_COUNT, channels);
        AMediaFormat_setBuffer(fmt, "csd-0", csd0, 2);

        LOGI("AAC CSD-0 构造: 0x%02x 0x%02x (sr=%d ch=%d idx=%d)",
            csd0[0], csd0[1], sampleRate, channels, freqIndex);
        return fmt;
    }

    // ---- WAV ----

    static bool isWavFile(const std::string& path) {
        size_t len = path.size();
        if (len < 4) return false;
        return (path[len-4] == '.' &&
                (path[len-3] == 'w' || path[len-3] == 'W') &&
                (path[len-2] == 'a' || path[len-2] == 'A') &&
                (path[len-1] == 'v' || path[len-1] == 'V'));
    }

    bool configureFromWav(const std::string& path) {
        FILE* fp = fopen(path.c_str(), "rb");
        if (!fp) {
            LOGE("打开 WAV 文件失败: %s", path.c_str());
            if (errorCallback_) errorCallback_("打开 WAV 文件失败: " + path);
            return false;
        }

        // 获取文件实际大小，用于校验 data chunk 声明的长度（防恶意/损坏文件头）
        if (fseek(fp, 0, SEEK_END) != 0) {
            fclose(fp);
            if (errorCallback_) errorCallback_("WAV 文件 seek 失败");
            return false;
        }
        long fileSize = ftell(fp);
        if (fseek(fp, 0, SEEK_SET) != 0 || fileSize <= 0) {
            fclose(fp);
            if (errorCallback_) errorCallback_("WAV 文件大小无效");
            return false;
        }

        char riff[4];
        if (fread(riff, 1, 4, fp) != 4 || memcmp(riff, "RIFF", 4) != 0) {
            LOGE("不是有效的 RIFF 文件");
            fclose(fp);
            if (errorCallback_) errorCallback_("不是有效的 WAV 文件（缺少 RIFF 头）");
            return false;
        }
        fseek(fp, 4, SEEK_CUR);
        char wave[4];
        if (fread(wave, 1, 4, fp) != 4 || memcmp(wave, "WAVE", 4) != 0) {
            LOGE("不是有效的 WAVE 文件");
            fclose(fp);
            if (errorCallback_) errorCallback_("不是有效的 WAV 文件（缺少 WAVE 标识）");
            return false;
        }

        bool fmtFound = false, dataFound = false;
        uint32_t dataSize = 0;

        while (!dataFound) {
            char chunkId[4];
            if (fread(chunkId, 1, 4, fp) != 4) break;
            uint32_t chunkSize;
            if (fread(&chunkSize, 4, 1, fp) != 1) break;

            if (memcmp(chunkId, "fmt ", 4) == 0 && !fmtFound) {
                uint16_t audioFormat, channels, bitsPerSample;
                uint32_t sampleRate;
                if (fread(&audioFormat, 2, 1, fp) != 1) break;
                if (fread(&channels, 2, 1, fp) != 1) break;
                if (fread(&sampleRate, 4, 1, fp) != 1) break;
                fseek(fp, 4, SEEK_CUR);
                fseek(fp, 2, SEEK_CUR);
                if (fread(&bitsPerSample, 2, 1, fp) != 1) break;

                if (audioFormat != 1) {
                    LOGE("不支持的 WAV 格式: %d (仅支持 PCM)", audioFormat);
                    fclose(fp);
                    if (errorCallback_) errorCallback_("不支持的 WAV 格式: 仅支持 PCM (格式=" + std::to_string(audioFormat) + ")");
                    return false;
                }
                // 参数合法性校验：非法采样率/声道/位深会导致后续除零或编码器配置异常
                if (sampleRate < 8000 || sampleRate > 96000 ||
                    channels < 1 || channels > 2 || bitsPerSample != 16) {
                    LOGE("WAV 参数非法: %dHz %dch %dbit (仅支持 8k-96kHz/1-2ch/16bit)",
                        sampleRate, channels, bitsPerSample);
                    fclose(fp);
                    if (errorCallback_) {
                        errorCallback_("WAV 参数非法: " + std::to_string(sampleRate) + "Hz " +
                            std::to_string(channels) + "ch " + std::to_string(bitsPerSample) +
                            "bit (仅支持 8k-96kHz/1-2ch/16bit)");
                    }
                    return false;
                }
                srcChannelCount_ = channels;
                srcSampleRate_ = sampleRate;
                srcBitsPerSample_ = bitsPerSample;
                fmtFound = true;
                LOGI("WAV fmt: %dHz %dch %dbit", sampleRate, channels, bitsPerSample);
                long extra = (long)chunkSize - 16;
                if (extra > 0) fseek(fp, extra, SEEK_CUR);
            } else if (memcmp(chunkId, "data", 4) == 0) {
                dataSize = chunkSize;
                dataFound = true;
            } else {
                fseek(fp, chunkSize, SEEK_CUR);
            }
        }

        if (!fmtFound || !dataFound) {
            LOGE("WAV 文件缺少 fmt 或 data chunk");
            fclose(fp);
            if (errorCallback_) errorCallback_("WAV 文件缺少 fmt 或 data chunk");
            return false;
        }

        // dataSize 不得超过文件实际剩余字节（防恶意/损坏文件头声明超大长度）
        long dataOffset = ftell(fp);
        long remaining = fileSize - dataOffset;
        if (remaining < 0) remaining = 0;
        if ((long)dataSize > remaining) {
            LOGW("WAV dataSize(%u) 超过文件剩余字节(%ld)，按实际截断", dataSize, remaining);
            dataSize = (uint32_t)remaining;
        }
        // 总内存上限：约 1.5 小时立体声 16bit@44.1kHz；超限拒绝并降级为无声视频
        constexpr uint64_t kMaxPcmBytes = 512ULL * 1024 * 1024;
        if (dataSize > kMaxPcmBytes) {
            LOGE("WAV PCM 过大(%u bytes > %llu)，拒绝", dataSize,
                 (unsigned long long)kMaxPcmBytes);
            fclose(fp);
            if (errorCallback_) errorCallback_("WAV PCM 数据过大，已拒绝（超过 512MB）");
            return false;
        }

        pcmData_.resize(dataSize);
        size_t read = fread(pcmData_.data(), 1, dataSize, fp);
        fclose(fp);
        if (read != dataSize) {
            LOGW("WAV 数据读取不完整: %zu/%u", read, dataSize);
            pcmData_.resize(read);
        }
        LOGI("WAV 解析完成: %zu 字节 PCM, 时长 %.1f 秒",
            pcmData_.size(),
            (double)pcmData_.size() / (srcSampleRate_ * srcChannelCount_ * 2));
        return true;
    }

    // ---- MediaExtractor (MP3/AAC) ----

    bool configureFromExtractor(const std::string& path) {
        int fd = open(path.c_str(), O_RDONLY);
        if (fd < 0) {
            LOGE("打开音频文件失败: %s", path.c_str());
            if (errorCallback_) errorCallback_("打开音频文件失败: " + path);
            return false;
        }
        off_t fileSize = lseek(fd, 0, SEEK_END);
        lseek(fd, 0, SEEK_SET);

        extractor_ = AMediaExtractor_new();
        media_status_t status = AMediaExtractor_setDataSourceFd(extractor_, fd, 0, fileSize);
        if (status != AMEDIA_OK) {
            LOGE("Extractor 打开失败: %s (status=%d)", path.c_str(), status);
            close(fd);
            AMediaExtractor_delete(extractor_);
            extractor_ = nullptr;
            if (errorCallback_) errorCallback_("音频文件解析失败: Extractor 打开失败 (status=" + std::to_string(status) + ")");
            return false;
        }

        int numTracks = AMediaExtractor_getTrackCount(extractor_);
        int audioTrack = -1;
        for (int i = 0; i < numTracks; i++) {
            AMediaFormat* format = AMediaExtractor_getTrackFormat(extractor_, i);
            const char* mime = nullptr;
            AMediaFormat_getString(format, AMEDIAFORMAT_KEY_MIME, &mime);
            if (mime && strncmp(mime, "audio/", 6) == 0) {
                audioTrack = i;
                AMediaFormat_getInt32(format, AMEDIAFORMAT_KEY_SAMPLE_RATE, &srcSampleRate_);
                AMediaFormat_getInt32(format, AMEDIAFORMAT_KEY_CHANNEL_COUNT, &srcChannelCount_);
                LOGI("Extractor 音频轨 %d: %s %dHz %dch", i, mime, srcSampleRate_, srcChannelCount_);
                AMediaExtractor_selectTrack(extractor_, i);
                AMediaFormat_delete(format);
                break;
            }
            AMediaFormat_delete(format);
        }

        if (audioTrack < 0) {
            LOGE("未找到音频轨: %s", path.c_str());
            AMediaExtractor_delete(extractor_);
            extractor_ = nullptr;
            if (errorCallback_) errorCallback_("未找到音频轨: " + path);
            return false;
        }

        LOGI("音频源已打开(后台解码): %s", path.c_str());
        decodeThread_ = std::thread([this]() {
            bool ok = decodeExtractorToPcm();
            decodeFailed_.store(!ok);
        });
        return true;
    }

    bool decodeExtractorToPcm() {
        if (!extractor_) {
            if (errorCallback_) errorCallback_("音频解码器初始化失败：Extractor 为空");
            return false;
        }
        LOGI("开始音频解码(后台线程)...");

        AMediaFormat* srcFormat = AMediaExtractor_getTrackFormat(extractor_, 0);
        const char* mime = nullptr;
        AMediaFormat_getString(srcFormat, AMEDIAFORMAT_KEY_MIME, &mime);
        if (!mime) {
            AMediaFormat_delete(srcFormat);
            LOGE("无法获取音频 MIME");
            if (errorCallback_) errorCallback_("无法获取音频 MIME 类型");
            return false;
        }

        AMediaCodec* decoder = AMediaCodec_createDecoderByType(mime);
        if (!decoder) {
            AMediaFormat_delete(srcFormat);
            LOGE("创建音频解码器失败: %s", mime);
            if (errorCallback_) errorCallback_("创建音频解码器失败: " + std::string(mime));
            return false;
        }

        media_status_t status = AMediaCodec_configure(decoder, srcFormat, nullptr, nullptr, 0);
        AMediaFormat_delete(srcFormat);
        if (status != AMEDIA_OK) {
            LOGE("音频解码器配置失败: %d", status);
            AMediaCodec_delete(decoder);
            if (errorCallback_) errorCallback_("音频解码器配置失败 (status=" + std::to_string(status) + ")");
            return false;
        }
        status = AMediaCodec_start(decoder);
        if (status != AMEDIA_OK) {
            LOGE("音频解码器启动失败: %d", status);
            AMediaCodec_delete(decoder);
            if (errorCallback_) errorCallback_("音频解码器启动失败 (status=" + std::to_string(status) + ")");
            return false;
        }

        bool eosSent = false, eosReceived = false;
        while (!eosReceived && !cancelled_.load()) {
            if (!eosSent) {
                ssize_t inputIdx = AMediaCodec_dequeueInputBuffer(decoder, 10000);
                if (inputIdx >= 0) {
                    size_t outSize = 0;
                    uint8_t* buf = AMediaCodec_getInputBuffer(decoder, inputIdx, &outSize);
                    if (!buf) break;
                    ssize_t sampleSize = AMediaExtractor_readSampleData(extractor_, buf, outSize);
                    if (sampleSize > 0) {
                        int64_t pts = AMediaExtractor_getSampleTime(extractor_);
                        AMediaCodec_queueInputBuffer(decoder, inputIdx, 0, sampleSize, pts, 0);
                        AMediaExtractor_advance(extractor_);
                    } else {
                        AMediaCodec_queueInputBuffer(decoder, inputIdx, 0, 0, 0,
                            AMEDIACODEC_BUFFER_FLAG_END_OF_STREAM);
                        eosSent = true;
                    }
                }
            }

            AMediaCodecBufferInfo info;
            ssize_t outputIdx = AMediaCodec_dequeueOutputBuffer(decoder, &info, 0);
            if (outputIdx >= 0) {
                if (info.size > 0) {
                    uint8_t* src = AMediaCodec_getOutputBuffer(decoder, outputIdx, nullptr);
                    if (src) {
                        size_t oldSize = pcmData_.size();
                        pcmData_.resize(oldSize + info.size);
                        memcpy(pcmData_.data() + oldSize, src + info.offset, info.size);
                    }
                }
                if (info.flags & AMEDIACODEC_BUFFER_FLAG_END_OF_STREAM) {
                    eosReceived = true;
                }
                AMediaCodec_releaseOutputBuffer(decoder, outputIdx, false);
            }
        }

        AMediaCodec_stop(decoder);
        AMediaCodec_delete(decoder);
        AMediaExtractor_delete(extractor_);
        extractor_ = nullptr;

        LOGI("音频解码完成: %zu 字节 PCM, %.1f 秒",
            pcmData_.size(),
            (double)pcmData_.size() / (srcSampleRate_ * srcChannelCount_ * 2));
        if (pcmData_.empty() && errorCallback_) {
            errorCallback_("音频解码完成但 PCM 数据为空");
        }
        return !pcmData_.empty();
    }
};
