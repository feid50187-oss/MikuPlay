/**
 * Copyright (c) 2026 这是作者名字. All rights reserved.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * VideoComposePlugin 模块 - 视频合成插件
 *
 * 主要功能:
 * - 提供离线渲染帧序列合成视频功能
 * - 支持进度监听和取消操作
 * - 支持硬件加速和自定义码率、帧率
 *
 * 调用关系:
 * - 被渲染模块调用: 视频导出功能通过此插件合成最终视频
 * - 调用 Capacitor VideoCompose 插件: 与原生层通信执行视频合成
 * - Web 平台仅返回警告（不支持）
 *
 * 单例模式: 使用 getInstance() 获取唯一实例
 */

export interface VideoComposeProgress {
    type: 'offline' | 'realtime';  // 合成类型
    current: number;               // 当前进度
    total: number;                 // 总进度
    percentage: number;            // 百分比
}

export interface VideoComposePlugin {
    processOfflineFrames(options: {
        framesDir: string;              // 帧目录
        outputPath: string;             // 输出路径
        musicPath?: string;             // 背景音乐路径
        frameRate?: number;             // 帧率
        bitrate?: number;               // 码率
    }): Promise<{
        success: boolean;
        outputPath: string;
        hasMusic: boolean;
        frameCount: number;
        framesDirDeleted: boolean;
        cancelled?: boolean;
    }>;

    cancelVideoCompose(): Promise<void>;

    addListener(
        eventName: 'videoComposeProgress',
        listenerFunc: (progress: VideoComposeProgress) => void
    ): Promise<PluginListenerHandle>;
}

interface PluginListenerHandle {
    remove: () => Promise<void>;
}

const VideoCompose = registerPlugin<VideoComposePlugin>('VideoCompose');

export { VideoCompose };

export interface OfflineProcessOptions {
    framesDir: string;              // 帧目录
    outputPath: string;             // 输出路径
    musicPath?: string;             // 背景音乐路径
    frameRate: number;              // 帧率
    bitrate: number;                // 码率
    onProgress?: (progress: VideoComposeProgress) => void;  // 进度回调
}

export class VideoComposePluginManager {
    private static instance: VideoComposePluginManager;
    private progressListenerHandle: any = null;
    private progressCallback: ((progress: VideoComposeProgress) => void) | null = null;

    private constructor() {}

    /** 获取 VideoComposePluginManager 单例实例 */
    public static getInstance(): VideoComposePluginManager {
        if (!VideoComposePluginManager.instance) {
            VideoComposePluginManager.instance = new VideoComposePluginManager();
        }
        return VideoComposePluginManager.instance;
    }

    /** 重置单例实例 */
    public static resetInstance(): void {
        VideoComposePluginManager.instance = undefined as any;
    }

    /** 检查是否在原生平台 */
    public isNativePlatform(): boolean {
        return Capacitor.isNativePlatform();
    }

    /** 处理离线渲染帧序列合成视频 */
    public async processOfflineFrames(options: OfflineProcessOptions): Promise<{
        success: boolean;
        outputPath?: string;
        hasMusic?: boolean;
        frameCount?: number;
        framesDirDeleted?: boolean;
        error?: string;
    }> {
        if (!this.isNativePlatform()) {
            console.warn('[VideoCompose] Not running on native platform');
            return { success: false, error: 'Not running on native platform' };
        }

        this.progressCallback = options.onProgress || null;
        await this.setupProgressListener();

        try {
            const result = await VideoCompose.processOfflineFrames({
                framesDir: options.framesDir,
                outputPath: options.outputPath,
                musicPath: options.musicPath,
                frameRate: options.frameRate,
                bitrate: options.bitrate
            });

            if (result.cancelled) {
                return {
                    success: false,
                    error: 'Video composition cancelled'
                };
            }

            console.log('[VideoCompose] Offline frames processed:', result.outputPath);
            return {
                success: true,
                outputPath: result.outputPath,
                hasMusic: result.hasMusic,
                frameCount: result.frameCount,
                framesDirDeleted: result.framesDirDeleted
            };
        } catch (error) {
            console.error('[VideoCompose] Failed to process offline frames:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        } finally {
            this.removeProgressListener();
            this.progressCallback = null;
        }
    }

    /** 取消视频合成 */
    public async cancelVideoCompose(): Promise<void> {
        try {
            await VideoCompose.cancelVideoCompose();
            console.log('[VideoCompose] Cancellation requested');
        } catch (error) {
            console.error('[VideoCompose] Failed to cancel:', error);
        }
    }

    /** 设置进度监听器 */
    private async setupProgressListener(): Promise<void> {
        await this.removeProgressListener();

        this.progressListenerHandle = await VideoCompose.addListener(
            'videoComposeProgress',
            (progress: VideoComposeProgress) => {
                console.log('[VideoCompose] Progress:', progress.percentage + '%', progress.current + '/' + progress.total);
                this.progressCallback?.(progress);
            }
        );
    }

    /** 移除进度监听器 */
    private async removeProgressListener(): Promise<void> {
        if (this.progressListenerHandle) {
            await this.progressListenerHandle.remove();
            this.progressListenerHandle = null;
        }
    }
}

export const videoComposePluginManager = VideoComposePluginManager.getInstance();
