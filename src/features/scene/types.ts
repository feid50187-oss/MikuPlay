
import type { Scene, Engine, Camera } from '@babylonjs/core';

/**
 * 场景配置接口
 */
export interface SceneConfig {
    /** 背景色，十六进制格式 */
    backgroundColor: string;
    /** 是否启用坐标格网 */
    gridVisible: boolean;
}

/**
 * 阴影过滤模式
 */
export type ShadowFilterMode =
    | 'none'           // FILTER_NONE: 无过滤
    | 'blurCloseEsm'   // FILTER_BLURCLOSEEXPONENTIALSHADOWMAP: 模糊近距离ESM
    | 'pcf'            // FILTER_PCF: 百分比近似过滤
    | 'pcss';          // FILTER_PCSS: 百分比近似软阴影

/**
 * 阴影配置接口
 */
export interface ShadowConfig {
    /** 是否启用阴影 */
    enabled: boolean;
    /** 阴影分辨率 */
    resolution: number;
    /** 是否启用自阴影 */
    selfShadow: boolean;
    /** 阴影质量 */
    quality: 'low' | 'medium' | 'high';
    /** 阴影强度 */
    intensity: number;
    /** 过滤模式 */
    filterMode: ShadowFilterMode;
    /** 阴影偏移 (防止阴影痤疮) */
    bias: number;
    /** 法线偏移 */
    normalBias: number;
    /** 阴影深度 (0-1, 越大阴影越深) */
    darkness: number;
    /** 视锥边缘衰减 (0-1) */
    frustumEdgeFalloff: number;
    /** 是否启用透明阴影 */
    transparencyShadow: boolean;
    /**
     * 阴影投射范围 (10-200)
     * 控制方向光正交投影的半边长（单位：场景单位）。
     * 值越小 → 阴影贴图 texel 密度越高 → 阴影越清晰，但覆盖范围小，PCF/PCSS 易截断。
     * 值越大 → 覆盖范围越大 → PCF/PCSS 不截断，但阴影精度下降。
     * 建议根据场景大小调整，默认 50 覆盖 100×100 地面。
     */
    shadowArea: number;
    /**
     * 是否自动计算阴影视锥体
     * true: Babylon.js 根据阴影投射体包围盒自动计算，精度最高但覆盖范围仅限投射体附近。
     * false: 使用 shadowArea 手动控制覆盖范围（默认）。
     * 自动模式适合特写镜头，手动模式适合全身舞台。
     */
    autoFrustum: boolean;
}

/**
 * 光照配置接口
 */
export interface LightConfig {
    /** 环境光亮度 (0-1) */
    ambientIntensity: number;
    /** 环境光颜色 RGB */
    ambientColor: { r: number; g: number; b: number };
    /** 方向光亮度 (0-2) */
    directionalIntensity: number;
    /** 方向光颜色 RGB */
    directionalColor: { r: number; g: number; b: number };
    /** 方向光方向向量 */
    directionalDirection: { x: number; y: number; z: number };
    /** 阴影配置 */
    shadow: ShadowConfig;
}

/**
 * 场景状态接口
 */
export interface SceneState {
    config: SceneConfig;
    lightConfig: LightConfig;
}

/**
 * 场景事件类型
 */
export type SceneEventType = 
    | 'gridVisibilityChanged'
    | 'backgroundColorChanged'
    | 'ambientIntensityChanged'
    | 'ambientColorChanged'
    | 'directionalColorChanged'
    | 'directionalDirectionChanged';

/**
 * 场景事件回调
 */
export type SceneEventCallback = (data: any) => void;

/**
 * 场景管理器接口
 */
export interface ISceneManager {
    /** 获取 Babylon 场景实例 */
    getScene(): Scene;
    /** 获取 Babylon 引擎实例 */
    getEngine(): Engine;
    /** 获取相机实例 */
    getCamera(): Camera;
    /** 初始化场景 */
    initialize(canvas: HTMLCanvasElement): Promise<void>;
    /** 释放资源 */
    dispose(): void;
    /** 添加事件监听 */
    on(event: SceneEventType, callback: SceneEventCallback): void;
    /** 移除事件监听 */
    off(event: SceneEventType, callback: SceneEventCallback): void;
    /** 暂停屏幕渲染（用于离线渲染） */
    pauseScreenRender(): void;
    /** 恢复屏幕渲染 */
    resumeScreenRender(): void;
    /** 获取屏幕渲染是否暂停 */
    isScreenRenderPaused(): boolean;
}

/**
 * 坐标格网管理器接口
 */
export interface IGridManager {
    /** 设置可见性 */
    setVisible(visible: boolean): void;
    /** 获取可见性 */
    getVisible(): boolean;
    /** 释放资源 */
    dispose(): void;
}

/**
 * 光照管理器接口
 */
export interface ILightManager {
    /** 设置环境光亮度 */
    setAmbientIntensity(intensity: number): void;
    /** 设置环境光颜色 */
    setAmbientColor(r: number, g: number, b: number): void;
    /** 设置方向光亮度 */
    setDirectionalIntensity(intensity: number): void;
    /** 设置方向光颜色 */
    setDirectionalColor(r: number, g: number, b: number): void;
    /** 设置方向光方向 */
    setDirectionalDirection(x: number, y: number, z: number): void;
    /** 通过欧拉角旋转方向光 */
    rotateDirectionalLight(angleX: number | null, angleY: number | null, angleZ: number | null): void;
    /** 获取当前光照配置 */
    getConfig(): LightConfig;
    /** 释放资源 */
    dispose(): void;
    /** 设置阴影启用状态 */
    setShadowEnabled(enabled: boolean): void;
    /** 获取阴影生成器 */
    getShadowGenerator(): any;
    /** 添加阴影投射体 */
    addShadowCaster(mesh: any): void;
    /** 设置阴影配置 */
    setShadowConfig(config: Partial<ShadowConfig>): void;
    /** 设置阴影分辨率 */
    setShadowResolution(resolution: number): void;
    /** 设置阴影过滤模式 */
    setShadowFilterMode(mode: string): void;
    /** 设置阴影偏移 */
    setShadowBias(bias: number): void;
    /** 设置法线偏移 */
    setShadowNormalBias(normalBias: number): void;
    /** 设置阴影深度 */
    setShadowDarkness(darkness: number): void;
    /** 设置视锥边缘衰减 */
    setShadowFrustumEdgeFalloff(falloff: number): void;
    /** 设置阴影投射范围 */
    setShadowArea(area: number): void;
    /** 设置是否自动计算阴影视锥体 */
    setAutoFrustum(auto: boolean): void;
}

/**
 * Worker 消息类型
 */
export type WorkerMessageType = 
    | 'init'
    | 'calculateGrid'
    | 'calculateLightTransform';

/**
 * Worker 消息接口
 */
export interface WorkerMessage {
    type: WorkerMessageType;
    payload?: any;
}

/**
 * Worker 响应接口
 */
export interface WorkerResponse {
    type: WorkerMessageType;
    success: boolean;
    data?: any;
    error?: string;
}
