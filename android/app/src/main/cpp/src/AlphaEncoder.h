#pragma once

#include <string>
#include <vector>
#include <deque>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <memory>
#include <chrono>
#include <thread>
#include <atomic>
#include <sys/stat.h>
#include <dirent.h>
#include <unistd.h>
#include <android/log.h>

// --- libvpx ---
extern "C" {
#include "vpx/vpx_encoder.h"
#include "vpx/vpx_codec.h"
#include "vpx/vp8cx.h"
#include "vpx/vpx_image.h"
}

// --- libwebm ---
#include "mkvmuxer/mkvmuxer.h"
#include "mkvmuxer/mkvmuxerutil.h"
#include "mkvmuxer/mkvwriter.h"

#undef LOG_TAG
#define LOG_TAG "AlphaEncoder"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

// 简易 NV12→I420（不依赖 libyuv）
static inline void nv12_to_i420(const uint8_t* nv12_y, const uint8_t* nv12_uv,
                                uint8_t* i420_y, uint8_t* i420_u, uint8_t* i420_v,
                                int w, int h) {
    memcpy(i420_y, nv12_y, w * h);
    const int uv_rows = h / 2;
    const int uv_stride = w;
    for (int r = 0; r < uv_rows; r++) {
        const uint8_t* src = nv12_uv + r * uv_stride;
        uint8_t* du = i420_u + r * (w / 2);
        uint8_t* dv = i420_v + r * (w / 2);
        for (int c = 0; c < w / 2; c++) {
            du[c] = src[c * 2];
            dv[c] = src[c * 2 + 1];
        }
    }
}

/**
 * VP9 透明视频编码器：双流编码 + WebM 合成
 *
 * libvpx VP9 编码器不支持单流 I420A 图像。
 * WebM 透明视频的标准方案是双流编码：
 *   1. 主流：NV12→I420 编码为 VP9（YUV 内容）
 *   2. Alpha 流：Alpha 作为灰度 I420 编码为 VP9（Y=alpha, U=V=128）
 *   3. 使用 libwebm mkvmuxer 将两流合成为带 BlockAdditions 的 WebM
 *
 * 关键实现要点：
 *  - 使用 pkt->data.frame.pts 匹配两流的输出包（编码器可能延迟输出）
 *  - 使用 pkt->data.frame.flags & VPX_FRAME_IS_KEY 判断关键帧（必须两端一致）
 *  - 为保证 alpha 流关键帧与主流同步，主流关键帧 pts 强制 alpha 流也发关键帧
 */
class AlphaEncoder {
public:
    using ProgressCallback = std::function<void(int current, int total)>;

    AlphaEncoder() = default;
    ~AlphaEncoder() { release(); }

    void cancel() { cancelled_.store(true); }

    void setProgressCallback(ProgressCallback cb) { progressCallback_ = std::move(cb); }

    /**
     * 执行 VP9 透明视频合成
     * @param frameDir NV12A 帧目录（含 frame00000000.raw 等）
     * @param outputPath 目标输出 .webm 路径
     * @param width 视频宽
     * @param height 视频高
     * @param frameRate 帧率
     * @return 成功返回 true
     */
    bool encodeToIVF(const std::string& frameDir,
                     const std::string& outputPath,
                     int width, int height, int frameRate) {
        LOGI("开始 VP9 双流合成: frameDir=%s out=%s %dx%d @%dfps",
             frameDir.c_str(), outputPath.c_str(),
             width, height, frameRate);

        if (cancelled_.load()) {
            LOGW("合成被取消");
            return false;
        }

        // 1. 列出帧目录
        auto frameFiles = listFrameFiles(frameDir);
        if (frameFiles.empty()) {
            LOGE("帧目录无 raw 文件: %s", frameDir.c_str());
            return false;
        }
        LOGI("找到 NV12A 帧: %zu 个", frameFiles.size());

        // 2. 初始化主 VP9 编码器
        VpxEncoder mainEnc;
        if (!mainEnc.init(width, height, frameRate, false)) {
            LOGE("主 VP9 编码器初始化失败");
            return false;
        }

        // 3. 初始化 Alpha VP9 编码器
        VpxEncoder alphaEnc;
        if (!alphaEnc.init(width, height, frameRate, true)) {
            LOGE("Alpha VP9 编码器初始化失败");
            mainEnc.release();
            return false;
        }

        // 4. 初始化 WebM muxer
        mkvmuxer::MkvWriter writer;
        if (!writer.Open(outputPath.c_str())) {
            LOGE("无法打开输出文件: %s", outputPath.c_str());
            mainEnc.release();
            alphaEnc.release();
            return false;
        }

        mkvmuxer::Segment segment;
        if (!segment.Init(&writer)) {
            LOGE("WebM Segment 初始化失败");
            mainEnc.release();
            alphaEnc.release();
            return false;
        }
        segment.set_mode(mkvmuxer::Segment::kFile);
        segment.OutputCues(true);

        mkvmuxer::SegmentInfo* info = segment.GetSegmentInfo();
        info->set_timecode_scale(1000000); // 1ms
        info->set_writing_app("MikuPlay");

        const uint64_t kVideoTrackNumber = 1;
        uint64_t trackId = segment.AddVideoTrack(width, height, kVideoTrackNumber);
        if (trackId == 0) {
            LOGE("AddVideoTrack 失败");
            mainEnc.release();
            alphaEnc.release();
            return false;
        }
        auto* videoTrack =
            static_cast<mkvmuxer::VideoTrack*>(segment.GetTrackByNumber(trackId));
        if (!videoTrack) {
            LOGE("GetTrackByNumber 失败");
            mainEnc.release();
            alphaEnc.release();
            return false;
        }
        videoTrack->set_codec_id("V_VP9");
        videoTrack->SetAlphaMode(mkvmuxer::VideoTrack::kAlpha);
        videoTrack->set_max_block_additional_id(1);

        // 5. 工作缓冲区
        const int ySize = width * height;
        const int uvSize = width * height / 4;
        const size_t nv12Size = width * height * 3 / 2;
        const size_t nv12aSize = nv12Size + ySize;

        std::vector<uint8_t> nv12aBuf(nv12aSize);
        std::vector<uint8_t> i420_y(ySize), i420_u(uvSize), i420_v(uvSize);
        std::vector<uint8_t> alpha_i420_y(ySize), alpha_i420_uv(uvSize * 2);
        memset(alpha_i420_uv.data(), 128, uvSize * 2);

        int totalFrames = static_cast<int>(frameFiles.size());
        int framesEncoded = 0;
        auto startTime = std::chrono::steady_clock::now();
        bool ok = true;

        // 主编码循环
        for (int i = 0; i < totalFrames; i++) {
            if (cancelled_.load()) { LOGW("取消"); ok = false; break; }

            // a. 读 NV12A
            std::string fp = frameDir + "/" + frameFiles[i];
            if (!readRaw(fp, nv12aBuf.data(), nv12aSize)) {
                LOGE("读帧失败: %s", fp.c_str()); ok = false; break;
            }

            // b. 拆分：NV12 (Y + UV) + Alpha
            const uint8_t* nv12Y = nv12aBuf.data();
            const uint8_t* nv12UV = nv12aBuf.data() + ySize;
            const uint8_t* alphaPlane = nv12aBuf.data() + nv12Size;

            // c. NV12 → I420
            nv12_to_i420(nv12Y, nv12UV, i420_y.data(), i420_u.data(), i420_v.data(),
                         width, height);
            // Alpha → I420 灰度
            memcpy(alpha_i420_y.data(), alphaPlane, ySize);

            // d. 将帧送入编码器
            //    - 首帧强制关键帧（VP9 必须以关键帧开始）
            //    - 关键帧在两流间同步保证匹配
            bool forceKey = (i == 0);
            mainEnc.sendFrame(i420_y.data(), i420_u.data(), i420_v.data(),
                              width, height, i, forceKey);
            alphaEnc.sendFrame(alpha_i420_y.data(), alpha_i420_uv.data(),
                               alpha_i420_uv.data() + uvSize,
                               width, height, i, forceKey);

            // e. 两流输出包队列匹配 PTS，写 WebM
            if (!drainMatchAndWrite(mainEnc, alphaEnc, segment,
                                    kVideoTrackNumber, frameRate, framesEncoded,
                                    /*forceWaitPkt*/false)) {
                LOGE("drainMatchAndWrite 失败 i=%d", i); ok = false; break;
            }

            if (framesEncoded > 0 && framesEncoded % 30 == 0) {
                auto s = std::chrono::duration_cast<std::chrono::seconds>(
                    std::chrono::steady_clock::now() - startTime).count();
                LOGI("VP9 合成中: %d/%d 帧 (%ds)", framesEncoded, totalFrames, (int)s);
                if (progressCallback_) {
                    progressCallback_(framesEncoded, totalFrames);
                }
            }
        }

        // 6. flush 编码器，然后继续匹配剩余包
        if (ok) {
            mainEnc.flush();
            alphaEnc.flush();
            if (!drainMatchAndWrite(mainEnc, alphaEnc, segment,
                                    kVideoTrackNumber, frameRate, framesEncoded,
                                    /*forceWaitPkt*/true)) {
                LOGW("flush 阶段 drainMatchAndWrite 失败 (可能正常结束)");
            }
        }

        segment.Finalize();
        mainEnc.release();
        alphaEnc.release();
        writer.Close();

        auto dur = std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::steady_clock::now() - startTime).count();

        if (framesEncoded > 0 && !cancelled_.load() && ok) {
            LOGI("VP9 透明视频合成完成: %d 帧，%ds -> %s",
                 framesEncoded, (int)dur, outputPath.c_str());
            return true;
        }
        LOGE("VP9 合成失败: frames=%d cancelled=%d ok=%d",
             framesEncoded, (int)cancelled_.load(), (int)ok);
        if (framesEncoded == 0) ::remove(outputPath.c_str());
        return false;
    }

    void release() {}

private:
    std::atomic<bool> cancelled_{false};
    ProgressCallback progressCallback_;

    // 单路编码器输出包
    struct EncodedPkt {
        std::vector<uint8_t> data;
        int64_t pts;
        bool isKey;
    };

    // ---------------- VP9 编码器封装（输出带 pts/flags 的 pkt 队列） ----------------
    struct VpxEncoder {
        vpx_codec_ctx_t ctx{};
        bool initialized = false;
        int frameRate = 30;
        std::deque<EncodedPkt> outQueue;

        bool init(int width, int height, int frameRate_, bool isAlpha) {
            frameRate = frameRate_;
            vpx_codec_iface_t* iface = vpx_codec_vp9_cx();
            vpx_codec_enc_cfg cfg{};
            vpx_codec_err_t err = vpx_codec_enc_config_default(iface, &cfg, 0);
            if (err != VPX_CODEC_OK) {
                LOGE("enc_config_default: %s", vpx_codec_err_to_string(err));
                return false;
            }
            cfg.g_w = width;
            cfg.g_h = height;
            cfg.g_timebase.num = 1;
            cfg.g_timebase.den = frameRate;
            cfg.rc_target_bitrate = isAlpha
                ? width * height * frameRate / 4000   // alpha 低码率
                : width * height * frameRate / 1000;
            cfg.g_pass = VPX_RC_ONE_PASS;
            cfg.g_lag_in_frames = 0;
            cfg.rc_end_usage = VPX_VBR;
            cfg.g_error_resilient = 0;
            cfg.g_profile = 0; // I420
            cfg.kf_mode = VPX_KF_DISABLED; // 完全由 sendFrame 的 forceKey 控制关键帧

            err = vpx_codec_enc_init(&ctx, iface, &cfg, 0);
            if (err != VPX_CODEC_OK) {
                LOGE("enc_init: %s", vpx_codec_err_to_string(err));
                return false;
            }
            initialized = true;
            return true;
        }

        // 送入一帧；forceKey=true 强制关键帧
        bool sendFrame(const uint8_t* y, const uint8_t* u, const uint8_t* v,
                       int width, int height, int pts, bool forceKey) {
            if (!initialized) return false;

            vpx_image_t img{};
            img.fmt = VPX_IMG_FMT_I420;
            img.w = width; img.h = height;
            img.d_w = width; img.d_h = height;
            img.bit_depth = 8;
            img.x_chroma_shift = 1;
            img.y_chroma_shift = 1;
            img.bps = 12;
            img.stride[VPX_PLANE_Y] = width;
            img.stride[VPX_PLANE_U] = width / 2;
            img.stride[VPX_PLANE_V] = width / 2;
            img.stride[VPX_PLANE_ALPHA] = width;
            img.planes[VPX_PLANE_Y] = const_cast<uint8_t*>(y);
            img.planes[VPX_PLANE_U] = const_cast<uint8_t*>(u);
            img.planes[VPX_PLANE_V] = const_cast<uint8_t*>(v);
            img.img_data = nullptr;
            img.img_data_owner = 0;
            img.self_allocd = 0;

            unsigned long flags = 0;
            if (forceKey) flags |= VPX_EFLAG_FORCE_KF;

            vpx_codec_err_t err = vpx_codec_encode(
                &ctx, &img, pts, 1, flags, VPX_DL_REALTIME);
            if (err != VPX_CODEC_OK) {
                LOGE("sendFrame pts=%d err: %s", pts, vpx_codec_err_to_string(err));
                return false;
            }
            pumpPackets();
            return true;
        }

        bool flush() {
            if (!initialized) return false;
            vpx_codec_err_t err = vpx_codec_encode(
                &ctx, nullptr, -1, 0, 0, VPX_DL_REALTIME);
            if (err != VPX_CODEC_OK) return false;
            pumpPackets();
            return true;
        }

        void pumpPackets() {
            vpx_codec_iter_t iter = nullptr;
            const vpx_codec_cx_pkt_t* pkt = nullptr;
            while ((pkt = vpx_codec_get_cx_data(&ctx, &iter)) != nullptr) {
                if (pkt->kind == VPX_CODEC_CX_FRAME_PKT) {
                    EncodedPkt ep;
                    const uint8_t* buf =
                        reinterpret_cast<const uint8_t*>(pkt->data.frame.buf);
                    ep.data.assign(buf, buf + pkt->data.frame.sz);
                    ep.pts = pkt->data.frame.pts;
                    ep.isKey = (pkt->data.frame.flags & VPX_FRAME_IS_KEY) != 0;
                    outQueue.push_back(std::move(ep));
                }
            }
        }

        void release() {
            outQueue.clear();
            if (initialized) {
                vpx_codec_destroy(&ctx);
                initialized = false;
            }
        }
    };

    // ---------------- 匹配两流 pts 并写入 muxer ----------------
    // 对主流每一个输出包，找到 Alpha 流中相同 pts 的输出包并合成 BlockGroup。
    // 正常模式下每帧 encode + drain 后队列应最多 1 包；flush 模式下可能有多包。
    bool drainMatchAndWrite(VpxEncoder& mainEnc, VpxEncoder& alphaEnc,
                            mkvmuxer::Segment& segment,
                            uint64_t trackNumber, int frameRate,
                            int& framesEncoded, bool forceWaitPkt) {
        // 如果两队列都没数据，直接返回（正常）
        while (!mainEnc.outQueue.empty()) {
            const EncodedPkt& m = mainEnc.outQueue.front();
            // 在 alpha 队列里找同 pts 的包
            auto it = std::find_if(alphaEnc.outQueue.begin(),
                                   alphaEnc.outQueue.end(),
                                   [&](const EncodedPkt& a) { return a.pts == m.pts; });
            if (it == alphaEnc.outQueue.end()) {
                if (!forceWaitPkt) {
                    // 本轮没送足够帧，alpha 对应包还没出来，等下次 drain
                    return true;
                }
                LOGE("主流包 pts=%lld 在 alpha 流中找不到对应包 (alpha 剩余 %zu)",
                     (long long)m.pts, alphaEnc.outQueue.size());
                return false;
            }
            EncodedPkt a = *it;
            alphaEnc.outQueue.erase(it);

            uint64_t pts_ns = (uint64_t)m.pts * 1000000000ULL / frameRate;
            bool isKey = m.isKey || a.isKey; // 任一关键帧都按关键帧写

            if (!segment.AddFrameWithAdditional(
                    m.data.data(), m.data.size(),
                    a.data.data(), a.data.size(),
                    1, // add_id=1 代表 alpha 附加数据
                    trackNumber, pts_ns, isKey)) {
                LOGE("AddFrameWithAdditional 失败 pts=%lld", (long long)m.pts);
                return false;
            }
            mainEnc.outQueue.pop_front();
            ++framesEncoded;
        }
        return true;
    }

    // ---------------- 辅助函数 ----------------
    static std::vector<std::string> listFrameFiles(const std::string& dir) {
        std::vector<std::string> files;
        DIR* d = opendir(dir.c_str());
        if (!d) return files;
        struct dirent* ent;
        while ((ent = readdir(d)) != nullptr) {
            std::string name = ent->d_name;
            if (name.size() >= 4 && name.substr(name.size() - 4) == ".raw") {
                files.push_back(name);
            }
        }
        closedir(d);
        std::sort(files.begin(), files.end());
        return files;
    }

    static bool readRaw(const std::string& path, uint8_t* dst, size_t n) {
        FILE* fp = fopen(path.c_str(), "rb");
        if (!fp) return false;
        size_t r = fread(dst, 1, n, fp);
        fclose(fp);
        return r == n;
    }
};
