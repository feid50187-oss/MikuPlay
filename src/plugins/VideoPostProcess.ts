/**
 * Copyright (c) 2026 这是作者名字. All rights reserved.
 */
import { registerPlugin } from '@capacitor/core';

/**
 * VideoPostProcess 模块 - 实时渲染录屏后处理插件
 *
 * 主要功能:
 * - 录屏完成后把无声 MP4 与音乐文件合成带音轨的新 MP4
 * - 慢放模式下（renderFps<30）视频轨 PTS 缩放倍速到正常速度
 * - 音频原速率 AAC 合成（音乐本就是正常速度，无需倍速）
 * - 保留录制结果（MikuPlay录制MMDDHHMMSS.mp4）与处理结果（实时渲染MMDDHHMMSS.mp4）
 *
 * 调用关系:
 * - 被 RealtimeRenderManager 调用: 实时渲染录屏结束后自动触发后处理
 * - 调用 Capacitor VideoPostProcess 插件: 与原生层通信
 */

export interface PostProcessOptions {
    srcPath: string;     // 录制结果路径（MikuPlay录制MMDDHHMMSS.mp4）
    audioPath?: string;  // 音乐文件路径（可空，为空仅拷贝视频轨）
    outputPath: string;  // 处理结果路径（实时渲染MMDDHHMMSS.mp4）
    speed?: number;      // 倍速因子（1=原速，2=2倍速）。慢放模式下录制视频需倍速到正常速度
}

export interface PostProcessResult {
    success: boolean;
    outputPath?: string;
    error?: string;
}

export interface VideoPostProcessPlugin {
    process(options: PostProcessOptions): Promise<PostProcessResult>;
}

const VideoPostProcess = registerPlugin<VideoPostProcessPlugin>('VideoPostProcess');

export { VideoPostProcess };
