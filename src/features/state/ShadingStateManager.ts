
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Material } from '@babylonjs/core/Materials/material';
import type { ParamValue } from '../../core/IMaterialAdapter';
import { StateStore } from './StateStore';
import { Events } from '../../core';

export type SpaBlendMode = 'off' | 'multiply' | 'add';
export type AlphaBlendMode = 'opaque' | 'alphaTest' | 'alphaBlend' | 'alphaTestAndBlend';
export type CullMode = 'doubleSided' | 'front' | 'back';

export interface Color3State {
    r: number;
    g: number;
    b: number;
}

/**
 * MMD 标准材质控制状态（旧格式，保留向后兼容）
 * @deprecated 新代码应使用 MaterialState
 */
export interface MaterialControlState {
    diffuse: Color3State;
    ambient: Color3State;
    specular: Color3State;
    emissive: Color3State;
    emissiveIntensity: number;
    shininess: number;
    alpha: number;
    alphaBlendMode: AlphaBlendMode;
    cullMode: CullMode;
    spaMode: SpaBlendMode;
    isVisible: boolean;
}

/** 通用材质状态（替代原 MaterialControlState） */
export interface MaterialState {
    adapterTypeId: string;
    params: Record<string, ParamValue>;
    isVisible: boolean;
}

interface MaterialStateEntry {
    state: MaterialState;
    savedSpaTexture: Texture | null;
    originalOutlineWidth: number;
    originalOutlineColor: Color3State;
    originalOutlineAlpha: number;
    originalRenderOutline: boolean;
    originalMmdMaterial: Material | null;
    convertedMaterial: Material | null;
}

interface ModelOutlineState {
    outlineWidth: number;
}

export interface ShadingState {
    materialStates: Map<string, Map<number, MaterialStateEntry>>;
    selectedMaterialIndices: Map<string, number>;
    modelOutlineStates: Map<string, ModelOutlineState>;
    modelRenderStyles: Map<string, string>;
}

function getDefaultShadingState(): ShadingState {
    return {
        materialStates: new Map(),
        selectedMaterialIndices: new Map(),
        modelOutlineStates: new Map(),
        modelRenderStyles: new Map()
    };
}

/** 将 MaterialState 转换为 MaterialControlState（MMD 适配器专用） */
function materialStateToControlState(state: MaterialState): MaterialControlState {
    const p = state.params;
    return {
        diffuse: (p.diffuse as Color3State) ?? { r: 1, g: 1, b: 1 },
        ambient: (p.ambient as Color3State) ?? { r: 0, g: 0, b: 0 },
        specular: (p.specular as Color3State) ?? { r: 0, g: 0, b: 0 },
        emissive: (p.emissive as Color3State) ?? { r: 0, g: 0, b: 0 },
        emissiveIntensity: (p.emissiveIntensity as number) ?? 1,
        shininess: (p.shininess as number) ?? 64,
        alpha: (p.alpha as number) ?? 1,
        alphaBlendMode: (p.alphaBlendMode as AlphaBlendMode) ?? 'alphaBlend',
        cullMode: (p.cullMode as CullMode) ?? 'back',
        spaMode: (p.spaMode as SpaBlendMode) ?? 'off',
        isVisible: state.isVisible
    };
}

/** 将 MaterialControlState 转换为 MaterialState（MMD 适配器） */
function controlStateToMaterialState(state: MaterialControlState): MaterialState {
    return {
        adapterTypeId: 'mmd-standard',
        params: {
            diffuse: { ...state.diffuse },
            ambient: { ...state.ambient },
            specular: { ...state.specular },
            emissive: { ...state.emissive },
            emissiveIntensity: state.emissiveIntensity,
            shininess: state.shininess,
            alpha: state.alpha,
            alphaBlendMode: state.alphaBlendMode,
            cullMode: state.cullMode,
            spaMode: state.spaMode
        },
        isVisible: state.isVisible
    };
}

export class ShadingStateManager extends StateStore<ShadingState> {
    private static instance: ShadingStateManager;

    protected state: ShadingState = getDefaultShadingState();

    private constructor() {
        super();
    }

    static getInstance(): ShadingStateManager {
        if (!ShadingStateManager.instance) {
            ShadingStateManager.instance = new ShadingStateManager();
        }
        return ShadingStateManager.instance;
    }

    static resetInstance(): void {
        ShadingStateManager.instance = undefined as any;
    }

    getState(): Readonly<ShadingState> {
        return this.state;
    }

    // ===== MaterialState (新 API) =====

    /** 获取通用材质状态 */
    public getMaterialStateNew(modelId: string, materialIndex: number): MaterialState | null {
        const modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) return null;
        const entry = modelMaterials.get(materialIndex);
        if (!entry) return null;
        return {
            adapterTypeId: entry.state.adapterTypeId,
            params: { ...entry.state.params },
            isVisible: entry.state.isVisible
        };
    }

    /** 设置通用材质状态 */
    public setMaterialStateNew(modelId: string, materialIndex: number, state: MaterialState): void {
        let modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) {
            modelMaterials = new Map();
            this.state.materialStates.set(modelId, modelMaterials);
        }
        const existing = modelMaterials.get(materialIndex);
        modelMaterials.set(materialIndex, {
            state: {
                adapterTypeId: state.adapterTypeId,
                params: { ...state.params },
                isVisible: state.isVisible
            },
            savedSpaTexture: existing?.savedSpaTexture ?? null,
            originalOutlineWidth: existing?.originalOutlineWidth ?? 0,
            originalOutlineColor: existing?.originalOutlineColor ?? { r: 0, g: 0, b: 0 },
            originalOutlineAlpha: existing?.originalOutlineAlpha ?? 1,
            originalRenderOutline: existing?.originalRenderOutline ?? false,
            originalMmdMaterial: existing?.originalMmdMaterial ?? null,
            convertedMaterial: existing?.convertedMaterial ?? null
        });
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    /** 更新通用材质状态（部分更新） */
    public updateMaterialStateNew(modelId: string, materialIndex: number, partial: Partial<MaterialState>): void {
        const current = this.getMaterialStateNew(modelId, materialIndex);
        if (current) {
            this.setMaterialStateNew(modelId, materialIndex, {
                ...current,
                ...partial,
                params: partial.params ? { ...current.params, ...partial.params } : current.params
            });
        } else {
            this.setMaterialStateNew(modelId, materialIndex, {
                adapterTypeId: partial.adapterTypeId ?? 'mmd-standard',
                params: partial.params ?? {},
                isVisible: partial.isVisible ?? true
            });
        }
    }

    // ===== MaterialControlState (旧 API，向后兼容) =====

    /** @deprecated 使用 getMaterialStateNew */
    public getMaterialState(modelId: string, materialIndex: number): MaterialControlState | null {
        const state = this.getMaterialStateNew(modelId, materialIndex);
        if (!state) return null;
        return materialStateToControlState(state);
    }

    /** @deprecated 使用 setMaterialStateNew */
    public setMaterialState(modelId: string, materialIndex: number, state: MaterialControlState): void {
        this.setMaterialStateNew(modelId, materialIndex, controlStateToMaterialState(state));
    }

    /** @deprecated 使用 updateMaterialStateNew */
    public updateMaterialState(modelId: string, materialIndex: number, partial: Partial<MaterialControlState>): void {
        const current = this.getMaterialState(modelId, materialIndex);
        if (current) {
            this.setMaterialState(modelId, materialIndex, { ...current, ...partial });
        } else {
            this.setMaterialState(modelId, materialIndex, {
                diffuse: partial.diffuse ?? { r: 1, g: 1, b: 1 },
                ambient: partial.ambient ?? { r: 0, g: 0, b: 0 },
                specular: partial.specular ?? { r: 0, g: 0, b: 0 },
                emissive: partial.emissive ?? { r: 0, g: 0, b: 0 },
                emissiveIntensity: partial.emissiveIntensity ?? 1,
                shininess: partial.shininess ?? 64,
                alpha: partial.alpha ?? 1,
                alphaBlendMode: partial.alphaBlendMode ?? 'alphaBlend',
                cullMode: partial.cullMode ?? 'back',
                spaMode: partial.spaMode ?? 'off',
                isVisible: partial.isVisible ?? true
            });
        }
    }

    // ===== SPA 贴图 =====

    public getSavedSpaTexture(modelId: string, materialIndex: number): Texture | null {
        const modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) return null;
        const entry = modelMaterials.get(materialIndex);
        return entry?.savedSpaTexture ?? null;
    }

    public setSavedSpaTexture(modelId: string, materialIndex: number, texture: Texture | null): void {
        let modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) {
            modelMaterials = new Map();
            this.state.materialStates.set(modelId, modelMaterials);
        }
        const existing = modelMaterials.get(materialIndex);
        if (existing) {
            existing.savedSpaTexture = texture;
        } else {
            modelMaterials.set(materialIndex, {
                state: this.getDefaultMaterialState(),
                savedSpaTexture: texture,
                originalOutlineWidth: 0,
                originalOutlineColor: { r: 0, g: 0, b: 0 },
                originalOutlineAlpha: 1,
                originalRenderOutline: false,
                originalMmdMaterial: null,
                convertedMaterial: null
            });
        }
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    // ===== 描边属性 =====

    public setOriginalOutlineProperties(
        modelId: string,
        materialIndex: number,
        width: number,
        color: Color3State,
        alpha: number,
        renderOutline: boolean
    ): void {
        let modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) {
            modelMaterials = new Map();
            this.state.materialStates.set(modelId, modelMaterials);
        }
        const existing = modelMaterials.get(materialIndex);
        if (existing) {
            existing.originalOutlineWidth = width;
            existing.originalOutlineColor = color;
            existing.originalOutlineAlpha = alpha;
            existing.originalRenderOutline = renderOutline;
        } else {
            modelMaterials.set(materialIndex, {
                state: this.getDefaultMaterialState(),
                savedSpaTexture: null,
                originalOutlineWidth: width,
                originalOutlineColor: color,
                originalOutlineAlpha: alpha,
                originalRenderOutline: renderOutline,
                originalMmdMaterial: null,
                convertedMaterial: null
            });
        }
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    public getOriginalOutlineProperties(
        modelId: string,
        materialIndex: number
    ): { width: number; color: Color3State; alpha: number; renderOutline: boolean } | null {
        const modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) return null;
        const entry = modelMaterials.get(materialIndex);
        if (!entry) return null;
        return {
            width: entry.originalOutlineWidth,
            color: { ...entry.originalOutlineColor },
            alpha: entry.originalOutlineAlpha,
            renderOutline: entry.originalRenderOutline
        };
    }

    // ===== 选中材质 =====

    public getSelectedMaterialIndex(modelId: string): number | null {
        return this.state.selectedMaterialIndices.get(modelId) ?? null;
    }

    public setSelectedMaterialIndex(modelId: string, index: number | null): void {
        if (index === null) {
            this.state.selectedMaterialIndices.delete(modelId);
        } else {
            this.state.selectedMaterialIndices.set(modelId, index);
        }
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    // ===== 模型描边 =====

    public getModelOutlineState(modelId: string): ModelOutlineState | null {
        return this.state.modelOutlineStates.get(modelId) ?? null;
    }

    public setModelOutlineState(modelId: string, state: ModelOutlineState): void {
        this.state.modelOutlineStates.set(modelId, state);
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    public updateModelOutlineWidth(modelId: string, outlineWidth: number): void {
        const current = this.state.modelOutlineStates.get(modelId);
        if (current) {
            current.outlineWidth = outlineWidth;
        } else {
            this.state.modelOutlineStates.set(modelId, { outlineWidth });
        }
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    // ===== 渲染风格 =====

    /** 获取模型当前渲染风格 */
    public getRenderStyle(modelId: string): string {
        return this.state.modelRenderStyles.get(modelId) ?? 'mmd-standard';
    }

    /** 设置模型渲染风格 */
    public setRenderStyle(modelId: string, adapterTypeId: string): void {
        this.state.modelRenderStyles.set(modelId, adapterTypeId);
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    /** 移除模型渲染风格记录 */
    public removeRenderStyle(modelId: string): void {
        this.state.modelRenderStyles.delete(modelId);
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    // ===== 原始 MMD 材质保存/恢复 =====

    /** 保存原始 MMD 材质引用（用于风格切换后恢复） */
    public saveOriginalMmdMaterial(modelId: string, materialIndex: number, material: Material): void {
        let modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) {
            modelMaterials = new Map();
            this.state.materialStates.set(modelId, modelMaterials);
        }
        const existing = modelMaterials.get(materialIndex);
        if (existing) {
            // 仅当尚未保存原版时才写入，避免后续风格切换错误覆盖真正的 MMD 材质
            if (!existing.originalMmdMaterial) {
                existing.originalMmdMaterial = material;
            }
        } else {
            modelMaterials.set(materialIndex, {
                state: this.getDefaultMaterialState(),
                savedSpaTexture: null,
                originalOutlineWidth: 0,
                originalOutlineColor: { r: 0, g: 0, b: 0 },
                originalOutlineAlpha: 1,
                originalRenderOutline: false,
                originalMmdMaterial: material,
                convertedMaterial: null
            });
        }
    }

    /** 获取保存的原始 MMD 材质引用 */
    public getOriginalMmdMaterial(modelId: string, materialIndex: number): Material | null {
        const modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) return null;
        const entry = modelMaterials.get(materialIndex);
        return entry?.originalMmdMaterial ?? null;
    }

    /** 设置转换后的材质引用 */
    public setConvertedMaterial(modelId: string, materialIndex: number, material: Material | null): void {
        let modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) {
            modelMaterials = new Map();
            this.state.materialStates.set(modelId, modelMaterials);
        }
        const existing = modelMaterials.get(materialIndex);
        if (existing) {
            existing.convertedMaterial = material;
        } else {
            modelMaterials.set(materialIndex, {
                state: this.getDefaultMaterialState(),
                savedSpaTexture: null,
                originalOutlineWidth: 0,
                originalOutlineColor: { r: 0, g: 0, b: 0 },
                originalOutlineAlpha: 1,
                originalRenderOutline: false,
                originalMmdMaterial: null,
                convertedMaterial: material
            });
        }
    }

    /** 获取转换后的材质引用 */
    public getConvertedMaterial(modelId: string, materialIndex: number): Material | null {
        const modelMaterials = this.state.materialStates.get(modelId);
        if (!modelMaterials) return null;
        const entry = modelMaterials.get(materialIndex);
        return entry?.convertedMaterial ?? null;
    }

    // ===== 模型移除 =====

    public removeModel(modelId: string): void {
        this.state.materialStates.delete(modelId);
        this.state.selectedMaterialIndices.delete(modelId);
        this.state.modelOutlineStates.delete(modelId);
        this.state.modelRenderStyles.delete(modelId);
        this.update({}, Events.SHADING_MATERIAL_CHANGED);
    }

    // ===== 内部辅助 =====

    private getDefaultMaterialState(): MaterialState {
        return {
            adapterTypeId: 'mmd-standard',
            params: {
                diffuse: { r: 1, g: 1, b: 1 },
                ambient: { r: 0, g: 0, b: 0 },
                specular: { r: 0, g: 0, b: 0 },
                emissive: { r: 0, g: 0, b: 0 },
                emissiveIntensity: 1,
                shininess: 64,
                alpha: 1,
                alphaBlendMode: 'alphaBlend',
                cullMode: 'back',
                spaMode: 'off'
            },
            isVisible: true
        };
    }
}

export const shadingStateManager = ShadingStateManager.getInstance();
