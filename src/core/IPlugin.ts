
import type { Scene, Engine } from '@babylonjs/core';
import type { EventBus } from './EventBus';
import type { IMaterialAdapter } from './IMaterialAdapter';
import type { IPostProcessAdapter } from './IPostProcessAdapter';
import type { ModelManager } from '../features/mmd/ModelManager';
import type { AnimationManager } from '../features/mmd/AnimationManager';
import type { MusicManager } from '../features/audio/MusicManager';

export interface SliderControlDeclaration {
    param: string;
    type: 'slider';
    label: string;
    min: number;
    max: number;
    step: number;
    group?: string;
}

export interface ColorControlDeclaration {
    param: string;
    type: 'color';
    label: string;
    group?: string;
}

export interface VectorControlDeclaration {
    param: string;
    type: 'vector';
    label: string;
    group?: string;
}

export interface DropdownControlDeclaration {
    param: string;
    type: 'dropdown';
    label: string;
    options: string[];
    optionLabels?: string[];
    group?: string;
}

export interface ToggleControlDeclaration {
    param: string;
    type: 'toggle';
    label: string;
    group?: string;
}

export interface TextureControlDeclaration {
    param: string;
    type: 'texture';
    label: string;
    group?: string;
}

export type ControlDeclaration =
    | SliderControlDeclaration
    | ColorControlDeclaration
    | VectorControlDeclaration
    | DropdownControlDeclaration
    | ToggleControlDeclaration
    | TextureControlDeclaration;

/** 功能型插件的作用模块（target） */
export type PluginTarget = 'ground' | 'particle' | 'shading' | 'postproc' | 'background';

export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    type: 'functional' | 'ui';
    target?: PluginTarget;
    mount?: 'tab' | 'overlay';
    author?: string;
    description?: string;
}

export interface ParticleRenderConfig {
    textureSource: string;
    texture: string;
    blendMode: string;
    depthWrite: boolean;
    enableRotation: boolean;
    defaultMaxParticles: number;
}

export interface PluginPreset {
    name: string;
    defaultParams: Record<string, unknown>;
    controls: ControlDeclaration[];
    renderConfig?: ParticleRenderConfig;
}

export interface IGroundPluginInstance {
    create(scene: Scene, scale: number, height: number): void;
    dispose(): void;
    setScale(scale: number): void;
    setHeight(height: number): void;
    createPrivateParams?(): HTMLElement;
}

export interface FunctionalPluginExports {
    preset: PluginPreset;
    createInstance?: () => IGroundPluginInstance;
    onActivate?: (ctx: PluginContext) => void | Promise<void>;
    onDeactivate?: (ctx: PluginContext) => void | Promise<void>;
    dispose?: () => void | Promise<void>;
}

export interface UIPluginExports {
    createPanel: (ctx: PluginContext) => HTMLElement;
    onShown?: () => void;
    onHidden?: () => void;
    dispose?: () => void | Promise<void>;
}

export interface ShadingPluginExports {
    /** 材质适配器实例 */
    adapter: IMaterialAdapter;

    /** 插件激活时调用（注册适配器） */
    onActivate?: (ctx: PluginContext) => void | Promise<void>;

    /** 插件停用时调用（注销适配器） */
    onDeactivate?: (ctx: PluginContext) => void | Promise<void>;

    /** 释放资源 */
    dispose?: () => void | Promise<void>;
}

export interface PostProcessPluginExports {
    /** 后处理适配器实例 */
    adapter: IPostProcessAdapter;

    /** 插件激活时调用 */
    onActivate?: (ctx: PluginContext) => void | Promise<void>;

    /** 插件停用时调用 */
    onDeactivate?: (ctx: PluginContext) => void | Promise<void>;

    /** 释放资源 */
    dispose?: () => void | Promise<void>;
}

export type PluginExports = FunctionalPluginExports | UIPluginExports | ShadingPluginExports | PostProcessPluginExports;

export interface PluginEntry {
    manifest: PluginManifest;
    data: PluginExports;
    enabled: boolean;
    builtIn?: boolean;
}

export interface PluginAppContext {
    getScene(): Scene;
    getEngine(): Engine;
    /** 动画管理器（黑名单模式下返回真实实例，插件可自由访问动画数据） */
    getAnimationManager(): AnimationManager | null;
    /** 音乐管理器（黑名单模式下返回真实实例） */
    getMusicManager(): MusicManager | null;
    /** 模型管理器（黑名单模式下返回真实实例，插件可自由访问模型数据） */
    getModelManager(): ModelManager | null;
}

export interface PluginContext {
    scene: Scene;
    engine: Engine;
    eventBus: EventBus;
    storage: import('./PluginStorage').PluginStorage;
    assetsDir: string;
    app: PluginAppContext;
}

export interface RegistryEntry {
    version: string;
    enabled: boolean;
    installedAt: string;
}

export interface PluginRegistryData {
    plugins: Record<string, RegistryEntry>;
}
