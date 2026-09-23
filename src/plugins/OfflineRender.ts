/**
 * Copyright (c) 2026 这是作者名字. All rights reserved.
 */
import { registerPlugin } from '@capacitor/core';

/**
 * OfflineRender 模块 - 离线渲染插件
 *
 * 主要功能:
 * - 提供离线渲染服务器的启动和停止功能
 * - 用于后台批量渲染视频帧
 * - 支持配置工作线程数和队列大小
 * - 支持获取输出路径
 *
 * 调用关系:
 * - 被渲染模块调用: 离线渲染功能通过此插件控制渲染服务器
 * - 调用 Capacitor OfflineRender 插件: 与原生层通信
 *
 * 导出内容:
 * - OfflineRender: 插件实例
 * - 相关接口定义
 */

export interface StartServerOptions {
    workerCount?: number;   // 工作线程数
    queueSize?: number;     // 队列大小
}

export interface StartServerResult {
    success: boolean;       // 是否成功
    port?: number;          // 服务器端口
    error?: string;         // 错误信息
}

export interface SaveResult {
    success: boolean;       // 是否成功
    error?: string;         // 错误信息
}

export interface GetOutputPathResult {
    path: string;           // 输出目录路径
}

export interface OfflineRenderPlugin {
    startServer(options?: StartServerOptions): Promise<StartServerResult>;
    stopServer(): Promise<SaveResult>;
    getOutputPath(): Promise<GetOutputPathResult>;
}

const OfflineRender = registerPlugin<OfflineRenderPlugin>('OfflineRender');

export { OfflineRender };
