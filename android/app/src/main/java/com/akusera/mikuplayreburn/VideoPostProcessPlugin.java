package com.akusera.mikuplayreburn;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaScannerConnection;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * VideoPostProcess 插件 — 实时渲染录屏后处理（纯 Java 实现）
 *
 * 职责：
 *   1. 视频轨 PTS 缩放（慢放视频倍速到正常速度，不重编码）
 *   2. 音频原速率 AAC 合成（WAV 手动解析 / 压缩格式 MediaCodec 解码）
 *   3. 处理期间显示阻止触摸的进度界面（转圈 + "正在处理视频…"）
 *
 * 为什么不用 C++ AMediaExtractor：
 *   AMediaExtractor_setDataSource(path) 把本地路径当 URI 解析，
 *   对含中文的路径返回 -10002 (AMEDIA_ERROR_CANNOT_CONNECT)。
 *   Java MediaExtractor.setDataSource(String) 走 FileDataSource，对本地路径稳定。
 *
 * 为什么 WAV 要特殊处理：
 *   MediaExtractor 对 WAV 返回 mime="audio/raw"，MediaCodec 没有对应解码器。
 *   WAV 本身就是 PCM，直接读取 data chunk 喂给 AAC 编码器即可。
 *   支持 PCM 16/24/32bit 与 IEEE float 32bit（后三者转换到 16bit 再编码）。
 */
@CapacitorPlugin(name = "VideoPostProcess")
public class VideoPostProcessPlugin extends Plugin {
    private static final String TAG = "VideoPostProcessPlugin";

    private static final int AAC_BITRATE = 128000;
    private static final int VIDEO_BUFFER_SIZE = 2 * 1024 * 1024; // 2 MiB
    private static final int PCM_READ_BLOCK = 64 * 1024;          // 64 KiB per read

    // WAV AudioFormat 常量
    private static final int WAVE_FORMAT_PCM = 0x0001;
    private static final int WAVE_FORMAT_IEEE_FLOAT = 0x0003;
    private static final int WAVE_FORMAT_EXTENSIBLE = 0xFFFE;

    private Dialog progressDialog = null;

    @PluginMethod
    public void process(PluginCall call) {
        final String srcPath = call.getString("srcPath");
        final String audioPath = call.getString("audioPath");
        final String outputPath = call.getString("outputPath");
        final Double speedObj = call.getDouble("speed");
        final double speed = (speedObj != null && speedObj > 0) ? speedObj : 1.0;

        if (srcPath == null || srcPath.isEmpty() || outputPath == null || outputPath.isEmpty()) {
            call.reject("srcPath/outputPath 不能为空");
            return;
        }

        Log.i(TAG, "后处理开始: src=" + srcPath + " audio=" + audioPath
                + " output=" + outputPath + " speed=" + speed);

        // 处理期间显示阻止触摸的进度界面
        showProgressDialog();

        new Thread(() -> {
            String error = doProcess(srcPath, audioPath, outputPath, speed);
            new Handler(Looper.getMainLooper()).post(() -> {
                // 处理完成，隐藏进度界面
                hideProgressDialog();
                if (error == null) {
                    scanMediaFile(outputPath);
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("outputPath", outputPath);
                    call.resolve(ret);
                } else {
                    call.reject(error);
                }
            });
        }, "video-post-process").start();
    }

    /**
     * 后处理主流程
     * @param speed 倍速因子（1=原速，2=2倍速）。视频 PTS ÷ speed 实现倍速。
     * @return null 表示成功；非空字符串为错误消息
     */
    private String doProcess(String srcPath, String audioPath, String outputPath, double speed) {
        MediaExtractor videoExtractor = null;
        MediaMuxer muxer = null;

        try {
            // ── 1. 打开源视频，找视频轨 ──
            videoExtractor = new MediaExtractor();
            videoExtractor.setDataSource(srcPath);

            int videoTrack = -1;
            MediaFormat videoFormat = null;
            for (int i = 0; i < videoExtractor.getTrackCount(); i++) {
                MediaFormat fmt = videoExtractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("video/")) {
                    videoTrack = i;
                    videoFormat = fmt;
                    break;
                }
            }
            if (videoTrack < 0 || videoFormat == null) {
                return "源视频中未找到视频轨";
            }

            // ── 2. 视频时长（倍速后截断音频用）──
            long videoDurationUs = 0;
            if (videoFormat.containsKey(MediaFormat.KEY_DURATION)) {
                videoDurationUs = videoFormat.getLong(MediaFormat.KEY_DURATION);
            }
            // 倍速后视频时长 = 原时长 / speed
            long scaledDurationUs = (long) (videoDurationUs / speed);

            // ── 3. 配置音频（在 addTrack 之前，避免空音频轨导致文件损坏）──
            AudioConfig audioConfig = null;
            if (audioPath != null && !audioPath.isEmpty()) {
                audioConfig = configureAudio(audioPath);
                if (audioConfig == null) {
                    Log.w(TAG, "音频配置失败，将输出无声视频");
                }
            }

            // ── 4. 创建 muxer 并 addTrack ──
            muxer = new MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int outVideoTrack = muxer.addTrack(videoFormat);
            int outAudioTrack = -1;
            if (audioConfig != null) {
                outAudioTrack = muxer.addTrack(audioConfig.aacFormat);
                Log.i(TAG, "音频轨已添加: " + audioConfig.sampleRate + "Hz "
                        + audioConfig.channelCount + "ch");
            }
            muxer.start();

            // ── 5. 视频轨 remux（PTS ÷ speed 实现倍速）──
            videoExtractor.selectTrack(videoTrack);
            ByteBuffer videoBuffer = ByteBuffer.allocateDirect(VIDEO_BUFFER_SIZE);
            MediaCodec.BufferInfo videoInfo = new MediaCodec.BufferInfo();
            while (true) {
                int sampleSize = videoExtractor.readSampleData(videoBuffer, 0);
                if (sampleSize < 0) break;

                int flags = videoExtractor.getSampleFlags();
                if ((flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) {
                    videoExtractor.advance();
                    continue;
                }

                videoInfo.offset = 0;
                videoInfo.size = sampleSize;
                // PTS 缩放实现倍速：慢放视频每帧间隔大，÷speed 压缩到正常间隔
                long originalPts = videoExtractor.getSampleTime();
                videoInfo.presentationTimeUs = (long) (originalPts / speed);
                videoInfo.flags = flags;
                muxer.writeSampleData(outVideoTrack, videoBuffer, videoInfo);

                videoExtractor.advance();
            }
            Log.i(TAG, "视频轨 remux 完成 (speed=" + speed + ")");

            // ── 6. 音频编码 ──
            if (outAudioTrack >= 0 && audioConfig != null) {
                boolean ok;
                if (audioConfig.isWav) {
                    ok = encodeAudioFromWav(muxer, outAudioTrack, audioConfig, scaledDurationUs);
                } else {
                    ok = encodeAudioFromCompressed(muxer, outAudioTrack, audioConfig, scaledDurationUs);
                }
                if (!ok) {
                    Log.w(TAG, "音频编码失败，输出无声视频");
                }
            }

            // ── 7. 封口 ──
            muxer.stop();
            Log.i(TAG, "后处理完成: " + outputPath);
            return null;

        } catch (Exception e) {
            Log.e(TAG, "后处理异常: " + e.getMessage(), e);
            return e.getMessage() != null ? e.getMessage() : "后处理异常";
        } finally {
            if (videoExtractor != null) {
                try { videoExtractor.release(); } catch (Exception e) { /* ignore */ }
            }
            if (muxer != null) {
                try { muxer.release(); } catch (Exception e) { /* ignore */ }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  音频配置
    // ══════════════════════════════════════════════════════════════

    private static class AudioConfig {
        String audioPath;
        int sampleRate;
        int channelCount;
        MediaFormat aacFormat;
        boolean isWav;
        // WAV 专用
        long wavDataOffset;
        long wavDataLength;
        int wavAudioFormat;    // 1=PCM, 3=IEEE float
        int wavBitsPerSample;  // 16/24/32
    }

    /**
     * 配置音频：打开文件、获取格式、预构造 AAC format
     * @return 配置成功返回 AudioConfig，失败返回 null
     */
    private AudioConfig configureAudio(String audioPath) {
        boolean isWav = audioPath.toLowerCase().endsWith(".wav");
        if (isWav) {
            return configureWav(audioPath);
        } else {
            return configureCompressed(audioPath);
        }
    }

    /**
     * 配置 WAV：手动解析 WAV 头，获取格式信息 + PCM data chunk 位置。
     * 严格对齐 C++ AudioEncoder::configureFromWav 实现：
     *   - 逐个字段读取 fmt chunk（非一次性读取整个 chunk）
     *   - 文件大小校验、dataSize 截断、PCM 512MB 上限
     * 保留扩展：PCM 16/24/32bit、IEEE float 32bit、WAVE_FORMAT_EXTENSIBLE。
     */
    private AudioConfig configureWav(String audioPath) {
        RandomAccessFile file = null;
        try {
            Log.d(TAG, "configureWav 尝试打开: " + audioPath);
            file = new RandomAccessFile(audioPath, "r");

            // 获取文件实际大小，用于校验 data chunk 声明长度
            long fileSize = file.length();
            Log.i(TAG, "configureWav 打开成功，文件长度=" + fileSize + " 字节");
            if (fileSize <= 0) {
                Log.e(TAG, "WAV 文件大小无效");
                return null;
            }

            // RIFF header
            byte[] riff = new byte[4];
            if (readFully(file, riff) != 4
                    || riff[0] != 'R' || riff[1] != 'I' || riff[2] != 'F' || riff[3] != 'F') {
                Log.e(TAG, "不是有效的 RIFF 文件");
                return null;
            }
            if (file.skipBytes(4) != 4) {
                Log.e(TAG, "WAV 文件头不完整（跳过 RIFF size 失败）");
                return null;
            }
            byte[] wave = new byte[4];
            if (readFully(file, wave) != 4
                    || wave[0] != 'W' || wave[1] != 'A' || wave[2] != 'V' || wave[3] != 'E') {
                Log.e(TAG, "不是有效的 WAVE 文件");
                return null;
            }

            boolean fmtFound = false, dataFound = false;
            long dataSize = 0;
            int sampleRate = 0, channelCount = 0, bitsPerSample = 0, audioFormat = 0;

            // 遍历 chunks —— 逐行对齐 C++ AudioEncoder.configureFromWav
            while (!dataFound) {
                byte[] chunkId = new byte[4];
                if (readFully(file, chunkId) != 4) break;
                long chunkSize = readLittleEndianInt(file);
                if (chunkSize < 0) break;

                boolean isFmt = chunkId[0] == 'f' && chunkId[1] == 'm'
                        && chunkId[2] == 't' && chunkId[3] == ' ';
                boolean isData = chunkId[0] == 'd' && chunkId[1] == 'a'
                        && chunkId[2] == 't' && chunkId[3] == 'a';

                if (isFmt && !fmtFound) {
                    // 逐个字段读取，与 C++ 一致（避免 chunkSize 与实体不一致导致错位）
                    audioFormat = readLittleEndianShort(file);
                    if (audioFormat < 0) break;
                    channelCount = readLittleEndianShort(file);
                    if (channelCount < 0) break;
                    sampleRate = (int) readLittleEndianInt(file);
                    if (sampleRate < 0) break;
                    if (file.skipBytes(4) != 4) break; // byteRate
                    if (file.skipBytes(2) != 2) break; // blockAlign
                    bitsPerSample = readLittleEndianShort(file);
                    if (bitsPerSample < 0) break;

                    // WAVE_FORMAT_EXTENSIBLE：SubFormat 在 GUID 前 4 字节（低 16 位）
                    if (audioFormat == WAVE_FORMAT_EXTENSIBLE && chunkSize >= 26) {
                        long currentPos = file.getFilePointer();
                        if (currentPos - 16 + 26 <= fileSize) {
                            file.seek(currentPos - 16 + 24);
                            int subFormat = readLittleEndianShort(file);
                            if (subFormat >= 0) {
                                audioFormat = subFormat;
                                Log.i(TAG, "WAVE_FORMAT_EXTENSIBLE, SubFormat=" + subFormat);
                            }
                            file.seek(currentPos);
                        }
                    }

                    // 格式校验
                    if (audioFormat != WAVE_FORMAT_PCM && audioFormat != WAVE_FORMAT_IEEE_FLOAT) {
                        Log.e(TAG, "不支持的 WAV 格式: " + audioFormat + " (仅支持 PCM/float)");
                        return null;
                    }
                    if (audioFormat == WAVE_FORMAT_PCM
                            && bitsPerSample != 16 && bitsPerSample != 24 && bitsPerSample != 32) {
                        Log.e(TAG, "不支持的 WAV 位深: " + bitsPerSample + " (PCM 仅支持 16/24/32)");
                        return null;
                    }
                    if (audioFormat == WAVE_FORMAT_IEEE_FLOAT && bitsPerSample != 32) {
                        Log.e(TAG, "不支持的 float WAV 位深: " + bitsPerSample + " (仅支持 32bit float)");
                        return null;
                    }

                    // 参数合法性校验（对齐 C++：仅 8k-96kHz / 1-2ch / 16bit 通过）
                    // 保留 24/32bit 扩展，但采样率和声道数严格按 C++ 校验
                    if (sampleRate < 8000 || sampleRate > 96000
                            || channelCount < 1 || channelCount > 2) {
                        Log.e(TAG, "WAV 参数非法: " + sampleRate + "Hz " + channelCount
                                + "ch " + bitsPerSample + "bit (仅支持 8k-96kHz/1-2ch)");
                        return null;
                    }

                    fmtFound = true;
                    Log.i(TAG, "WAV fmt: " + sampleRate + "Hz " + channelCount + "ch "
                            + bitsPerSample + "bit format=" + audioFormat);

                    long extra = chunkSize - 16;
                    if (extra > 0) {
                        file.seek(file.getFilePointer() + extra);
                    }
                } else if (isData) {
                    dataSize = chunkSize;
                    dataFound = true;
                } else {
                    // 与 C++ 一致：跳过 chunkSize 字节
                    Log.d(TAG, "跳过未知 chunk: " + new String(chunkId, 0, 4, "US-ASCII")
                            + " size=" + chunkSize);
                    file.seek(file.getFilePointer() + chunkSize);
                }
            }

            if (!fmtFound || !dataFound) {
                Log.e(TAG, "WAV 文件缺少 fmt 或 data chunk: fmtFound=" + fmtFound
                        + " dataFound=" + dataFound);
                return null;
            }

            // dataSize 不得超过文件实际剩余字节（防恶意/损坏文件头声明超大长度）
            long dataOffset = file.getFilePointer();
            long remaining = fileSize - dataOffset;
            if (remaining < 0) remaining = 0;
            if (dataSize > remaining) {
                Log.w(TAG, "WAV dataSize(" + dataSize + ") 超过文件剩余字节(" + remaining + ")，按实际截断");
                dataSize = remaining;
            }
            // 总内存上限：约 1.5 小时立体声 16bit@44.1kHz；超限拒绝并降级为无声视频
            final long MAX_PCM_BYTES = 512L * 1024 * 1024;
            if (dataSize > MAX_PCM_BYTES) {
                Log.e(TAG, "WAV PCM 过大(" + dataSize + " > " + MAX_PCM_BYTES + ")，拒绝");
                return null;
            }

            MediaFormat aacFormat = buildAacFormat(sampleRate, channelCount);
            if (aacFormat == null) return null;

            AudioConfig config = new AudioConfig();
            config.audioPath = audioPath;
            config.sampleRate = sampleRate;
            config.channelCount = channelCount;
            config.aacFormat = aacFormat;
            config.isWav = true;
            config.wavDataOffset = dataOffset;
            config.wavDataLength = dataSize;
            config.wavAudioFormat = audioFormat;
            config.wavBitsPerSample = bitsPerSample;
            Log.i(TAG, "WAV 配置: " + sampleRate + "Hz " + channelCount + "ch "
                    + bitsPerSample + "bit format=" + audioFormat + ", "
                    + "dataOffset=" + dataOffset + " dataLength=" + dataSize);
            return config;

        } catch (Exception e) {
            Log.e(TAG, "WAV 配置失败: " + e.getMessage(), e);
            return null;
        } finally {
            if (file != null) {
                try { file.close(); } catch (Exception e) { /* ignore */ }
            }
        }
    }

    /**
     * 循环读取直至 buf 填满或 EOF（RandomAccessFile.read 可能短读，须循环保证读满）
     * @return 实际读取字节数
     */
    private int readFully(RandomAccessFile file, byte[] buf) throws Exception {
        int total = 0;
        while (total < buf.length) {
            int n = file.read(buf, total, buf.length - total);
            if (n < 0) break; // EOF
            total += n;
        }
        return total;
    }

    private long readLittleEndianInt(RandomAccessFile file) throws Exception {
        byte[] b = new byte[4];
        if (readFully(file, b) != 4) return -1;
        return ((b[3] & 0xFFL) << 24) | ((b[2] & 0xFFL) << 16)
                | ((b[1] & 0xFFL) << 8) | (b[0] & 0xFFL);
    }

    private int readLittleEndianShort(RandomAccessFile file) throws Exception {
        byte[] b = new byte[2];
        if (readFully(file, b) != 2) return -1;
        return ((b[1] & 0xFF) << 8) | (b[0] & 0xFF);
    }

    /**
     * 配置压缩音频（MP3/AAC 等）：用 MediaExtractor 获取格式信息
     */
    private AudioConfig configureCompressed(String audioPath) {
        MediaExtractor extractor = null;
        try {
            extractor = new MediaExtractor();
            extractor.setDataSource(audioPath);

            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat fmt = extractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    int sampleRate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    int channelCount = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT);

                    MediaFormat aacFormat = buildAacFormat(sampleRate, channelCount);
                    if (aacFormat == null) return null;

                    AudioConfig config = new AudioConfig();
                    config.audioPath = audioPath;
                    config.sampleRate = sampleRate;
                    config.channelCount = channelCount;
                    config.aacFormat = aacFormat;
                    config.isWav = false;
                    Log.i(TAG, "压缩音频配置: " + mime + " " + sampleRate + "Hz " + channelCount + "ch");
                    return config;
                }
            }
            Log.e(TAG, "未找到音频轨: " + audioPath);
            return null;
        } catch (Exception e) {
            Log.e(TAG, "压缩音频配置失败: " + e.getMessage(), e);
            return null;
        } finally {
            if (extractor != null) {
                try { extractor.release(); } catch (Exception e) { /* ignore */ }
            }
        }
    }

    /**
     * 构造含 CSD-0 的 AAC MediaFormat
     * AudioSpecificConfig (2 bytes, AAC-LC):
     *   5 bits: audioObjectType = 2
     *   4 bits: samplingFrequencyIndex
     *   4 bits: channelConfiguration
     *   3 bits: padding
     */
    private MediaFormat buildAacFormat(int sampleRate, int channelCount) {
        int[] freqMap = {
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
            Log.e(TAG, "不支持的采样率: " + sampleRate);
            return null;
        }
        if (channelCount < 1 || channelCount > 2) {
            Log.e(TAG, "不支持的声道数: " + channelCount);
            return null;
        }

        byte[] csd0 = new byte[2];
        csd0[0] = (byte) (((2 & 0x1F) << 3) | ((freqIndex & 0x0E) >> 1));
        csd0[1] = (byte) (((freqIndex & 0x01) << 7) | ((channelCount & 0x0F) << 3));

        MediaFormat fmt = MediaFormat.createAudioFormat(
                MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channelCount);
        fmt.setInteger(MediaFormat.KEY_AAC_PROFILE,
                MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        fmt.setInteger(MediaFormat.KEY_BIT_RATE, AAC_BITRATE);
        fmt.setByteBuffer("csd-0", ByteBuffer.wrap(csd0));
        return fmt;
    }

    // ══════════════════════════════════════════════════════════════
    //  音频编码
    // ══════════════════════════════════════════════════════════════

    /**
     * WAV 音频编码：流式读取 PCM → (24bit/float 转 16bit) → AAC 编码器 → muxer
     */
    private boolean encodeAudioFromWav(MediaMuxer muxer, int outAudioTrack,
                                        AudioConfig config, long maxDurationUs) {
        RandomAccessFile file = null;
        MediaCodec encoder = null;

        try {
            file = new RandomAccessFile(config.audioPath, "r");
            file.seek(config.wavDataOffset);

            // 创建 AAC 编码器
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            encoder.configure(config.aacFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();

            // 源 PCM 每样本字节数（用于 PTS 计算与截断判断）
            int srcBytesPerSample = config.wavAudioFormat == WAVE_FORMAT_IEEE_FLOAT
                    ? config.channelCount * 4
                    : config.channelCount * (config.wavBitsPerSample / 8);

            Log.i(TAG, "WAV 音频编码开始: " + config.sampleRate + "Hz " + config.channelCount + "ch "
                    + config.wavBitsPerSample + "bit format=" + config.wavAudioFormat);

            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            long position = 0;       // 已读取的源 PCM 字节数
            long ptsUs = 0;          // 当前 PCM 块的 PTS（微秒）
            boolean eosSent = false;
            boolean eosReceived = false;

            while (!eosReceived) {
                // 喂 PCM 给编码器
                if (!eosSent) {
                    int inputIdx = encoder.dequeueInputBuffer(10000);
                    if (inputIdx >= 0) {
                        ByteBuffer encBuf = encoder.getInputBuffer(inputIdx);
                        encBuf.clear();

                        int readSize = Math.min(PCM_READ_BLOCK, encBuf.capacity());
                        long remaining = config.wavDataLength - position;
                        if (remaining <= 0) {
                            // PCM 已读完，发送 EOS
                            encoder.queueInputBuffer(inputIdx, 0, 0, ptsUs,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            eosSent = true;
                        } else {
                            // 检查是否超过视频时长（截断）
                            long currentDurationUs = position * 1000000L
                                    / (config.sampleRate * srcBytesPerSample);
                            if (maxDurationUs > 0 && currentDurationUs >= maxDurationUs) {
                                encoder.queueInputBuffer(inputIdx, 0, 0, ptsUs,
                                        MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                eosSent = true;
                            } else {
                                readSize = (int) Math.min(readSize, remaining);
                                // 对齐到完整样本（24bit 等非 2 的幂位深，避免跨样本错位）
                                readSize = (readSize / srcBytesPerSample) * srcBytesPerSample;
                                if (readSize == 0) {
                                    // 剩余不足一个样本（文件尾部 padding），直接结束
                                    encoder.queueInputBuffer(inputIdx, 0, 0, ptsUs,
                                            MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                    eosSent = true;
                                    continue;
                                }
                                byte[] tempBuf = new byte[readSize];
                                file.readFully(tempBuf);

                                // 24bit/float → 16bit PCM（编码器要求 16bit 输入）
                                byte[] pcm16 = tempBuf;
                                if (config.wavAudioFormat == WAVE_FORMAT_IEEE_FLOAT) {
                                    pcm16 = convertFloatTo16(tempBuf);
                                } else if (config.wavBitsPerSample == 24) {
                                    pcm16 = convert24To16(tempBuf);
                                } else if (config.wavBitsPerSample == 32) {
                                    pcm16 = convert32To16(tempBuf);
                                }

                                encBuf.put(pcm16);
                                encoder.queueInputBuffer(inputIdx, 0, pcm16.length, ptsUs, 0);
                                position += tempBuf.length;  // 按源字节推进
                                ptsUs = position * 1000000L
                                        / (config.sampleRate * srcBytesPerSample);
                            }
                        }
                    }
                }

                // 从编码器取 AAC
                int outputIdx = encoder.dequeueOutputBuffer(info, 0);
                if (outputIdx >= 0) {
                    if (info.size > 0
                            && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        ByteBuffer aacBuf = encoder.getOutputBuffer(outputIdx);
                        muxer.writeSampleData(outAudioTrack, aacBuf, info);
                    }
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        eosReceived = true;
                    }
                    encoder.releaseOutputBuffer(outputIdx, false);
                }
            }

            Log.i(TAG, "WAV 音频编码完成");
            return true;

        } catch (Exception e) {
            Log.e(TAG, "WAV 音频编码异常: " + e.getMessage(), e);
            return false;
        } finally {
            if (file != null) {
                try { file.close(); } catch (Exception e) { /* ignore */ }
            }
            if (encoder != null) {
                try { encoder.stop(); } catch (Exception e) { /* ignore */ }
                try { encoder.release(); } catch (Exception e) { /* ignore */ }
            }
        }
    }

    /**
     * 24bit PCM → 16bit PCM（小端，取高 16 位）
     */
    private byte[] convert24To16(byte[] input) {
        int sampleCount = input.length / 3;
        byte[] output = new byte[sampleCount * 2];
        for (int i = 0; i < sampleCount; i++) {
            int b0 = input[i * 3] & 0xFF;
            int b1 = input[i * 3 + 1] & 0xFF;
            int b2 = input[i * 3 + 2] & 0xFF;
            int sample = (b2 << 16) | (b1 << 8) | b0;
            if (sample >= 0x800000) sample -= 0x1000000;  // 24bit 符号扩展
            short s = (short) (sample >> 8);              // 取高 16 位
            output[i * 2] = (byte) (s & 0xFF);
            output[i * 2 + 1] = (byte) ((s >> 8) & 0xFF);
        }
        return output;
    }

    /**
     * 32bit PCM → 16bit PCM（小端，取高 16 位）
     */
    private byte[] convert32To16(byte[] input) {
        int sampleCount = input.length / 4;
        byte[] output = new byte[sampleCount * 2];
        for (int i = 0; i < sampleCount; i++) {
            int b0 = input[i * 4] & 0xFF;
            int b1 = input[i * 4 + 1] & 0xFF;
            int b2 = input[i * 4 + 2] & 0xFF;
            int b3 = input[i * 4 + 3] & 0xFF;
            int sample = (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
            short s = (short) (sample >> 16);             // 取高 16 位
            output[i * 2] = (byte) (s & 0xFF);
            output[i * 2 + 1] = (byte) ((s >> 8) & 0xFF);
        }
        return output;
    }

    /**
     * 32bit IEEE float → 16bit PCM（× 32767，clamp [-1, 1]）
     */
    private byte[] convertFloatTo16(byte[] input) {
        int sampleCount = input.length / 4;
        byte[] output = new byte[sampleCount * 2];
        ByteBuffer fb = ByteBuffer.wrap(input).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < sampleCount; i++) {
            float sample = fb.getFloat(i * 4);
            if (sample > 1.0f) sample = 1.0f;
            if (sample < -1.0f) sample = -1.0f;
            short s = (short) (sample * 32767.0f);
            output[i * 2] = (byte) (s & 0xFF);
            output[i * 2 + 1] = (byte) ((s >> 8) & 0xFF);
        }
        return output;
    }

    /**
     * 压缩音频编码：MediaExtractor → 解码器 → PCM → AAC 编码器 → muxer
     */
    private boolean encodeAudioFromCompressed(MediaMuxer muxer, int outAudioTrack,
                                                AudioConfig config, long maxDurationUs) {
        MediaExtractor extractor = null;
        MediaCodec decoder = null;
        MediaCodec encoder = null;

        try {
            extractor = new MediaExtractor();
            extractor.setDataSource(config.audioPath);

            // 找音频轨
            int audioTrack = -1;
            MediaFormat srcFormat = null;
            String srcMime = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat fmt = extractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    audioTrack = i;
                    srcFormat = fmt;
                    srcMime = mime;
                    extractor.selectTrack(i);
                    break;
                }
            }
            if (audioTrack < 0 || srcFormat == null) {
                Log.e(TAG, "未找到音频轨");
                return false;
            }

            // 创建解码器
            decoder = MediaCodec.createDecoderByType(srcMime);
            decoder.configure(srcFormat, null, null, 0);
            decoder.start();

            // 创建 AAC 编码器
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
            encoder.configure(config.aacFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
            encoder.start();

            Log.i(TAG, "压缩音频编码开始: " + srcMime + " " + config.sampleRate + "Hz");

            int bytesPerSample = config.channelCount * 2; // 解码器输出为 16bit PCM

            // ── 1. 解码全部 PCM 到内存 ──
            // 镜像 C++ decodeExtractorToPcm：先把解码出的 PCM 整体积攒到内存。
            // 不能直接把解码器输出 buf 塞给编码器 —— 解码器单帧输出(final dts 差值)
            // 常大于 AAC 编码器输入缓冲容量，encBuf.put(pcmBuf) 会抛
            // BufferOverflowException（日志中 csd0 too small / 编码异常）。
            ByteArrayOutputStream pcmStream = new ByteArrayOutputStream();
            MediaCodec.BufferInfo decoderInfo = new MediaCodec.BufferInfo();
            boolean sawInputEOS = false;
            boolean sawDecoderOutputEOS = false;
            while (!sawDecoderOutputEOS) {
                // 喂数据给解码器
                if (!sawInputEOS) {
                    int inputIdx = decoder.dequeueInputBuffer(10000);
                    if (inputIdx >= 0) {
                        ByteBuffer inputBuf = decoder.getInputBuffer(inputIdx);
                        inputBuf.clear();
                        int sampleSize = extractor.readSampleData(inputBuf, 0);
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inputIdx, 0, 0, 0,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            sawInputEOS = true;
                        } else {
                            long pts = extractor.getSampleTime();
                            decoder.queueInputBuffer(inputIdx, 0, sampleSize, pts, 0);
                            extractor.advance();
                        }
                    }
                }

                // 从解码器取 PCM，追加到缓冲区
                int outputIdx = decoder.dequeueOutputBuffer(decoderInfo, 0);
                if (outputIdx >= 0) {
                    boolean isEOS = (decoderInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    boolean overDuration = maxDurationUs > 0
                            && decoderInfo.presentationTimeUs > maxDurationUs;

                    if (decoderInfo.size > 0 && !overDuration) {
                        ByteBuffer pcmBuf = decoder.getOutputBuffer(outputIdx);
                        pcmBuf.position(decoderInfo.offset);
                        pcmBuf.limit(decoderInfo.offset + decoderInfo.size);
                        byte[] tmp = new byte[decoderInfo.size];
                        pcmBuf.get(tmp);
                        pcmStream.write(tmp, 0, tmp.length);
                    }

                    decoder.releaseOutputBuffer(outputIdx, false);

                    if (isEOS || overDuration) {
                        sawDecoderOutputEOS = true;
                    }
                }
            }
            Log.i(TAG, "压缩音频解码完成: " + pcmStream.size() + " 字节 PCM");

            byte[] pcm = pcmStream.toByteArray();

            // ── 2. 按编码器输入缓冲容量分块送入 AAC 编码器 ──
            // 镜像 C++ encodeAll：每次拷贝 min(剩余, 输入缓冲容量) 字节，PTS 按样本数累计。
            MediaCodec.BufferInfo encoderInfo = new MediaCodec.BufferInfo();
            int inputOffset = 0;
            long ptsUs = 0;
            boolean eosSent = false;
            boolean eosReceived = false;
            while (!eosReceived) {
                if (!eosSent) {
                    int encInputIdx = encoder.dequeueInputBuffer(10000);
                    if (encInputIdx >= 0) {
                        int remaining = pcm.length - inputOffset;
                        if (remaining > 0) {
                            ByteBuffer encBuf = encoder.getInputBuffer(encInputIdx);
                            encBuf.clear();
                            int copySize = Math.min(remaining, encBuf.capacity());
                            copySize -= copySize % bytesPerSample; // 对齐到完整 PCM 帧
                            if (copySize > 0) {
                                encBuf.put(pcm, inputOffset, copySize);
                                encoder.queueInputBuffer(encInputIdx, 0, copySize, ptsUs, 0);
                                inputOffset += copySize;
                                ptsUs += (long) (copySize / bytesPerSample) * 1000000L
                                        / config.sampleRate;
                            } else {
                                // 剩余不足一个样本（尾部 padding），直接结束
                                encoder.queueInputBuffer(encInputIdx, 0, 0, ptsUs,
                                        MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                eosSent = true;
                            }
                        } else {
                            encoder.queueInputBuffer(encInputIdx, 0, 0, ptsUs,
                                    MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            eosSent = true;
                        }
                    }
                }

                // 从编码器取 AAC
                int encOutputIdx = encoder.dequeueOutputBuffer(encoderInfo, 0);
                if (encOutputIdx >= 0) {
                    if (encoderInfo.size > 0
                            && (encoderInfo.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        ByteBuffer aacBuf = encoder.getOutputBuffer(encOutputIdx);
                        muxer.writeSampleData(outAudioTrack, aacBuf, encoderInfo);
                    }
                    if ((encoderInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        eosReceived = true;
                    }
                    encoder.releaseOutputBuffer(encOutputIdx, false);
                }
            }

            Log.i(TAG, "压缩音频编码完成");
            return true;

        } catch (Exception e) {
            Log.e(TAG, "压缩音频编码异常: " + e.getMessage(), e);
            return false;
        } finally {
            if (extractor != null) {
                try { extractor.release(); } catch (Exception e) { /* ignore */ }
            }
            if (decoder != null) {
                try { decoder.stop(); } catch (Exception e) { /* ignore */ }
                try { decoder.release(); } catch (Exception e) { /* ignore */ }
            }
            if (encoder != null) {
                try { encoder.stop(); } catch (Exception e) { /* ignore */ }
                try { encoder.release(); } catch (Exception e) { /* ignore */ }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  进度界面（阻止触摸，风格与 SafeAreaTuner 一致：白底圆角卡片）
    // ══════════════════════════════════════════════════════════════

    /**
     * 显示"正在处理视频"进度对话框：
     * 圆角矩形卡片，左侧转圈动画，右侧文本；模态阻止触摸，处理完成自动消失。
     */
    private void showProgressDialog() {
        final Activity activity = getActivity();
        if (activity == null) return;

        activity.runOnUiThread(() -> {
            try {
                if (progressDialog != null) {
                    try { progressDialog.dismiss(); } catch (Exception e) { /* ignore */ }
                    progressDialog = null;
                }

                final float density = activity.getResources().getDisplayMetrics().density;

                Dialog dialog = new Dialog(activity);
                dialog.setCancelable(false);
                dialog.setCanceledOnTouchOutside(false);

                // 根卡片：水平布局，左侧转圈 + 右侧文本
                LinearLayout root = new LinearLayout(activity);
                root.setOrientation(LinearLayout.HORIZONTAL);
                root.setGravity(Gravity.CENTER_VERTICAL);
                int pad = Math.round(24 * density);
                root.setPadding(pad, pad, pad, pad);

                GradientDrawable card = new GradientDrawable();
                card.setColor(0xFFFFFFFF);
                card.setCornerRadius(24 * density);
                card.setStroke(Math.round(1 * density), 0xFFE0E0E0);
                root.setBackground(card);

                // 左侧：转圈动画（原生 ProgressBar indeterminate）
                ProgressBar spinner = new ProgressBar(activity);
                LinearLayout.LayoutParams spinnerLp = new LinearLayout.LayoutParams(
                        Math.round(40 * density), Math.round(40 * density));
                root.addView(spinner, spinnerLp);

                // 右侧：正在处理视频文本
                TextView text = new TextView(activity);
                text.setText("正在处理视频…");
                text.setTextSize(15);
                text.setTextColor(0xFF212121);
                text.setGravity(Gravity.CENTER_VERTICAL);
                LinearLayout.LayoutParams textLp = new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                textLp.leftMargin = Math.round(16 * density);
                root.addView(text, textLp);

                dialog.setContentView(root);

                // 透明背景，仅保留圆角卡片 + 默认 dim 遮罩（模态）
                Window dw = dialog.getWindow();
                if (dw != null) {
                    dw.setBackgroundDrawable(new ColorDrawable(0x00000000));
                    dw.setLayout(WindowManager.LayoutParams.WRAP_CONTENT,
                            WindowManager.LayoutParams.WRAP_CONTENT);
                }

                dialog.show();
                progressDialog = dialog;
                Log.d(TAG, "进度对话框已显示");
            } catch (Exception e) {
                Log.e(TAG, "显示进度对话框失败", e);
            }
        });
    }

    /**
     * 隐藏进度对话框（处理完成/失败时调用）
     */
    private void hideProgressDialog() {
        final Activity activity = getActivity();
        if (activity == null) return;

        activity.runOnUiThread(() -> {
            if (progressDialog != null) {
                try { progressDialog.dismiss(); } catch (Exception e) { /* ignore */ }
                progressDialog = null;
                Log.d(TAG, "进度对话框已隐藏");
            }
        });
    }

    // ══════════════════════════════════════════════════════════════
    //  媒体库扫描
    // ══════════════════════════════════════════════════════════════

    private void scanMediaFile(String filePath) {
        if (filePath == null || filePath.isEmpty()) return;
        try {
            File file = new File(filePath);
            if (!file.exists()) {
                Log.e(TAG, "待扫描文件不存在: " + filePath);
                return;
            }
            MediaScannerConnection.scanFile(getContext(),
                new String[]{filePath},
                new String[]{"video/mp4"},
                new MediaScannerConnection.OnScanCompletedListener() {
                    @Override
                    public void onScanCompleted(String path, android.net.Uri uri) {
                        if (uri != null) {
                            showToast("已更新媒体库：" + new File(path).getName());
                        }
                    }
                });
            Log.d(TAG, "已通知系统扫描: " + filePath);
        } catch (Exception e) {
            Log.e(TAG, "媒体库扫描失败: " + filePath, e);
        }
    }

    private void showToast(final String message) {
        new Handler(Looper.getMainLooper()).post(() -> {
            if (getContext() != null) {
                android.widget.Toast.makeText(getContext(), message,
                        android.widget.Toast.LENGTH_SHORT).show();
            }
        });
    }
}
