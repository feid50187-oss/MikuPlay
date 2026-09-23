/**
 * Copyright (c) 2026 这是作者名字. All rights reserved.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * RenderProgressPlugin 模块 - 渲染进度监听插件
 *
 * 主要功能:
 * - 提供渲染进度监听功能
 * - 支持取消渲染操作
 *
 * 调用关系:
 * - 被渲染模块调用: 监听渲染进度
 * - 调用 Capacitor RenderProgress 插件: 与原生层通信
 * - Web 平台仅返回警告（不支持）
 *
 * 单例模式: 使用 getInstance() 获取唯一实例
 */

export interface RenderProgress {
    type: 'offline' | 'realtime';  // 渲染类型
    current: number;               // 当前进度
    total: number;                 // 总进度
    percentage: number;            // 百分比
}

export interface RenderProgressPlugin {
    addListener(
        eventName: 'renderProgress',
        listenerFunc: (progress: RenderProgress) => void
    ): Promise<PluginListenerHandle>;

    removeListener(
        eventName: 'renderProgress',
        listenerFunc: (progress: RenderProgress) => void
    ): Promise<void>;
}

interface PluginListenerHandle {
    remove: () => Promise<void>;
}

const RenderProgress = registerPlugin<RenderProgressPlugin>('RenderProgress');

export { RenderProgress };

export class RenderProgressPluginManager {
    private static instance: RenderProgressPluginManager;
    private progressListenerHandle: any = null;
    private progressCallback: ((progress: RenderProgress) => void) | null = null;

    private constructor() {}

    /** 获取 RenderProgressPluginManager 单例实例 */
    public static getInstance(): RenderProgressPluginManager {
        if (!RenderProgressPluginManager.instance) {
            RenderProgressPluginManager.instance = new RenderProgressPluginManager();
        }
        return RenderProgressPluginManager.instance;
    }

    /** 重置单例实例 */
    public static resetInstance(): void {
        RenderProgressPluginManager.instance = undefined as any;
    }

    /** 检查是否在原生平台 */
    public isNativePlatform(): boolean {
        return Capacitor.isNativePlatform();
    }

    /** 设置进度监听器 */
    public async setProgressListener(callback: (progress: RenderProgress) => void): Promise<void> {
        if (!this.isNativePlatform()) {
            console.warn('[RenderProgress] Not running on native platform');
            return;
        }

        this.progressCallback = callback;
        await this.removeProgressListener();

        this.progressListenerHandle = await RenderProgress.addListener(
            'renderProgress',
            (progress: RenderProgress) => {
                console.log('[RenderProgress] Progress:', progress.percentage + '%', progress.current + '/' + progress.total);
                this.progressCallback?.(progress);
            }
        );
    }

    /** 移除进度监听器 */
    public async removeProgressListener(): Promise<void> {
        if (this.progressListenerHandle) {
            await this.progressListenerHandle.remove();
            this.progressListenerHandle = null;
        }
        this.progressCallback = null;
    }
}

export const renderProgressPluginManager = RenderProgressPluginManager.getInstance();
