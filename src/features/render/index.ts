
/**
 * Render 渲染管理模块入口
 * 
 * 主要功能:
 * - 管理场景渲染设置
 * - 提供实时渲染和离线渲染功能
 * - 控制渲染质量和性能参数
 * 
 * 导出内容:
 * - RenderManager: 渲染管理器类
 * - RenderSettings: 渲染设置类型
 * 
 * 调用关系:
 * - 被渲染面板调用
 * - 使用 Babylon.js 渲染引擎
 */

export { RenderManager } from './RenderManager';
export type { RenderSettings } from '../../UIComponents/RenderUI';
