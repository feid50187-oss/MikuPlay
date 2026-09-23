
import type { Scene, Camera } from '@babylonjs/core';
import type { ControlDeclaration } from './IPlugin';
import type { ParamValue } from './IMaterialAdapter';

/**
 * 后处理适配器接口
 *
 * 后处理插件通过实现此接口来注册自定义后处理效果。
 * 每个适配器代表一种后处理效果，可独立启用/禁用。
 */
export interface IPostProcessAdapter {
    /** 适配器唯一标识，全局唯一 */
    readonly typeId: string;

    /** 显示名称，出现在后处理面板的效果区域标题 */
    readonly displayName: string;

    /**
     * 管线顺序，值越小越先执行。
     * 内置效果基准值：
     *   0  = FXAA / MSAA
     *   10 = ImageProcessing (曝光/饱和度/对比度)
     *   20 = Bloom
     *   30 = DOF
     * 插件可在任意间隙插入，如 25 表示在 Bloom 之后、DOF 之前执行。
     */
    readonly order: number;

    /** 声明参数控件 */
    getControlDeclarations(): ControlDeclaration[];

    /** 获取参数默认值 */
    getDefaultState(): Record<string, ParamValue>;

    /** 读取当前参数状态 */
    readState(): Record<string, ParamValue>;

    /** 写入参数状态 */
    writeState(state: Record<string, ParamValue>): void;

    /** 初始化后处理效果（创建 PostProcess 并附加到相机） */
    initialize(scene: Scene, camera: Camera): void;

    /** 是否已初始化 */
    isInitialized(): boolean;

    /** 启用/禁用效果 */
    setEnabled(enabled: boolean): void;

    /** 当前是否启用 */
    isEnabled(): boolean;

    /** 释放所有资源 */
    dispose(): void;
}
