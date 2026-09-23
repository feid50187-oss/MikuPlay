
/**
 * Scene 场景管理模块入口
 * 
 * 主要功能:
 * - 管理 Babylon.js 场景的创建和配置
 * - 提供网格、灯光、后期处理等管理功能
 * - 支持场景状态的保存和恢复
 * 
 * 导出内容分类:
 * 
 * 1. 管理器类:
 * - SceneManager: 场景管理器
 * - GridManager: 网格管理器
 * - LightManager: 灯光管理器
 * - PostProcessManager: 后期处理管理器
 * 
 * 2. 类型定义:
 * - SceneConfig: 场景配置
 * - LightConfig: 灯光配置
 * - SceneState: 场景状态
 * - SceneEventType: 场景事件类型
 * - SceneEventCallback: 场景事件回调
 * - ISceneManager: 场景管理器接口
 * - IGridManager: 网格管理器接口
 * - ILightManager: 灯光管理器接口
 * - WorkerMessage: Worker 消息类型
 * - WorkerResponse: Worker 响应类型
 * - WorkerMessageType: Worker 消息类型枚举
 * 
 * 调用关系:
 * - 被 MainWindow 和各个面板调用
 * - 使用 Babylon.js 场景系统
 * - 使用 Web Worker 进行后台处理
 */

export { SceneManager } from './SceneManager';
export { GridManager } from './GridManager';
export { LightManager } from './LightManager';
export { PostProcessManager } from './PostProcessManager';
export type {
    SceneConfig,
    LightConfig,
    SceneState,
    SceneEventType,
    SceneEventCallback,
    ISceneManager,
    IGridManager,
    ILightManager,
    WorkerMessage,
    WorkerResponse,
    WorkerMessageType
} from './types';
