#include <jni.h>
#include <android/log.h>
#include <media/NdkMediaCodec.h>
#include <media/NdkMediaFormat.h>
#include <media/NdkMediaMuxer.h>

#include <memory>
#include <string>
#include <mutex>
#include <chrono>
#include <thread>
#include <atomic>
#include <cstdio> // ::remove

#include "FrameServer.h"
#include "FrameQueue.h"
#include "MediaCodecEncoder.h"
#include "AudioEncoder.h"
#include "AlphaFrameWriter.h"
#include "AlphaEncoder.h"
#include "PNGEncoder.h"
#include "Integrity.h"
#include "CrashHandler.h"

#undef LOG_TAG
#define LOG_TAG "JNIBridge"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)

struct NativeContext {
    std::unique_ptr<FrameServer> frameServer;
    std::unique_ptr<MediaCodecEncoder> encoder;
    std::unique_ptr<AudioEncoder> audioEncoder;
    std::unique_ptr<FrameQueue> frameQueue;
    std::unique_ptr<AlphaFrameWriter> alphaWriter;   // NV12A 管线：写入 alpha 帧 raw
    std::unique_ptr<AlphaEncoder> alphaEncoder;      // VP9 后合成：mp4 + alpha → ivf
    std::unique_ptr<PNGEncoder> pngEncoder;          // 帧输出模式：RGBA → PNG

    JavaVM* javaVM = nullptr;
    jobject pluginRef = nullptr;
    jmethodID onProgressMethod = nullptr;
    jmethodID onErrorMethod = nullptr;
    jmethodID onCompleteMethod = nullptr;
    jmethodID onEncodingProgressMethod = nullptr;

    std::atomic<int> encodedFrames{0};
    std::atomic<int> totalFrames{0};
    std::atomic<bool> sessionCompleted_{false};
    std::atomic<bool> finalizing_{false};
    std::atomic<bool> cancelRequested_{false};
    std::atomic<bool> cleanupDone_{false};
    std::string outputPath;           // mp4 路径 (由 MediaCodec 产出)
    std::string finalOutputPath;      // 最终交付路径 (透明模式 = webm 路径)
    std::string audioPath;
    int sessionWidth = 1920;
    int sessionHeight = 1080;
    int sessionFrameRate = 30;
    bool transparentMode = false;     // true: NV12A + 跳过音频 + VP9 后合成
    bool frameOutputMode = false;    // true: 帧输出模式，RGBA → PNG
    std::chrono::steady_clock::time_point sessionStartTime;
    static constexpr int SESSION_TIMEOUT_SECONDS = 1800;

    ~NativeContext() {
        // 先停止 frameServer（uWS 事件循环），再清理会话资源
        if (frameServer) {
            frameServer->stop();
            frameServer.reset();
        }
        doCleanup();

        if (pluginRef && javaVM) {
            JNIEnv* env = nullptr;
            bool attached = false;
            if (javaVM->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
                javaVM->AttachCurrentThread(&env, nullptr);
                attached = true;
            }
            if (env) {
                env->DeleteGlobalRef(pluginRef);
                pluginRef = nullptr;
            }
            if (attached) {
                javaVM->DetachCurrentThread();
            }
        }
    }

    void notifyProgress(int encoded, int total) {
        if (!javaVM || !pluginRef || !onProgressMethod) return;

        JNIEnv* env = nullptr;
        bool attached = false;
        if (javaVM->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
            javaVM->AttachCurrentThread(&env, nullptr);
            attached = true;
        }
        if (env && pluginRef) {
            env->CallVoidMethod(pluginRef, onProgressMethod, encoded, total);
        }
        if (attached) {
            javaVM->DetachCurrentThread();
        }
    }

    void notifyError(const std::string& message) {
        if (!javaVM || !pluginRef || !onErrorMethod) return;

        JNIEnv* env = nullptr;
        bool attached = false;
        if (javaVM->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
            javaVM->AttachCurrentThread(&env, nullptr);
            attached = true;
        }
        if (env && pluginRef) {
            jstring jmsg = env->NewStringUTF(message.c_str());
            env->CallVoidMethod(pluginRef, onErrorMethod, jmsg);
            env->DeleteLocalRef(jmsg);
        }
        if (attached) {
            javaVM->DetachCurrentThread();
        }
    }

    void notifyComplete(const std::string& path) {
        if (!javaVM || !pluginRef || !onCompleteMethod) return;

        JNIEnv* env = nullptr;
        bool attached = false;
        if (javaVM->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
            javaVM->AttachCurrentThread(&env, nullptr);
            attached = true;
        }
        if (env && pluginRef) {
            jstring jpath = env->NewStringUTF(path.c_str());
            env->CallVoidMethod(pluginRef, onCompleteMethod, jpath);
            env->DeleteLocalRef(jpath);
        }
        if (attached) {
            javaVM->DetachCurrentThread();
        }
    }

    void notifyEncodingProgress(int current, int total) {
        if (!javaVM || !pluginRef || !onEncodingProgressMethod) return;

        JNIEnv* env = nullptr;
        bool attached = false;
        if (javaVM->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
            javaVM->AttachCurrentThread(&env, nullptr);
            attached = true;
        }
        if (env && pluginRef) {
            env->CallVoidMethod(pluginRef, onEncodingProgressMethod, current, total);
        }
        if (attached) {
            javaVM->DetachCurrentThread();
        }
    }

    /** 会话未完成（取消/错误/异常路径）时删除半成品输出文件，避免残留损坏 MP4 */
    void discardIncompleteOutput() {
        if (!sessionCompleted_.load() && !outputPath.empty()) {
            ::remove(outputPath.c_str());
            LOGI("会话未完成，已删除半成品输出: %s", outputPath.c_str());
        }
    }

    /** 请求取消：传播到编码器/音频编码器，使 finalize 等长流程快速退出 */
    void requestCancel() {
        cancelRequested_.store(true);
        if (audioEncoder) audioEncoder->cancel();
        if (encoder) encoder->cancel();
    }

    /**
     * 统一清理路径（幂等）。仅首个调用者执行实际清理，
     * 后续调用直接返回 —— 避免 cleanup 处理器（uWS 线程）
     * 与 nativeStopServer（Capacitor 线程）的并发竞态。
     *
     * 注意：frameServer 是跨会话的持久服务器，不在此处销毁。
     * 仅在 ~NativeContext() 中停止。这样下次 nativeStartServer 可直接复用，
     * 避免端口未释放 / 空指针访问等问题。
     */
    void doCleanup() {
        bool expected = false;
        if (!cleanupDone_.compare_exchange_strong(expected, true)) {
            LOGI("doCleanup: 已清理，跳过");
            return;
        }
        LOGI("doCleanup: 开始清理会话资源");

        // 1. 关闭帧队列（shutdown join writerThread，非自 join，安全）
        if (frameQueue) {
            frameQueue->shutdown();
            frameQueue.reset();
        }

        // 2. 释放编码器等其他资源
        if (encoder) {
            encoder->release();
            discardIncompleteOutput();
            encoder.reset();
        }
        alphaWriter.reset();
        alphaEncoder.reset();
        pngEncoder.reset();
        frameOutputMode = false;
        audioEncoder.reset();
        audioPath.clear();
        encodedFrames.store(0);
        totalFrames.store(0);

        LOGI("doCleanup: 清理完成");
    }
};

static NativeContext* getNativeContext(jlong handle) {
    return reinterpret_cast<NativeContext*>(handle);
}

extern "C" {

jlong orp_nativeCreate(JNIEnv* env, jobject thiz) {
    JNI_SAFE_BEGIN(env, 0L)
    // 数据路径绑定：签名/资源校验未全部通过时拒绝创建编码会话，
    // 使"NOP 掉校验分支"的补丁无法让功能恢复（校验状态维护在 Integrity.h）
    if (!integrity::isBlessed()) {
        return 0;
    }
    auto* ctx = new NativeContext();
    env->GetJavaVM(&ctx->javaVM);
    ctx->pluginRef = env->NewGlobalRef(thiz);

    // 缓存 JNI 方法 ID
    jclass clazz = env->GetObjectClass(thiz);
    ctx->onProgressMethod = env->GetMethodID(clazz, "onProgress", "(II)V");
    ctx->onErrorMethod = env->GetMethodID(clazz, "onError", "(Ljava/lang/String;)V");
    ctx->onCompleteMethod = env->GetMethodID(clazz, "onComplete", "(Ljava/lang/String;)V");
    ctx->onEncodingProgressMethod = env->GetMethodID(clazz, "onEncodingProgress", "(II)V");

    ctx->frameServer = std::make_unique<FrameServer>(8765);
    ctx->encoder = std::make_unique<MediaCodecEncoder>();

    LOGI("NativeContext 已创建");
    JNI_SAFE_END(reinterpret_cast<jlong>(ctx))
}

void orp_nativeDestroy(JNIEnv* env, jobject thiz, jlong handle) {
    JNI_SAFE_BEGIN_VOID(env)
    auto* ctx = getNativeContext(handle);
    if (ctx) {
        LOGI("NativeContext 正在销毁");
        delete ctx;
    }
    JNI_SAFE_END_VOID
}

jboolean orp_nativeStartServer(JNIEnv* env, jobject thiz, jlong handle, jint port) {
    JNI_SAFE_BEGIN(env, JNI_FALSE)
    auto* ctx = getNativeContext(handle);
    if (!ctx || !ctx->frameServer) return JNI_FALSE;

    // 设置二进制消息回调
    ctx->frameServer->setOnBinaryMessage([ctx](int frameIndex, const uint8_t* data, size_t size) {
        // finalize 已开始后拒绝新帧（FrameQueue::submit 内部也会在 eof_ 后拒绝）
        if (ctx->frameQueue && !ctx->finalizing_.load()) {
            std::vector<uint8_t> frameData(data, data + size);
            ctx->frameQueue->submit(frameIndex, std::move(frameData));
        }
    });

    // 设置控制消息回调
    ctx->frameServer->setOnControlMessage([ctx](const std::string& message) -> std::string {
        // 解析 JSON 控制命令
        // 简单解析：查找 type 字段
        std::string type;
        size_t typePos = message.find("\"type\"");
        if (typePos != std::string::npos) {
            size_t colonPos = message.find(':', typePos);
            size_t startQuote = message.find('"', colonPos + 1);
            size_t endQuote = message.find('"', startQuote + 1);
            if (startQuote != std::string::npos && endQuote != std::string::npos) {
                type = message.substr(startQuote + 1, endQuote - startQuote - 1);
            }
        }

        // 提取 requestId（用于回显，使 JS 端的 Promise 能够 resolve）
        std::string requestId;
        size_t ridPos = message.find("\"requestId\"");
        if (ridPos != std::string::npos) {
            size_t colon = message.find(':', ridPos);
            size_t comma = message.find_first_of(",}", colon + 1);
            if (colon != std::string::npos && comma != std::string::npos) {
                requestId = message.substr(colon + 1, comma - colon - 1);
                // 去除空白
                size_t start = requestId.find_first_not_of(" \t");
                size_t end = requestId.find_last_not_of(" \t");
                if (start != std::string::npos && end != std::string::npos) {
                    requestId = requestId.substr(start, end - start + 1);
                }
            }
        }

        // 辅助：在 JSON 响应中插入 requestId
        auto withRequestId = [&](const std::string& json) -> std::string {
            if (requestId.empty()) return json;
            // 在闭合的 } 前插入 "requestId":<id>,
            size_t brace = json.rfind('}');
            if (brace == std::string::npos) return json;
            return json.substr(0, brace) + ",\"requestId\":" + requestId + "}";
        };

        if (type == "createSession") {
            // finalize 进行中拒绝新会话（避免与 finalize 线程并发操作编码器/队列）
            if (ctx->finalizing_.load()) {
                return withRequestId("{\"type\":\"createSession\",\"success\":false,\"error\":\"finalize in progress\"}");
            }
            // 复位上次会话的清理标志和取消请求，允许本次会话结束时 doCleanup 正常执行
            ctx->cleanupDone_.store(false);
            ctx->cancelRequested_.store(false);

            // 解析参数
            int width = 1920, height = 1080, frameRate = 30, bitrate = 6, frameCount = 0;
            std::string outputPath;

            auto parseInt = [&](const std::string& key) -> int {
                size_t pos = message.find("\"" + key + "\"");
                if (pos == std::string::npos) return 0;
                size_t colon = message.find(':', pos);
                size_t comma = message.find_first_of(",}", colon);
                if (colon != std::string::npos && comma != std::string::npos) {
                    // 捕获 std::stoi 异常：畸形 JSON（空串/非数字/溢出）会抛
                    // std::invalid_argument 或 std::out_of_range，未捕获将导致
                    // native 进程 std::terminate 崩溃。
                    try {
                        return std::stoi(message.substr(colon + 1, comma - colon - 1));
                    } catch (const std::exception&) {
                        LOGW("parseInt 解析失败: key=%s", key.c_str());
                        return 0;
                    }
                }
                return 0;
            };

            auto parseString = [&](const std::string& key) -> std::string {
                size_t pos = message.find("\"" + key + "\"");
                if (pos == std::string::npos) return "";
                size_t colon = message.find(':', pos);
                size_t startQuote = message.find('"', colon);
                size_t endQuote = message.find('"', startQuote + 1);
                if (startQuote != std::string::npos && endQuote != std::string::npos) {
                    return message.substr(startQuote + 1, endQuote - startQuote - 1);
                }
                return "";
            };

            width = parseInt("width");
            height = parseInt("height");
            frameRate = parseInt("frameRate");
            bitrate = parseInt("bitrate");
            frameCount = parseInt("frameCount");
            outputPath = parseString("outputPath");
            std::string forceColorFormat = parseString("forceColorFormat");
            std::string audioPath = parseString("audioPath");
            std::string pixelFormat = parseString("pixelFormat"); // "nv12" | "nv12a"
            bool skipAudio = parseInt("skipAudio") != 0;

            if (width <= 0) width = 1920;
            if (height <= 0) height = 1080;
            if (frameRate <= 0) frameRate = 30;
            if (bitrate <= 0) bitrate = 6;
            if (outputPath.empty()) outputPath = "/storage/emulated/0/MikuPlay/output.mp4";
            if (forceColorFormat.empty()) forceColorFormat = "auto";
            if (pixelFormat.empty()) pixelFormat = "nv12";

            // 透明模式 = pixelFormat == "nv12a"
            bool transparent = (pixelFormat == "nv12a");
            // 帧输出模式 = pixelFormat == "rgba"
            bool frameOutput = (pixelFormat == "rgba");
            if (transparent) skipAudio = true; // 透明模式强制无声，后续 VP9 合成
            if (frameOutput) skipAudio = true;  // 帧输出模式：仅单张 PNG 图像，无需音频

            ctx->frameOutputMode = frameOutput;
            ctx->outputPath = outputPath;
            ctx->finalOutputPath = outputPath;  // 默认交付 mp4
            ctx->audioPath = skipAudio ? "" : audioPath;
            ctx->totalFrames.store(frameCount);
            ctx->encodedFrames.store(0);
            ctx->sessionStartTime = std::chrono::steady_clock::now();
            ctx->sessionWidth = width;
            ctx->sessionHeight = height;
            ctx->sessionFrameRate = frameRate;
            ctx->transparentMode = transparent;

            // 透明模式：创建 Alpha 帧写入器
            if (transparent) {
                ctx->alphaWriter = std::make_unique<AlphaFrameWriter>();
                if (!ctx->alphaWriter->init(outputPath, width, height)) {
                    ctx->notifyError("Alpha 帧目录初始化失败");
                    return withRequestId("{\"type\":\"createSession\",\"success\":false,\"error\":\"AlphaFrameWriter init failed\"}");
                }
                // 生成最终 WebM 输出路径：与 mp4 同目录，命名"透明背景测试YYMMDDHHSS.webm"
                time_t t = time(nullptr);
                struct tm* lt = localtime(&t);
                char stamp[32];
                strftime(stamp, sizeof(stamp), "%y%m%d%H%M%S", lt);
                // 父目录
                size_t lastSlash = outputPath.find_last_of("/\\");
                std::string dir = (lastSlash == std::string::npos) ? "/storage/emulated/0/MikuPlay" : outputPath.substr(0, lastSlash);
                ctx->finalOutputPath = dir + "/透明背景测试" + stamp + ".webm";
                LOGI("透明模式：Alpha 目录=%s 最终合成WebM输出=%s",
                     ctx->alphaWriter->alphaDir().c_str(), ctx->finalOutputPath.c_str());
            }

            // 帧输出模式：创建 PNG 编码器，输出为单张 PNG 图像
            // 输出路径替换为 png 文件（若未显式指定扩展名）
            if (frameOutput) {
                std::string pngPath = outputPath;
                size_t dotPos = pngPath.find_last_of('.');
                size_t lastSlash = pngPath.find_last_of("/\\");
                // 仅替换 basename 中的扩展名
                if (dotPos != std::string::npos && (lastSlash == std::string::npos || dotPos > lastSlash)) {
                    pngPath = pngPath.substr(0, dotPos) + ".png";
                } else {
                    pngPath = pngPath + ".png";
                }
                ctx->outputPath = pngPath;
                ctx->finalOutputPath = pngPath;

                PNGEncoder::Config pngConfig;
                pngConfig.width = width;
                pngConfig.height = height;
                pngConfig.outputPath = pngPath;
                ctx->pngEncoder = std::make_unique<PNGEncoder>();
                ctx->pngEncoder->setConfig(pngConfig);
                ctx->pngEncoder->setErrorCallback([ctx](const std::string& msg) {
                    ctx->notifyError(msg);
                });
                ctx->pngEncoder->setCompleteCallback([ctx](const std::string& path) {
                    ctx->notifyComplete(path);
                });

                LOGI("帧输出模式：PNG 编码器已配置 %dx%d → %s", width, height, pngPath.c_str());
            }

            // 配置 MediaCodec 视频编码器（仅在非帧输出模式下）
            if (!frameOutput) {
                MediaCodecEncoder::Config config;
                config.width = width;
                config.height = height;
                config.frameRate = frameRate;
                config.bitrateMbps = bitrate;
                config.totalFrames = frameCount;
                config.outputPath = outputPath;
                config.forceColorFormat = forceColorFormat;
                config.pixelFormat = pixelFormat;
                config.skipAudio = skipAudio;

                if (!ctx->encoder->configure(config)) {
                    ctx->notifyError("编码器配置失败");
                    return withRequestId("{\"type\":\"createSession\",\"success\":false,\"error\":\"Encoder configure failed\"}");
                }
            }

            // 配置音频编码器（如果有音频且不跳过）
            if (!skipAudio && !audioPath.empty()) {
                ctx->audioEncoder = std::make_unique<AudioEncoder>();
                AudioEncoder::Config audioConfig;
                audioConfig.audioPath = audioPath;
                audioConfig.bitrate = 128000;
                audioConfig.maxDurationUs = (int64_t)frameCount * 1000000LL / frameRate;
                // 帧范围渲染：音频起点偏移（缺省 0 = 从头混流，向后兼容旧前端）
                audioConfig.startOffsetUs = (int64_t)parseInt("audioStartUs");

                ctx->audioEncoder->setErrorCallback([ctx](const std::string& msg) {
                    ctx->notifyError("音频警告: " + msg);
                });

                if (!ctx->audioEncoder->configure(audioConfig)) {
                    LOGW("音频配置失败，将输出无声视频: %s", audioPath.c_str());
                    ctx->audioEncoder.reset();
                    ctx->audioPath.clear();
                } else {
                    LOGI("音频编码器已配置: %s", audioPath.c_str());
                }
            } else if (skipAudio) {
                LOGI("音频跳过（skipAudio=true，透明/帧输出模式）");
            }

            // 解析队列长度（JS 端根据分辨率计算），作为信用窗口大小
            int queueSize = parseInt("queueSize");
            if (queueSize <= 0) queueSize = 6;
            if (queueSize > 30) queueSize = 30;

            // 创建帧队列（信用窗口 FIFO）
            ctx->frameQueue = std::make_unique<FrameQueue>(
                queueSize,
                [ctx, transparent, frameOutput](int frameIndex, const uint8_t* data, size_t size) -> bool {
                    // 帧输出模式：使用 PNG 编码器直接将 RGBA 数据编码为 PNG
                    if (frameOutput) {
                        if (ctx->pngEncoder) {
                            bool success = ctx->pngEncoder->encode(data, size);
                            if (success) {
                                int encoded = ctx->encodedFrames.fetch_add(1) + 1;
                                int total = ctx->totalFrames.load();
                                if (encoded % 3 == 0 || encoded == total) {
                                    ctx->notifyProgress(encoded, total);
                                }
                            }
                            return success;
                        }
                        return false;
                    }
                    // NV12A 模式：先写入 Alpha（后半段 W×H 字节），再把帧交给 MediaCodec
                    if (transparent && ctx->alphaWriter) {
                        ctx->alphaWriter->writeFrame(frameIndex, data, size);
                    }
                    bool success = ctx->encoder->submitFrame(frameIndex, data, size);
                    if (success) {
                        int encoded = ctx->encodedFrames.fetch_add(1) + 1;
                        int total = ctx->totalFrames.load();

                        if (encoded % 3 == 0 || encoded == total) {
                            ctx->notifyProgress(encoded, total);
                        }
                    }
                    return success;
                },
                // 累积 ACK：编码器每消费一帧即释放一个信用
                [ctx](int frameIndex) {
                    if (ctx->frameServer) {
                        ctx->frameServer->sendAck(frameIndex);
                    }
                },
                // 看门狗错误
                [ctx](const std::string& msg) {
                    ctx->notifyError(msg);
                    if (ctx->frameServer) {
                        ctx->frameServer->closeConnection();
                    }
                }
            );

            // 设置编码器回调（仅非帧输出模式下需要）
            if (!frameOutput) {
                ctx->encoder->setErrorCallback([ctx](const std::string& msg) {
                    ctx->notifyError(msg);
                });

                ctx->encoder->setCompleteCallback([ctx](const std::string& path) {
                    ctx->notifyComplete(path);
                });

                // 在 Muxer start 前添加音频轨（必须在 start 之前，否则 addTrack 被拒绝）
                ctx->encoder->setPreMuxerStartCallback([ctx](AMediaMuxer* muxer) {
                    if (ctx->audioEncoder && ctx->audioEncoder->hasAudio()) {
                        if (!ctx->audioEncoder->addTrackToMuxer(muxer)) {
                            LOGW("音频轨添加失败，将输出无声视频");
                            ctx->audioEncoder.reset();
                            ctx->audioPath.clear();
                        }
                    }
                });
            }

            LOGI("会话已创建: %dx%d @%dfps, %dMbps, %d 帧, 模式: %s",
                width, height, frameRate, bitrate, frameCount,
                frameOutput ? "FrameOutput(PNG)" : (transparent ? "NV12A" : "NV12"));

            return withRequestId("{\"type\":\"createSession\",\"success\":true,\"outputPath\":\"" + ctx->finalOutputPath + "\"}");
        }
        else if (type == "finalize") {
            // 防重入：finalize 进行中拒绝重复命令
            if (ctx->finalizing_.exchange(true)) {
                return withRequestId("{\"type\":\"finalize\",\"success\":false,\"error\":\"finalize already in progress\"}");
            }
            if (!ctx->frameQueue) {
                ctx->finalizing_.store(false);
                return withRequestId("{\"type\":\"finalize\",\"success\":false,\"error\":\"no active session\"}");
            }

            // 重活移交 FrameQueue writer 线程（排空完成后执行），uWS 线程仅置 EOF 后立即返回。
            // 前端 sendCommand('finalize') 的 promise 挂起，待 finalize 完成后由
            // sendFinalizeResponse 补发响应（携带 requestId）resolve。返回空串表示不在此处响应。
            ctx->frameQueue->setFinalizeCallback([ctx, requestId]() {
                struct FinalizeGuard {
                    NativeContext* c;
                    ~FinalizeGuard() { c->finalizing_.store(false); }
                } guard{ctx};

                if (ctx->frameOutputMode) {
                    // 帧输出模式：PNG 编码已在 ConsumeCallback 中同步完成，Writer 线程仅需做收尾
                    LOGI("帧输出模式：PNG 编码会话完成，输出: %s", ctx->finalOutputPath.c_str());
                    if (!ctx->cancelRequested_.load()) {
                        ctx->sessionCompleted_.store(true);
                        // notifyComplete 已由 PNGEncoder 的 CompleteCallback 发送，
                        // 此处仅补发 finalize 响应
                    } else {
                        LOGI("帧输出模式：会话已取消");
                    }
                } else {
                    // 1. 排空视频编码器剩余输出
                    if (ctx->encoder) ctx->encoder->finalize();

                    // 2. 音频编码（透明模式下 skipAudio，audioEncoder 为空直接跳过）
                    AMediaMuxer* muxer = ctx->encoder ? ctx->encoder->getMuxer() : nullptr;
                    if (ctx->audioEncoder && muxer && !ctx->cancelRequested_.load()) {
                        LOGI("开始音频编码...");
                        bool audioOk = ctx->audioEncoder->encodeAll(muxer);
                        if (!audioOk) {
                            LOGW("音频编码失败，输出无声视频");
                        }
                        ctx->audioEncoder->release();
                        ctx->audioEncoder.reset();
                    }

                    // 3. 停止 Muxer（视频+音频 MP4 完成）
                    if (ctx->encoder) ctx->encoder->stopMuxer();

                    // 4. 透明模式：VP9 合成 (NV12A raw → WebM 含 alpha)
                    if (ctx->transparentMode && ctx->alphaWriter && !ctx->cancelRequested_.load()) {
                        LOGI("透明模式：开始 VP9 合成 NV12A raw → WebM");
                        if (!ctx->alphaEncoder) {
                            ctx->alphaEncoder = std::make_unique<AlphaEncoder>();
                        }
                        // 设置 VP9 合成进度回调（每 30 帧通知一次）
                        ctx->alphaEncoder->setProgressCallback([ctx](int current, int total) {
                            ctx->notifyEncodingProgress(current, total);
                        });
                        bool vp9Ok = ctx->alphaEncoder->encodeToIVF(
                            ctx->alphaWriter->alphaDir(),
                            ctx->finalOutputPath,
                            ctx->sessionWidth,
                            ctx->sessionHeight,
                            ctx->sessionFrameRate);
                        if (!vp9Ok) {
                            LOGE("VP9 合成失败，通知前端错误；但 mp4 仍然保留");
                            ctx->notifyError("透明视频 VP9 合成失败，已生成无声 MP4");
                            // 透明模式但合成失败：最终交付路径回退为 mp4
                            ctx->finalOutputPath = ctx->outputPath;
                        } else {
                            LOGI("VP9 合成完成，最终交付路径: %s", ctx->finalOutputPath.c_str());
                        }

                        // 无论成功或失败，清理帧目录（删除中间 raw 文件）
                        const std::string& frameDir = ctx->alphaWriter->alphaDir();
                        if (!frameDir.empty()) {
                            LOGI("清理帧目录: %s", frameDir.c_str());
                            AlphaFrameWriter::removeDirectory(frameDir);
                        }
                    }

                    // 5. 通知完成（透明模式用 finalOutputPath）
                    if (!ctx->cancelRequested_.load()) {
                        ctx->sessionCompleted_.store(true);
                        ctx->notifyComplete(ctx->finalOutputPath);
                        LOGI("会话已完成，输出: %s", ctx->finalOutputPath.c_str());
                    } else {
                        LOGI("会话已取消，输出文件将清理");
                    }
                }

                // 6. 补发 finalize 响应
                std::string resp = "{\"type\":\"finalize\",\"success\":true,\"outputPath\":\"" + ctx->finalOutputPath + "\"";
                if (!requestId.empty()) resp += ",\"requestId\":" + requestId;
                resp += "}";
                if (ctx->frameServer) {
                    ctx->frameServer->sendFinalizeResponse(resp);
                }
            });
            ctx->frameQueue->setEOF();
            return "";
        }
        else if (type == "cleanup") {
            // finalize 进行中拒绝清理（避免与 finalize 线程并发释放资源）
            if (ctx->finalizing_.load()) {
                return withRequestId("{\"type\":\"cleanup\",\"success\":false,\"error\":\"finalize in progress\"}");
            }
            // 幂等清理：若 nativeStopServer 已先执行，此处 no-op
            ctx->doCleanup();
            // cleanup 后为下一次会话准备新的 encoder
            if (!ctx->encoder) {
                ctx->encoder = std::make_unique<MediaCodecEncoder>();
                LOGI("cleanup: 已创建新的空 encoder 供下次会话复用");
            }
            return withRequestId("{\"type\":\"cleanup\",\"success\":true}");
        }
        else if (type == "status") {
            int pending = ctx->frameQueue ? ctx->frameQueue->pendingCount() : 0;
            return withRequestId("{\"type\":\"status\",\"pending\":" + std::to_string(pending) +
                   ",\"encoded\":" + std::to_string(ctx->encodedFrames.load()) +
                   ",\"total\":" + std::to_string(ctx->totalFrames.load()) + "}");
        }

        return withRequestId("{\"type\":\"error\",\"error\":\"Unknown command: " + type + "\"}");
    });

    // 设置关闭回调
    ctx->frameServer->setOnClose([ctx]() {
        // 仅关闭帧队列，完整清理由 doCleanup() 负责（cleanup 处理器 / nativeStopServer）
        if (ctx->frameQueue) {
            ctx->frameQueue->shutdown();
            ctx->frameQueue.reset();
        }
    });

    bool success = ctx->frameServer->start();
    LOGI("FrameServer 启动%s", success ? "成功" : "失败");
    JNI_SAFE_END(success ? JNI_TRUE : JNI_FALSE)
}

void orp_nativeStopServer(JNIEnv* env, jobject thiz, jlong handle) {
    JNI_SAFE_BEGIN_VOID(env)
    auto* ctx = getNativeContext(handle);
    if (!ctx) return;

    ctx->requestCancel();   // 停止时请求取消（若 finalize 正在进行则让其快速退出）
    ctx->doCleanup();       // 幂等清理会话资源（frameServer 保持运行，跨会话复用）
    // 为下次会话准备新 encoder（若 cleanup 命令处理器已先执行则 encoder 非空，此处 no-op；
    // 若 nativeStopServer 先于 cleanup 被调用，此处保证 encoder 不为 nullptr，避免下次 createSession 空指针崩溃）
    if (!ctx->encoder) {
        ctx->encoder = std::make_unique<MediaCodecEncoder>();
        LOGI("nativeStopServer: 已重建空 encoder 供下次会话复用");
    }

    LOGI("会话资源已清理（frameServer 保持运行）");
    JNI_SAFE_END_VOID
}

} // extern "C"
