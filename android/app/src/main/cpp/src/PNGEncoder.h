#pragma once

#include <string>
#include <vector>
#include <functional>
#include <cstring>
#include <cstdio>
#include <android/log.h>
#include <zlib.h>

#undef LOG_TAG
#define LOG_TAG "PNGEncoder"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

/**
 * PNG 编码器 — 将 RGBA 原始像素数据编码为 PNG 文件
 *
 * 使用 zlib 压缩（已链接到主库），手写 PNG 容器格式：
 *   Signature → IHDR → IDAT(zlib-compressed filtered scanlines) → IEND
 *
 * 过滤策略：Filter None(0) 每扫描线 1 字节前缀，最简单可靠。
 */
class PNGEncoder {
public:
    struct Config {
        int width = 1920;
        int height = 1080;
        std::string outputPath;
    };

    using ProgressCallback = std::function<void(int encoded, int total)>;
    using ErrorCallback = std::function<void(const std::string& msg)>;
    using CompleteCallback = std::function<void(const std::string& outputPath)>;

    PNGEncoder() = default;
    ~PNGEncoder() = default;

    void setConfig(const Config& config) { config_ = config; }
    void setProgressCallback(ProgressCallback cb) { onProgress_ = std::move(cb); }
    void setErrorCallback(ErrorCallback cb) { onError_ = std::move(cb); }
    void setCompleteCallback(CompleteCallback cb) { onComplete_ = std::move(cb); }

    /**
     * 将 RGBA 数据编码为 PNG 文件
     * @param rgbaData RGBA 原始像素数据（R-G-B-A 逐像素，每像素 4 字节）
     * @param rgbaSize 数据大小，必须等于 width*height*4
     * @return 是否成功
     */
    bool encode(const uint8_t* rgbaData, size_t rgbaSize) {
        const int w = config_.width;
        const int h = config_.height;
        const size_t expectedSize = static_cast<size_t>(w) * h * 4;

        if (rgbaSize != expectedSize) {
            LOGE("RGBA 数据大小不匹配: %zu != %zu (W=%d, H=%d)",
                rgbaSize, expectedSize, w, h);
            if (onError_) onError_("RGBA 数据大小不匹配");
            return false;
        }

        LOGI("PNG 编码开始: %dx%d → %s", w, h, config_.outputPath.c_str());

        // 构造带 filter byte 的原始扫描线数据
        // 每行: [filter_byte(0)] [RGBA pixels...]
        const size_t rowSize = static_cast<size_t>(w) * 4 + 1; // +1 for filter byte
        const size_t rawSize = rowSize * h;
        std::vector<uint8_t> rawData(rawSize);

        for (int y = 0; y < h; y++) {
            uint8_t* rowPtr = rawData.data() + y * rowSize;
            rowPtr[0] = 0; // Filter None
            // Y-flip：gl.readPixels 返回从下到上的数据（OpenGL 原点在左下角），
            // PNG 存储是从上到下的（原点在左上角），需要翻转行顺序
            std::memcpy(rowPtr + 1, rgbaData + (h - 1 - y) * w * 4, w * 4);
        }

        // zlib 压缩
        uLongf compressedBound = compressBound((uLongf)rawSize);
        std::vector<uint8_t> compressed(compressedBound);

        int ret = compress(compressed.data(), &compressedBound,
                          rawData.data(), (uLongf)rawSize);
        if (ret != Z_OK) {
            LOGE("zlib 压缩失败: %d", ret);
            if (onError_) onError_("zlib 压缩失败");
            return false;
        }
        compressed.resize(compressedBound);

        // 写 PNG 文件
        FILE* fp = std::fopen(config_.outputPath.c_str(), "wb");
        if (!fp) {
            LOGE("无法打开输出文件: %s", config_.outputPath.c_str());
            if (onError_) onError_("无法打开输出文件");
            return false;
        }

        bool success = true;

        // 1. PNG Signature (8 bytes)
        const uint8_t signature[8] = {
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
        };
        if (std::fwrite(signature, 1, 8, fp) != 8) success = false;

        // 2. IHDR chunk
        if (success) {
            uint8_t ihdrData[13];
            // Width (big-endian 32-bit)
            ihdrData[0] = (w >> 24) & 0xFF;
            ihdrData[1] = (w >> 16) & 0xFF;
            ihdrData[2] = (w >> 8) & 0xFF;
            ihdrData[3] = w & 0xFF;
            // Height
            ihdrData[4] = (h >> 24) & 0xFF;
            ihdrData[5] = (h >> 16) & 0xFF;
            ihdrData[6] = (h >> 8) & 0xFF;
            ihdrData[7] = h & 0xFF;
            // Bit depth = 8
            ihdrData[8] = 8;
            // Color type = 6 (RGBA)
            ihdrData[9] = 6;
            // Compression method = 0 (deflate)
            ihdrData[10] = 0;
            // Filter method = 0 (adaptive with 5 types)
            ihdrData[11] = 0;
            // Interlace method = 0 (no interlace)
            ihdrData[12] = 0;

            success = writeChunk(fp, "IHDR", ihdrData, 13);
        }

        // 3. IDAT chunk (可能需要分片写入，但小到中等分辨率一个 chunk 足够)
        if (success) {
            success = writeChunk(fp, "IDAT", compressed.data(), compressed.size());
        }

        // 4. IEND chunk
        if (success) {
            success = writeChunk(fp, "IEND", nullptr, 0);
        }

        std::fclose(fp);

        if (success) {
            LOGI("PNG 编码完成: %s", config_.outputPath.c_str());
            if (onComplete_) onComplete_(config_.outputPath);
        } else {
            LOGE("PNG 写入失败");
            if (onError_) onError_("PNG 写入失败");
        }

        return success;
    }

private:
    Config config_;
    ProgressCallback onProgress_;
    ErrorCallback onError_;
    CompleteCallback onComplete_;

    /**
     * 写一个 PNG chunk：[length(4)][type(4)][data(length)][crc(4)]
     */
    static bool writeChunk(FILE* fp, const char* type,
                           const uint8_t* data, uint32_t dataLen) {
        uint8_t lenBuf[4];
        lenBuf[0] = (dataLen >> 24) & 0xFF;
        lenBuf[1] = (dataLen >> 16) & 0xFF;
        lenBuf[2] = (dataLen >> 8) & 0xFF;
        lenBuf[3] = dataLen & 0xFF;

        if (std::fwrite(lenBuf, 1, 4, fp) != 4) return false;
        if (std::fwrite(type, 1, 4, fp) != 4) return false;
        if (dataLen > 0 && data) {
            if (std::fwrite(data, 1, dataLen, fp) != dataLen) return false;
        }

        // CRC = crc32(type + data)
        uLong crc = crc32(0L, Z_NULL, 0);
        crc = crc32(crc, reinterpret_cast<const Bytef*>(type), 4);
        if (dataLen > 0 && data) {
            crc = crc32(crc, data, dataLen);
        }

        uint8_t crcBuf[4];
        crcBuf[0] = (crc >> 24) & 0xFF;
        crcBuf[1] = (crc >> 16) & 0xFF;
        crcBuf[2] = (crc >> 8) & 0xFF;
        crcBuf[3] = crc & 0xFF;

        return std::fwrite(crcBuf, 1, 4, fp) == 4;
    }
};