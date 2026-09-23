/**
 * Copyright (c) 2026 这是作者名字. All rights reserved.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * MediaPicker 模块 - 媒体选择器
 *
 * 主要功能:
 * - 提供原生平台的图片和视频选择功能
 * - 返回媒体文件的 URI、MIME 类型、尺寸等信息
 * - 支持取消操作检测
 *
 * 调用关系:
 * - 被 UI 层调用: 背景图片选择等功能通过此模块选择媒体文件
 * - 调用 Capacitor MediaPicker 插件: 在 Android/iOS 平台执行媒体选择
 * - Web 平台直接返回 null（不支持）
 *
 * 单例模式: 使用 getInstance() 获取唯一实例
 */

export interface MediaPickerOptions {
}

export interface MediaPickerResult {
    uri: string;            // 媒体文件 URI
    mimeType: string;       // MIME 类型
    width: number;          // 图片/视频宽度
    height: number;         // 图片/视频高度
    mediaType: 'image' | 'video';  // 媒体类型
    absolutePath: string;   // 绝对路径
}

export interface MediaPickerPluginInterface {
    pickMedia(options?: MediaPickerOptions): Promise<MediaPickerResult>;
}

const MediaPickerPlugin = registerPlugin<MediaPickerPluginInterface>('MediaPicker');

export class MediaPickerManager {
    private static instance: MediaPickerManager;

    private constructor() {}

    /** 获取 MediaPickerManager 单例实例 */
    public static getInstance(): MediaPickerManager {
        if (!MediaPickerManager.instance) {
            MediaPickerManager.instance = new MediaPickerManager();
        }
        return MediaPickerManager.instance;
    }

    /** 重置单例实例 */
    public static resetInstance(): void {
        MediaPickerManager.instance = undefined as any;
    }

    /**
     * 选择媒体文件
     * @returns 媒体选择结果，Web 平台返回 null，用户取消也返回 null
     */
    public async pickMedia(options?: MediaPickerOptions): Promise<MediaPickerResult | null> {
        const platform = Capacitor.getPlatform();
        if (platform === 'web' || platform === 'windows') {
            return null;
        }

        try {
            const result = await MediaPickerPlugin.pickMedia(options || {});
            return result;
        } catch (error: any) {
            if (error && error.message && error.message.includes('取消')) {
                return null;
            }
            console.error('媒体选择失败:', error);
            return null;
        }
    }
}

export const mediaPickerManager = MediaPickerManager.getInstance();
