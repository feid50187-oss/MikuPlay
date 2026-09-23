/**
 * Copyright (c) 2026 这是作者名字. All rights reserved.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * ScreenRecorder 模块 - 屏幕录制管理器
 *
 * 主要功能:
 * - 提供原生平台的屏幕录制功能
 * - 支持配置录制分辨率、帧率、码率
 * - 管理录制状态和权限
 * - 提供录制开始、停止、状态查询等操作
 *
 * 调用关系:
 * - 被 UI 层调用: 录制面板通过此管理器控制屏幕录制
 * - 调用 Capacitor ScreenRecorder 插件: 在 Android/iOS 平台执行录制操作
 * - Web 平台仅返回警告（不支持）
 *
 * 单例模式: 使用 getInstance() 获取唯一实例
 */

export interface ScreenRecorderPlugin {
    requestPermission(): Promise<{ granted: boolean; error?: string }>;
    startRecording(options: {
        width?: number;     // 录制宽度
        height?: number;    // 录制高度
        frameRate?: number; // 帧率
        bitrate?: number;   // 码率
    }): Promise<{ success: boolean; outputPath?: string; error?: string }>;
    stopRecording(): Promise<{ success: boolean; outputPath?: string; error?: string }>;
    isRecording(): Promise<{ isRecording: boolean }>;
    getRecordingStatus(): Promise<{ isRecording: boolean; outputPath?: string }>;
}

const ScreenRecorder = registerPlugin<ScreenRecorderPlugin>('ScreenRecorder');

export { ScreenRecorder };

export interface RecordingOptions {
    bitrate: number;    // 码率（MB/s）
}

export class ScreenRecorderManager {
    private static instance: ScreenRecorderManager;
    private isRecording = false;
    private currentOutputPath: string | null = null;

    private constructor() {}

    /** 获取 ScreenRecorderManager 单例实例 */
    public static getInstance(): ScreenRecorderManager {
        if (!ScreenRecorderManager.instance) {
            ScreenRecorderManager.instance = new ScreenRecorderManager();
        }
        return ScreenRecorderManager.instance;
    }

    /** 重置单例实例 */
    public static resetInstance(): void {
        ScreenRecorderManager.instance = undefined as any;
    }

    /** 检查是否在原生平台 */
    public isNativePlatform(): boolean {
        return Capacitor.isNativePlatform();
    }

    /** 请求屏幕录制权限 */
    public async requestPermission(): Promise<boolean> {
        if (!this.isNativePlatform()) {
            console.warn('[ScreenRecorder] Not running on native platform');
            return false;
        }

        try {
            const result = await ScreenRecorder.requestPermission();
            return result.granted;
        } catch (error) {
            console.error('[ScreenRecorder] Failed to request permission:', error);
            return false;
        }
    }

    /** 开始录制 */
    public async startRecording(options: RecordingOptions): Promise<boolean> {
        if (!this.isNativePlatform()) {
            console.warn('[ScreenRecorder] Not running on native platform');
            return false;
        }

        if (this.isRecording) {
            console.warn('[ScreenRecorder] Recording already in progress');
            return false;
        }

        try {
            const result = await ScreenRecorder.startRecording({
                bitrate: options.bitrate
            });

            if (result.success) {
                this.isRecording = true;
                this.currentOutputPath = result.outputPath || null;
                console.log('[ScreenRecorder] Recording started:', result.outputPath);
                return true;
            } else {
                console.error('[ScreenRecorder] Failed to start recording:', result.error);
                return false;
            }
        } catch (error) {
            console.error('[ScreenRecorder] Error starting recording:', error);
            return false;
        }
    }

    /** 停止录制 */
    public async stopRecording(): Promise<{ success: boolean; outputPath?: string }> {
        if (!this.isNativePlatform()) {
            return { success: false };
        }

        if (!this.isRecording) {
            return { success: false };
        }

        try {
            const result = await ScreenRecorder.stopRecording();
            this.isRecording = false;

            if (result.success) {
                this.currentOutputPath = result.outputPath || null;
                console.log('[ScreenRecorder] Recording stopped:', result.outputPath);
                return { success: true, outputPath: result.outputPath };
            } else {
                console.error('[ScreenRecorder] Failed to stop recording:', result.error);
                return { success: false };
            }
        } catch (error) {
            console.error('[ScreenRecorder] Error stopping recording:', error);
            this.isRecording = false;
            return { success: false };
        }
    }

    /** 获取录制状态 */
    public getIsRecording(): boolean {
        return this.isRecording;
    }

    /** 获取当前录制文件路径 */
    public getCurrentOutputPath(): string | null {
        return this.currentOutputPath;
    }

    /** 检查是否正在录制 */
    public async checkRecordingStatus(): Promise<boolean> {
        if (!this.isNativePlatform()) {
            return false;
        }

        try {
            const result = await ScreenRecorder.isRecording();
            this.isRecording = result.isRecording;
            return result.isRecording;
        } catch (error) {
            console.error('[ScreenRecorder] Error checking recording status:', error);
            return false;
        }
    }
}

export const screenRecorderManager = ScreenRecorderManager.getInstance();
