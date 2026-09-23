
import type { Scene, Material, Texture } from '@babylonjs/core';
import type { ControlDeclaration } from './IPlugin';

/** 材质参数值类型 */
export type ParamValue = number | string | boolean | { r: number; g: number; b: number } | number[];

/** 材质适配器接口 */
export interface IMaterialAdapter {
    /** 适配器唯一标识 */
    readonly typeId: string;

    /** 显示名称 */
    readonly displayName: string;

    /** 该材质类型是否支持轮廓线 */
    readonly supportsOutline: boolean;

    /** 该材质类型是否支持材质变形(morph) */
    readonly supportsMorph: boolean;

    /**
     * 该适配器是否需要创建新材质（替换原始 MmdStandardMaterial）
     * - true: 该适配器会创建新材质实例替换原始材质，着色面板将显示"渲染风格"选择器
     * - false: 该适配器仅提供参数编辑能力，不替换材质，着色面板行为不变
     */
    readonly createsMaterial: boolean;

    /** 判定给定材质是否由该适配器处理 */
    canHandle(material: Material): boolean;

    /** 从材质实例读取参数状态 */
    readState(material: Material): Record<string, ParamValue>;

    /** 将参数状态写入材质实例 */
    writeState(material: Material, state: Record<string, ParamValue>): void;

    /** 声明该材质类型的参数控件 */
    getControlDeclarations(): ControlDeclaration[];

    /** 获取参数默认值 */
    getDefaultState(): Record<string, ParamValue>;

    /** 将 MmdStandardMaterial 转换为该适配器的材质类型 */
    convertFromMmd?(
        mmdMaterial: Material,
        scene: Scene,
        textureMap?: Map<string, Texture>
    ): Material;

    /** 将该适配器的材质转换回 MmdStandardMaterial（可选，用于恢复） */
    convertToMmd?(
        material: Material,
        scene: Scene
    ): Material;

    /** 释放该适配器创建的材质资源 */
    disposeMaterial(material: Material): void;
}
