
/**
 * VideoCompose 视频合成管理模块
 * 
 * 主要功能:
 * - 管理视频合成相关的配置和状态
 * - 存储音乐文件信息用于视频渲染
 * - 管理渲染配置（码率、帧率）
 * - 提供状态变更监听机制
 * 
 * 调用关系:
 * - 被 MusicManager 调用: 设置/清除音乐状态
 * - 被渲染模块调用: 获取渲染配置
 * - 被 UI 层调用: 监听状态变化
 * 
 * 单例模式: 使用 getInstance() 获取唯一实例
 */

/** 音乐状态接口 */
export interface MusicState {
    /** 是否有音乐 */
    hasMusic: boolean;
    /** 音乐文件名 */
    musicName: string | null;
    /** 音乐文件路径 */
    musicFilePath: string | null;
}

/** 渲染配置接口 */
export interface RenderConfig {
    /** 码率（MB/s） */
    bitrate: number;
    /** 帧率（FPS） */
    frameRate: number;
}

/**
 * 视频合成管理器类
 * 负责管理视频合成相关的所有状态和配置
 */
export class VideoComposeManager {
    private static instance: VideoComposeManager | null = null;

    /** 音乐状态 */
    private musicState: MusicState = {
        hasMusic: false,
        musicName: null,
        musicFilePath: null
    };

    /** 渲染配置 */
    private renderConfig: RenderConfig = {
        bitrate: 12,
        frameRate: 30
    };

    /** 状态变更回调集合 */
    private stateChangeCallbacks: Set<(state: MusicState) => void> = new Set();
    /** 配置变更回调集合 */
    private configChangeCallbacks: Set<(config: RenderConfig) => void> = new Set();

    private constructor() {}

    /**
     * 获取 VideoComposeManager 单例实例
     * @returns VideoComposeManager 实例
     */
    public static getInstance(): VideoComposeManager {
        if (!VideoComposeManager.instance) {
            VideoComposeManager.instance = new VideoComposeManager();
        }
        return VideoComposeManager.instance;
    }

    /**
     * 重置单例实例（用于测试或重新初始化）
     */
    public static resetInstance(): void {
        if (VideoComposeManager.instance) {
            VideoComposeManager.instance.dispose();
        }
        VideoComposeManager.instance = undefined as any;
    }

    /**
     * 获取音乐状态
     * @returns 音乐状态副本
     */
    public getMusicState(): MusicState {
        return { ...this.musicState };
    }

    /**
     * 检查是否有音乐
     * @returns 是否有音乐
     */
    public hasMusic(): boolean {
        return this.musicState.hasMusic;
    }

    /**
     * 获取音乐文件路径
     * @returns 音乐文件路径或 null
     */
    public getMusicFilePath(): string | null {
        return this.musicState.musicFilePath;
    }

    /**
     * 设置音乐状态（在导入音乐时调用）
     * @param filePath - 音乐文件路径
     * @param fileName - 音乐文件名
     */
    public setMusic(filePath: string, fileName: string): void {
        this.musicState = {
            hasMusic: true,
            musicName: fileName,
            musicFilePath: filePath
        };
        this.notifyStateChange();
    }

    /**
     * 清除音乐状态（在删除或清除音乐时调用）
     */
    public clearMusic(): void {
        this.musicState = {
            hasMusic: false,
            musicName: null,
            musicFilePath: null
        };
        this.notifyStateChange();
    }

    /**
     * 获取渲染配置
     * @returns 渲染配置副本
     */
    public getRenderConfig(): RenderConfig {
        return { ...this.renderConfig };
    }

    /**
     * 设置码率（MB/s）
     * @param bitrate - 码率值
     */
    public setBitrate(bitrate: number): void {
        this.renderConfig.bitrate = bitrate;
        this.notifyConfigChange();
    }

    /**
     * 设置帧率
     * @param frameRate - 帧率值
     */
    public setFrameRate(frameRate: number): void {
        this.renderConfig.frameRate = frameRate;
        this.notifyConfigChange();
    }

    /**
     * 一次性设置所有渲染配置
     * @param config - 部分渲染配置
     */
    public setRenderConfig(config: Partial<RenderConfig>): void {
        if (config.bitrate !== undefined) {
            this.renderConfig.bitrate = config.bitrate;
        }
        if (config.frameRate !== undefined) {
            this.renderConfig.frameRate = config.frameRate;
        }
        this.notifyConfigChange();
    }

    /**
     * 注册状态变更监听
     * @param callback - 回调函数
     */
    public onStateChange(callback: (state: MusicState) => void): void {
        this.stateChangeCallbacks.add(callback);
    }

    /**
     * 取消状态变更监听
     * @param callback - 回调函数
     */
    public offStateChange(callback: (state: MusicState) => void): void {
        this.stateChangeCallbacks.delete(callback);
    }

    /**
     * 注册配置变更监听
     * @param callback - 回调函数
     */
    public onConfigChange(callback: (config: RenderConfig) => void): void {
        this.configChangeCallbacks.add(callback);
    }

    /**
     * 取消配置变更监听
     * @param callback - 回调函数
     */
    public offConfigChange(callback: (config: RenderConfig) => void): void {
        this.configChangeCallbacks.delete(callback);
    }

    /** 通知状态变更 */
    private notifyStateChange(): void {
        const state = this.getMusicState();
        this.stateChangeCallbacks.forEach(callback => {
            try {
                callback(state);
            } catch (error) {
                console.error('[VideoCompose] 状态变更回调执行失败:', error);
            }
        });
    }

    /** 通知配置变更 */
    private notifyConfigChange(): void {
        const config = this.getRenderConfig();
        this.configChangeCallbacks.forEach(callback => {
            try {
                callback(config);
            } catch (error) {
                console.error('[VideoCompose] 配置变更回调执行失败:', error);
            }
        });
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.stateChangeCallbacks.clear();
        this.configChangeCallbacks.clear();
        VideoComposeManager.instance = null;
    }
}

/** 视频合成管理器单例实例 */
export const videoComposeManager = VideoComposeManager.getInstance();
