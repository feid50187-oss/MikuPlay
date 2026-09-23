
/**
 * Particle 模块类型定义
 * 
 * 定义粒子系统的所有类型、接口和枚举
 */

import type { Vector3, Color4 } from '@babylonjs/core';
import type { ParticleRenderConfig } from '../../core/IPlugin';

/** 粒子预设类型 */
export type ParticlePresetType = string;

/** 发射器形状 */
export type EmitterShape = 'box' | 'sphere' | 'cylinder' | 'cone';

/** 混合模式 */
export type BlendMode = 'oneOne' | 'standard' | 'multiply';

/** 纹理来源类型 */
export type TextureSource = string;

/**
 * 粒子参数接口
 * 定义粒子系统的可配置参数
 */
export interface ParticleParams {
    /** 发射方向 */
    emitNormal?: Vector3;
    /** 生命周期（秒） */
    lifeTime?: number;
    /** 最小尺寸 */
    minSize?: number;
    /** 最大尺寸 */
    maxSize?: number;
    /** 发射速率（粒子/秒） */
    emitRate?: number;
    /** 最小发射力度 */
    minEmitPower?: number;
    /** 最大发射力度 */
    maxEmitPower?: number;
    /** 速度 */
    speed?: number;
    /** 重力向量 */
    gravity?: Vector3;
    /** 扰动程度 */
    turbulence?: number;
    /** 起始颜色 */
    colorStart?: Color4;
    /** 结束颜色 */
    colorEnd?: Color4;
    /** 发射器位置 */
    emitterPosition?: Vector3;
    /** 发射器尺寸 */
    emitterSize?: Vector3;
    /** 旋转速度 */
    rotationSpeed?: number;
    /** 最大粒子数量 */
    maxParticles?: number;
}

/**
 * 粒子预设配置接口
 * 定义每种预设类型的完整配置
 */
export interface ParticlePresetConfig {
    /** 显示名称 */
    name: string;
    /** 预设类型 */
    type: ParticlePresetType;
    /** 默认参数 */
    defaultParams: ParticleParams;
    /** 可调参数列表 */
    adjustableParams: (keyof ParticleParams)[];
    /** 纹理来源 */
    textureSource: TextureSource;
    /** 纹理标识 */
    texture: string;
    /** 混合模式 */
    blendMode: BlendMode;
    /** 是否写入深度缓冲 */
    depthWrite: boolean;
    /** 是否启用旋转 */
    enableRotation: boolean;
    /** 默认最大粒子数 */
    defaultMaxParticles: number;
}

/**
 * 粒子系统状态接口
 * 用于获取粒子系统的当前状态
 */
export interface ParticleSystemState {
    /** 系统名称 */
    name: string;
    /** 预设类型 */
    presetType: ParticlePresetType;
    /** 当前参数 */
    currentParams: ParticleParams;
    /** 是否启用 */
    enabled: boolean;
}

/**
 * 粒子管理器接口
 * 定义粒子管理器的标准接口
 */
export interface IParticleManager {
    /**
     * 创建预设粒子系统
     * @param type - 预设类型
     * @param name - 系统名称
     * @param initialParams - 初始参数（可选）
     */
    createPreset(
        type: ParticlePresetType,
        name: string,
        initialParams?: Partial<ParticleParams>
    ): void;

    /**
     * 创建插件粒子系统
     * @param pluginId - 插件ID
     * @param name - 系统名称
     * @param initialParams - 初始参数
     * @param renderConfig - 渲染配置
     */
    createPluginPreset(
        pluginId: string,
        name: string,
        initialParams: Partial<ParticleParams>,
        renderConfig: ParticleRenderConfig
    ): void;

    /**
     * 更新粒子参数
     * @param name - 系统名称
     * @param params - 要更新的参数
     */
    updateParams(name: string, params: Partial<ParticleParams>): void;

    /**
     * 移除粒子系统
     * @param name - 系统名称
     */
    removeSystem(name: string): void;

    /**
     * 设置启用状态
     * @param name - 系统名称
     * @param enabled - 是否启用
     */
    setEnabled(name: string, enabled: boolean): void;

    /**
     * 获取系统状态
     * @param name - 系统名称
     * @returns 系统状态或 null
     */
    getSystemState(name: string): ParticleSystemState | null;

    /**
     * 获取所有系统状态
     * @returns 系统状态数组
     */
    getAllSystems(): ParticleSystemState[];

    /**
     * 释放所有资源
     */
    dispose(): void;
}

/** 粒子事件类型 */
export type ParticleEventType = string;

/**
 * 粒子事件回调类型
 */
export type ParticleEventCallback = (data: {
    /** 系统名称 */
    name: string;
    /** 预设类型 */
    type: ParticlePresetType;
    /** 参数（可选） */
    params?: ParticleParams;
}) => void;
