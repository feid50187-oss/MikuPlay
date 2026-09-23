
/**
 * State 状态管理模块入口
 * 
 * 主要功能:
 * - 提供应用程序各模块的状态管理
 * - 支持状态的持久化和恢复
 * - 提供状态变更监听机制
 * 
 * 导出内容分类:
 * 
 * 1. 核心状态存储:
 * - StateStore: 全局状态存储
 * 
 * 2. 背景状态:
 * - BackgroundStateManager: 背景状态管理器
 * - BackgroundType: 背景类型
 * - EnvironmentSettings: 环境设置
 * - MediaSettings: 媒体设置
 * - BackgroundState: 背景状态
 * 
 * 3. 地面状态:
 * - GroundStateManager: 地面状态管理器
 * - GroundType: 地面类型
 * - GroundState: 地面状态
 * 
 * 4. 粒子状态:
 * - ParticleStateManager: 粒子状态管理器
 * - ParticleSystemType: 粒子系统类型
 * - ParticleSystemState: 粒子系统状态
 * - ParticleState: 粒子状态
 * 
 * 5. 后处理状态:
 * - PostProcStateManager: 后处理状态管理器
 * - PostProcState: 后处理状态
 * 
 * 6. 模型操作状态:
 * - ModelOptStateManager: 模型操作状态管理器
 * - ModelOptMode: 操作模式
 * - AxisType: 轴向类型
 * - BoneTransformValue: 骨骼变换值
 * - BoneTransformRecord: 骨骼变换记录
 * - MorphInfo: 变形信息
 * - ModelMorphState: 模型变形状态
 * - ModelBoneState: 模型骨骼状态
 * - ModelOptState: 模型操作状态
 * 
 * 7. 着色状态:
 * - ShadingStateManager: 着色状态管理器
 * - shadingStateManager: 着色状态管理器实例
 * - SpaBlendMode: SPA 混合模式
 * - AlphaBlendMode: Alpha 混合模式
 * - CullMode: 裁剪模式
 * - Color3State: 颜色状态
 * - MaterialControlState: 材质控制状态
 * - ShadingState: 着色状态
 * 
 * 调用关系:
 * - 被各个功能面板调用
 * - 与 SceneManager 协同工作
 * - 支持状态的导入导出
 */

export { StateStore } from './StateStore';

export {
  BackgroundStateManager,
  type BackgroundType,
  type EnvironmentSettings,
  type MediaSettings,
  type BackgroundState
} from './BackgroundStateManager';

export {
  GroundStateManager,
  type GroundType,
  type GroundState
} from './GroundStateManager';

export {
  ParticleStateManager,
  type ParticleSystemType,
  type ParticleSystemState,
  type ParticleState
} from './ParticleStateManager';

export {
  PostProcStateManager,
  type PostProcState
} from './PostProcStateManager';

export {
  ModelOptStateManager,
  type ModelOptMode,
  type AxisType,
  type BoneTransformValue,
  type BoneTransformRecord,
  type MorphInfo,
  type ModelMorphState,
  type ModelBoneState,
  type ModelOptState
} from './ModelOptStateManager';

export {
  ShadingStateManager,
  shadingStateManager,
  type SpaBlendMode,
  type AlphaBlendMode,
  type CullMode,
  type Color3State,
  type MaterialControlState,
  type MaterialState,
  type ShadingState
} from './ShadingStateManager';

export {
  ThemeStateManager,
  themeStateManager,
  type ThemeState
} from './ThemeStateManager';
