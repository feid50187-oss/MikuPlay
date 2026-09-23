
/**
 * MMD (MikuMikuDance) 模块入口
 * 
 * 主要功能:
 * - 提供 MMD 模型加载、动画播放、相机控制等功能的统一入口
 * - 管理 PMX/PMD/BPMX 格式的模型文件
 * - 支持 VMD 格式的动画文件
 * - 提供物理模拟、骨骼操作、材质处理等功能
 * 
 * 导出内容分类:
 * 
 * 1. 模型管理:
 * - ModelManager: 模型加载和管理
 * - ModelStateManager: 模型状态持久化
 * 
 * 2. 动画管理:
 * - AnimationManager: 动画加载和播放控制
 * - CameraManager: 相机动画管理
 * 
 * 3. 相机输入控制:
 * - MmdCameraInputManager: 相机输入统一管理
 * - MmdCameraPointersInput: 指针输入（触摸/鼠标）
 * - MmdCameraMouseWheelInput: 滚轮输入
 * 
 * 4. 辅助功能:
 * - BoneManager: 骨骼操作
 * - AnimationCorrectionManager: 动画数据永久修改
 * - PhysicsManager: 物理模拟控制
 * - TextureDownsampler: 纹理降采样
 * - DownsampleMaterialBuilder: 降采样材质构建
 * 
 * 调用关系:
 * - 被 MainWindow 和各个面板调用
 * - 依赖 babylon-mmd 库提供 MMD 运行时支持
 */

// 模型管理
export { ModelManager } from './ModelManager';
export type { ModelInfo } from './ModelManager';
export { ModelStateManager } from './ModelStateManager';
export type { ImportPanelState, PersistedModelData, PersistedAnimationData } from './ModelStateManager';

// 动画管理
export { AnimationManager } from './AnimationManager';
export type { AnimationInfo } from './AnimationManager';
export { CameraManager } from './CameraManager';
export type { CameraAnimationInfo } from './CameraManager';

// 相机输入控制
export { MmdCameraInputManager } from './MmdCameraInputManager';
export { MmdCameraPointersInput } from './MmdCameraPointersInput';
export { MmdCameraMouseWheelInput } from './MmdCameraMouseWheelInput';

// 跟随相机管理
export { FollowCameraManager } from './FollowCameraManager';

// 动画数据修正
export { AnimationCorrectionManager } from './AnimationCorrectionManager';

// 材质和纹理处理
export { DownsampleMaterialBuilder } from './downsampleMaterialBuilder';
export { TextureDownsampler, textureDownsampler } from './textureDownsampler';
export type { DownsampleResult } from './textureDownsampler';
