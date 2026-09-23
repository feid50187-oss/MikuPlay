#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <cstdio>
#include <cstring>
#include <sys/stat.h>
#include <sys/types.h>
#include <dirent.h>
#include <unistd.h>
#include <android/log.h>

#undef LOG_TAG
#define LOG_TAG "AlphaFrameWriter"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

/**
 * NV12A 帧磁盘写入器
 *
 * 将完整的 NV12A 帧（NV12 + Alpha）保存为单帧 raw 文件，用于后续 VP9 重编码。
 * 目录结构: <outputPathDir>/<outputBaseName>_frames/{frame00000000.raw, frame00000001.raw, ...}
 * 每个 raw 文件 = 2.5×W×H 字节（NV12 1.5×W×H + Alpha W×H）。
 */
class AlphaFrameWriter {
public:
    AlphaFrameWriter() = default;
    ~AlphaFrameWriter() { close(); }

    /**
     * 初始化帧目录。
     * @param outputPath 主输出 mp4 路径，例如 /sdcard/MikuPlay/x.mp4
     *                   帧目录将为 /sdcard/MikuPlay/x_frames/
     * @param width 视频宽
     * @param height 视频高
     */
    bool init(const std::string& outputPath, int width, int height) {
        width_ = width;
        height_ = height;
        nv12Size_ = width * height * 3 / 2;       // NV12 = 1.5 bytes/px
        alphaBytesPerFrame_ = width * height;      // Alpha = 1 byte/px
        frameBytes_ = nv12Size_ + alphaBytesPerFrame_; // NV12A = 2.5 bytes/px

        // 以 mp4 基名生成帧目录
        size_t lastSlash = outputPath.find_last_of("/\\");
        std::string dir = (lastSlash == std::string::npos) ? "." : outputPath.substr(0, lastSlash);
        std::string base = (lastSlash == std::string::npos) ? outputPath : outputPath.substr(lastSlash + 1);
        size_t dot = base.rfind('.');
        if (dot != std::string::npos) base = base.substr(0, dot);
        alphaDir_ = dir + "/" + base + "_frames";

        // 目录不存在则创建
        struct stat st{};
        if (stat(alphaDir_.c_str(), &st) != 0) {
            int ret = mkdir(alphaDir_.c_str(), 0755);
            if (ret != 0 && errno != EEXIST) {
                LOGE("创建帧目录失败: %s errno=%d", alphaDir_.c_str(), errno);
                return false;
            }
        }

        // 清空目录中已有的 .raw 文件
        DIR* d = opendir(alphaDir_.c_str());
        if (d) {
            struct dirent* ent;
            while ((ent = readdir(d)) != nullptr) {
                std::string name = ent->d_name;
                if (name.size() >= 4 && name.substr(name.size() - 4) == ".raw") {
                    std::string full = alphaDir_ + "/" + name;
                    ::remove(full.c_str());
                }
            }
            closedir(d);
        }

        LOGI("AlphaFrameWriter 初始化完成: dir=%s frameBytes=%zu (NV12=%zu + Alpha=%zu)",
             alphaDir_.c_str(), frameBytes_, nv12Size_, alphaBytesPerFrame_);
        return true;
    }

    /**
     * 将完整 NV12A 帧写入磁盘
     * @param nv12aData NV12A 完整帧 (1.5*WH + WH = 2.5*WH 字节)
     * @param size 总字节
     * @return 成功返回 true
     */
    bool writeFrame(int frameIndex, const uint8_t* nv12aData, size_t size) {
        if (alphaDir_.empty() || frameBytes_ == 0) {
            LOGE("AlphaFrameWriter 未初始化");
            return false;
        }
        if (size < frameBytes_) {
            LOGE("NV12A 帧太小: size=%zu need=%zu", size, frameBytes_);
            return false;
        }

        char fname[128];
        snprintf(fname, sizeof(fname), "frame%08d.raw", frameIndex);
        std::string path = alphaDir_ + "/" + fname;

        FILE* fp = fopen(path.c_str(), "wb");
        if (!fp) {
            LOGE("写入帧失败: %s errno=%d", path.c_str(), errno);
            return false;
        }
        size_t wrote = fwrite(nv12aData, 1, frameBytes_, fp);
        fclose(fp);
        if (wrote != frameBytes_) {
            LOGE("帧不完整: wrote=%zu need=%zu", wrote, frameBytes_);
            return false;
        }
        ++frameCount_;
        return true;
    }

    void close() {
        alphaDir_.clear();
        width_ = 0;
        height_ = 0;
        nv12Size_ = 0;
        alphaBytesPerFrame_ = 0;
        frameBytes_ = 0;
        frameCount_ = 0;
    }

    /**
     * 递归删除帧目录（VP9 合成完成或失败后清理中间文件）
     * @param dirPath 目录路径
     * @return 成功返回 true
     */
    static bool removeDirectory(const std::string& dirPath) {
        if (dirPath.empty()) return true;
        DIR* d = opendir(dirPath.c_str());
        if (!d) {
            // 目录不存在也算删除成功
            if (errno == ENOENT) return true;
            LOGE("removeDirectory: 无法打开目录 %s errno=%d", dirPath.c_str(), errno);
            return false;
        }
        bool success = true;
        struct dirent* ent;
        while ((ent = readdir(d)) != nullptr) {
            std::string name = ent->d_name;
            if (name == "." || name == "..") continue;
            std::string full = dirPath + "/" + name;
            struct stat st{};
            if (stat(full.c_str(), &st) == 0) {
                if (S_ISDIR(st.st_mode)) {
                    // 递归删除子目录
                    if (!removeDirectory(full)) success = false;
                } else {
                    // 删除文件
                    if (::unlink(full.c_str()) != 0) {
                        LOGW("removeDirectory: 删除文件失败 %s errno=%d", full.c_str(), errno);
                        success = false;
                    }
                }
            }
        }
        closedir(d);
        // 删除空目录本身
        if (::rmdir(dirPath.c_str()) != 0) {
            LOGW("removeDirectory: 删除目录失败 %s errno=%d", dirPath.c_str(), errno);
            success = false;
        }
        return success;
    }

    const std::string& alphaDir() const { return alphaDir_; }
    int frameCount() const { return frameCount_; }
    int width() const { return width_; }
    int height() const { return height_; }
    size_t nv12Size() const { return nv12Size_; }
    size_t alphaSize() const { return alphaBytesPerFrame_; }
    size_t frameBytes() const { return frameBytes_; }

private:
    std::string alphaDir_;
    int width_ = 0;
    int height_ = 0;
    size_t nv12Size_ = 0;            // NV12 部分字节数 (1.5*W*H)
    size_t alphaBytesPerFrame_ = 0;  // Alpha 部分字节数 (W*H)
    size_t frameBytes_ = 0;          // 整帧字节数 (2.5*W*H)
    std::atomic<int> frameCount_{0};
    std::mutex mu_;
};
