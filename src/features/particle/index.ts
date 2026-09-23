
/**
 * Particle 粒子系统模块入口
 * 
 * 主要功能:
 * - 提供粒子系统的创建、管理和控制功能
 * - 支持多种预设粒子效果（雨滴、樱花、雪花、基础）
 * - 程序化生成粒子纹理，无需外部图片资源
 * - 提供事件系统监听粒子系统状态变化
 * 
 * 导出内容分类:
 * 
 * 1. 粒子管理器:
 * - ParticleManager: 粒子系统的主要管理类
 * 
 * 2. 纹理管理:
 * - ProceduralTextureManager: 程序化纹理生成管理器
 * 
 * 3. 预设配置:
 * - PARTICLE_PRESETS: 粒子预设配置对象
 * - getParticlePreset: 获取预设配置函数
 * - getAdjustableParams: 获取可调参数函数
 * 
 * 4. 类型定义:
 * - ParticlePresetType: 预设类型（rain/sakura/snow/basic）
 * - ParticleParams: 粒子参数接口
 * - ParticlePresetConfig: 预设配置接口
 * - ParticleSystemState: 粒子系统状态接口
 * - IParticleManager: 粒子管理器接口
 * - ParticleEventType: 事件类型
 * - ParticleEventCallback: 事件回调类型
 * - EmitterShape: 发射器形状
 * - BlendMode: 混合模式
 * - TextureSource: 纹理来源
 * 
 * 调用关系:
 * - 被 World 面板调用: 创建和管理粒子效果
 * - 使用 Babylon.js ParticleSystem: 实现粒子渲染
 * - 使用 ProceduralTexture: 生成程序化纹理
 */

export { ParticleManager, textureRegistry } from './ParticleManager';
export { ProceduralTextureManager } from './ProceduralTextureManager';
export { particlePresetRegistry, getParticlePreset, getAdjustableParams } from './particlePresets';
export type {
    ParticlePresetType,
    ParticleParams,
    ParticlePresetConfig,
    ParticleSystemState,
    IParticleManager,
    ParticleEventType,
    ParticleEventCallback,
    EmitterShape,
    BlendMode,
    TextureSource
} from './types';
