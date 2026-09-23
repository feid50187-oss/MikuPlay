
/**
 * Performance 性能监控模块入口
 * 
 * 主要功能:
 * - 提供性能监控和统计功能
 * - 跟踪 FPS、内存使用、渲染时间等指标
 * 
 * 导出内容:
 * - PerformanceMonitor: 性能监控器类
 * 
 * 调用关系:
 * - 被主窗口和调试工具调用
 * - 使用 Babylon.js 内置性能分析工具
 */

export { PerformanceMonitor } from './PerformanceMonitor';
