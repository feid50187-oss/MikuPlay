import type { MainWindow } from '../../MainWindow';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { DropdownControlDeclaration } from '../../../core/IPlugin';
import { CollapsibleSection, Slider, Dropdown } from '../../shared';
import { shadingStateManager } from '../../../features/state';
import { materialAdapterRegistry } from '../../../features/shading/MaterialAdapterRegistry';
import { MmdStandardMaterial } from 'babylon-mmd/esm/Loader/mmdStandardMaterial';
import { MmdPluginMaterialSphereTextureBlendMode } from 'babylon-mmd/esm/Loader/mmdPluginMaterial';
import { Material as BabylonMaterial } from '@babylonjs/core/Materials/material';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Events, eventBus } from '../../../core';

interface DropdownOption {
    value: string;
    label: string;
}

/** 当前渲染风格对应的控件模式 */
type StyleMode = 'mmd-standard' | 'pbr-advanced';

export class ShadingSection {
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private shadingSection: CollapsibleSection;
    private controlsWrapper: HTMLElement;
    private currentMode: StyleMode = 'mmd-standard';
    private updatingState = false;
    private unsubStyleChanged: (() => void) | null = null;

    // MMD 标准控件的实例引用（已创建，用于 dispose）
    private outlineSlider!: Slider;
    private alphaDropdown!: Dropdown;
    private spaDropdown!: Dropdown;
    private shaderDropdown!: Dropdown;
    private toonSampleSlider!: Slider;
    private toonBlendSlider!: Slider;

    // PBR 控件的实例引用
    private pbrIblIntensity: Slider | null = null;
    private pbrIblRotation: Slider | null = null;
    private pbrMetallic: Slider | null = null;
    private pbrRoughness: Slider | null = null;
    private pbrIor: Slider | null = null;
    private pbrEmissiveIntensity: Slider | null = null;
    private pbrAlpha: Slider | null = null;
    private pbrAlphaBlend: Dropdown | null = null;

    constructor(options: { mainWindow: MainWindow | null }) {
        this.mainWindow = options.mainWindow;

        // 构建 MMD 标准控件（始终创建，按模式显示/隐藏）
        this.buildMmdControls();

        // 控件容器
        this.controlsWrapper = document.createElement('div');
        this.controlsWrapper.className = 'shortcut-controls';

        // 全局提示文本
        const globalHint = document.createElement('div');
        globalHint.className = 'shortcut-global-hint';
        globalHint.textContent = '此处所有设置影响全局，用于减少重复操作';

        // Collapsible section
        this.shadingSection = new CollapsibleSection({
            title: '全材质调整',
            initiallyExpanded: false
        });
        const contentContainer = this.shadingSection.getContentContainer();
        contentContainer.appendChild(globalHint);
        contentContainer.appendChild(this.controlsWrapper);

        // 展开时允许内容溢出（下拉框等）
        this.shadingSection.onChange((expanded) => {
            this.shadingSection.element.classList.toggle('overflow-visible', expanded);
        });

        this.element = this.shadingSection.element;

        // 首次构建控件
        this.rebuildForCurrentStyle();

        // 监听渲染风格变化
        this.unsubStyleChanged = eventBus.on(Events.SHADING_MATERIAL_CHANGED, () => {
            this.rebuildForCurrentStyle();
        });
    }

    /** 根据当前渲染风格重建控件 */
    private rebuildForCurrentStyle(): void {
        const newMode = this.detectStyleMode();
        if (newMode === this.currentMode && this.controlsWrapper.children.length > 0) {
            // 模式未变且已有控件，仅更新值
            if (newMode === 'pbr-advanced') {
                this.syncPbrValues();
            }
            return;
        }

        this.currentMode = newMode;
        this.clearControls();
        this.buildControlsForMode(this.currentMode);
    }

    /** 检测当前渲染风格 */
    private detectStyleMode(): StyleMode {
        const firstEntry = this.getFirstMmdModelEntry();
        if (!firstEntry) return 'mmd-standard';

        const [modelId] = firstEntry;
        const style = shadingStateManager.getRenderStyle(modelId);
        if (style === 'pbr-advanced') return 'pbr-advanced';
        return 'mmd-standard';
    }

    /** 清空控件容器并 dispose 旧控件 */
    private clearControls(): void {
        this.controlsWrapper.innerHTML = '';
        // PBR 控件引用置空（MMD 控件始终保留引用）
        this.pbrIblIntensity = null;
        this.pbrIblRotation = null;
        this.pbrMetallic = null;
        this.pbrRoughness = null;
        this.pbrIor = null;
        this.pbrEmissiveIntensity = null;
        this.pbrAlpha = null;
        this.pbrAlphaBlend = null;
    }

    /** 为指定模式构建控件 */
    private buildControlsForMode(mode: StyleMode): void {
        if (mode === 'pbr-advanced') {
            this.buildPbrControls();
        } else {
            this.appendMmdControls();
        }
    }

    // ===== MMD 标准控件 =====

    private buildMmdControls(): void {
        const outlineState = this.readOutlineState();
        this.outlineSlider = new Slider({
            label: '描边宽度',
            min: 0,
            max: 2,
            step: 0.01,
            value: outlineState,
            showValue: true
        });
        this.outlineSlider.onChange((value) => {
            this.applyOutlineWidthToAllModels(value);
        });

        const alphaOptions: DropdownOption[] = [
            { value: 'opaque', label: '不透明' },
            { value: 'alphaTest', label: 'Alpha测试' },
            { value: 'alphaBlend', label: 'Alpha混合' },
            { value: 'alphaTestAndBlend', label: '测试+混合' }
        ];
        this.alphaDropdown = new Dropdown({
            options: alphaOptions.map(o => ({ label: o.label, value: o.value })),
            selectedValue: this.readAlphaModeFromAllModels() || 'opaque',
            label: '混合模式'
        });
        this.alphaDropdown.onChange((value) => {
            this.applyAlphaModeToAllModels(value);
        });

        const spaOptions: DropdownOption[] = [
            { value: 'off', label: '关闭' },
            { value: 'multiply', label: '乘算' },
            { value: 'add', label: '加算' },
            { value: 'subTexture', label: '副纹理' }
        ];
        this.spaDropdown = new Dropdown({
            options: spaOptions.map(o => ({ label: o.label, value: o.value })),
            selectedValue: this.readSpaModeFromAllModels() || 'add',
            label: 'SPA纹理'
        });
        this.spaDropdown.onChange((value) => {
            this.applySpaModeToAllModels(value);
        });

        const shaderOpts = this.getShaderDropdownOptions();
        this.shaderDropdown = new Dropdown({
            options: shaderOpts.map(o => ({ label: o.label, value: o.value })),
            selectedValue: this.readShaderFromAllModels(),
            label: 'Shader'
        });
        this.shaderDropdown.onChange((value) => {
            this.applyShaderToAllModels(value);
        });

        const toonSampleState = this.readToonSampleThresholdFromAllModels();
        this.toonSampleSlider = new Slider({
            label: '采样阈值',
            min: 0,
            max: 1,
            step: 0.01,
            value: toonSampleState,
            showValue: true
        });
        this.toonSampleSlider.onChange((value) => {
            this.applyToonSampleThresholdToAllModels(value);
        });

        const toonBlendState = this.readToonBlendThresholdFromAllModels();
        this.toonBlendSlider = new Slider({
            label: '混合阈值',
            min: 0.2,
            max: 0.4,
            step: 0.001,
            value: toonBlendState,
            showValue: true
        });
        this.toonBlendSlider.onChange((value) => {
            this.applyToonBlendThresholdToAllModels(value);
        });
    }

    private appendMmdControls(): void {
        this.controlsWrapper.appendChild(this.outlineSlider.element);
        this.controlsWrapper.appendChild(this.alphaDropdown.element);
        this.controlsWrapper.appendChild(this.spaDropdown.element);
        this.controlsWrapper.appendChild(this.shaderDropdown.element);
        this.controlsWrapper.appendChild(this.toonSampleSlider.element);
        this.controlsWrapper.appendChild(this.toonBlendSlider.element);
    }

    // ===== PBR 控件 =====

        private buildPbrControls(): void {
        // IBL 强度
        const iblIntensity = this.readPbrValue('environmentIntensity', 0.5);
        this.pbrIblIntensity = new Slider({
            label: 'IBL强度',
            min: 0,
            max: 1,
            step: 0.01,
            value: iblIntensity,
            showValue: true
        });
        this.pbrIblIntensity.onChange((value) => {
            this.applyPbrValueToAllModels('environmentIntensity', value);
        });
        this.controlsWrapper.appendChild(this.pbrIblIntensity.element);

        // IBL 旋转
        const iblRotation = this.readPbrValue('iblRotationY', 0);
        this.pbrIblRotation = new Slider({
            label: 'IBL旋转',
            min: 0,
            max: 6.28,
            step: 0.01,
            value: iblRotation,
            showValue: true
        });
        this.pbrIblRotation.onChange((value) => {
            this.applyPbrValueToAllModels('iblRotationY', value);
        });
        this.controlsWrapper.appendChild(this.pbrIblRotation.element);

        // 金属度
        const metallic = this.readPbrValue('metallic', 0);
        this.pbrMetallic = new Slider({
            label: '金属度',
            min: 0,
            max: 1,
            step: 0.01,
            value: metallic,
            showValue: true
        });
        this.pbrMetallic.onChange((value) => {
            this.applyPbrValueToAllModels('metallic', value);
        });
        this.controlsWrapper.appendChild(this.pbrMetallic.element);

        // 粗糙度
        const roughness = this.readPbrValue('roughness', 0.5);
        this.pbrRoughness = new Slider({
            label: '粗糙度',
            min: 0,
            max: 1,
            step: 0.01,
            value: roughness,
            showValue: true
        });
        this.pbrRoughness.onChange((value) => {
            this.applyPbrValueToAllModels('roughness', value);
        });
        this.controlsWrapper.appendChild(this.pbrRoughness.element);

        // 折射率
        const ior = this.readPbrValue('indexOfRefraction', 1.5);
        this.pbrIor = new Slider({
            label: '折射率',
            min: 1,
            max: 2.5,
            step: 0.01,
            value: ior,
            showValue: true
        });
        this.pbrIor.onChange((value) => {
            this.applyPbrValueToAllModels('indexOfRefraction', value);
        });
        this.controlsWrapper.appendChild(this.pbrIor.element);

        // 自发光强度
        const emissiveIntensity = this.readPbrValue('emissiveIntensity', 0);
        this.pbrEmissiveIntensity = new Slider({
            label: '自发光',
            min: 0,
            max: 1,
            step: 0.01,
            value: emissiveIntensity,
            showValue: true
        });
        this.pbrEmissiveIntensity.onChange((value) => {
            this.applyPbrValueToAllModels('emissiveIntensity', value);
        });
        this.controlsWrapper.appendChild(this.pbrEmissiveIntensity.element);

        // Alpha
        const alpha = this.readPbrValue('alpha', 1);
        this.pbrAlpha = new Slider({
            label: 'Alpha',
            min: 0,
            max: 1,
            step: 0.01,
            value: alpha,
            showValue: true
        });
        this.pbrAlpha.onChange((value) => {
            this.applyPbrValueToAllModels('alpha', value);
        });
        this.controlsWrapper.appendChild(this.pbrAlpha.element);

        // 混合模式
        const alphaBlend = this.readPbrAlphaBlend();
        this.pbrAlphaBlend = new Dropdown({
            options: [
                { label: '不透明', value: 'opaque' },
                { label: 'Alpha测试', value: 'alphaTest' },
                { label: 'Alpha混合', value: 'alphaBlend' },
                { label: '测试+混合', value: 'alphaTestAndBlend' }
            ],
            selectedValue: alphaBlend,
            label: '混合模式'
        });
        this.pbrAlphaBlend.onChange((value) => {
            this.applyPbrAlphaBlendToAllModels(value);
        });
        this.controlsWrapper.appendChild(this.pbrAlphaBlend.element);
    }

    private syncPbrValues(): void {
        if (this.updatingState) return;
        this.updatingState = true;
        try {
            this.pbrIblIntensity?.setValue(this.readPbrValue('environmentIntensity', 0.5)); 
            this.pbrIblRotation?.setValue(this.readPbrValue('iblRotationY', 0));
            this.pbrMetallic?.setValue(this.readPbrValue('metallic', 0));
            this.pbrRoughness?.setValue(this.readPbrValue('roughness', 0.5));
            this.pbrIor?.setValue(this.readPbrValue('indexOfRefraction', 1.5));
            this.pbrEmissiveIntensity?.setValue(this.readPbrValue('emissiveIntensity', 0));
            this.pbrAlpha?.setValue(this.readPbrValue('alpha', 1));
            this.pbrAlphaBlend?.setValue(this.readPbrAlphaBlend());
        } finally {
            this.updatingState = false;
        }
    }

    // ===== PBR 值读取 =====

    private readPbrValue(param: string, defaultValue: number): number {
        const entries = this.getAllMmdModelEntries();
        for (const [_, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;
            for (const material of materials) {
                if (material instanceof PBRMaterial) {
                    switch (param) {
                        case 'environmentIntensity': return material.environmentIntensity;
                        case 'iblRotationY': {
                            const scene = material.getScene();
                            const envTex = scene?.environmentTexture as any;
                            return envTex?.rotationY ?? 0;
                        }
                        case 'metallic': return material.metallic ?? 0;
                        case 'roughness': return material.roughness ?? 0.5;
                        case 'indexOfRefraction': return material.indexOfRefraction ?? 1.5;
                        case 'emissiveIntensity': return material.emissiveIntensity ?? 0;
                        case 'alpha': return material.alpha;
                    }
                }
            }
        }
        return defaultValue;
    }

    private readPbrAlphaBlend(): string {
        const entries = this.getAllMmdModelEntries();
        for (const [_, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;
            for (const material of materials) {
                if (material instanceof PBRMaterial) {
                    const mode = material.transparencyMode;
                    if (mode === BabylonMaterial.MATERIAL_ALPHATEST) return 'alphaTest';
                    if (mode === BabylonMaterial.MATERIAL_ALPHABLEND) return 'alphaBlend';
                    if (mode === BabylonMaterial.MATERIAL_ALPHATESTANDBLEND) return 'alphaTestAndBlend';
                    return 'opaque';
                }
            }
        }
        return 'opaque';
    }

    // ===== PBR 值全局应用 =====

    private applyPbrValueToAllModels(param: string, value: number): void {
        const entries = this.getAllMmdModelEntries();
        for (const [modelId, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;
            for (let i = 0; i < materials.length; i++) {
                const material = materials[i];
                if (material instanceof PBRMaterial) {
                    switch (param) {
                        case 'environmentIntensity':
                            material.environmentIntensity = value;
                            break;
                        case 'iblRotationY': {
                            const scene = material.getScene();
                            const envTex = material.getScene()?.environmentTexture as any;
                            if (envTex) envTex.rotationY = value;
                            break;
                        }
                        case 'metallic':
                            material.metallic = value;
                            break;
                        case 'roughness':
                            material.roughness = value;
                            break;
                        case 'indexOfRefraction':
                            material.indexOfRefraction = value;
                            break;
                        case 'emissiveIntensity':
                            material.emissiveIntensity = value;
                            break;
                        case 'alpha':
                            material.alpha = value;
                            break;
                    }
                    shadingStateManager.updateMaterialStateNew(modelId, i, { params: { [param]: value } });
                }
            }
        }
    }

    private applyPbrAlphaBlendToAllModels(alphaMode: string): void {
        const entries = this.getAllMmdModelEntries();
        for (const [modelId, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;
            for (let i = 0; i < materials.length; i++) {
                const material = materials[i];
                if (material instanceof PBRMaterial) {
                    switch (alphaMode) {
                        case 'opaque':
                            material.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
                            material.needDepthPrePass = false;
                            material.forceDepthWrite = false;
                            break;
                        case 'alphaTest':
                            material.transparencyMode = BabylonMaterial.MATERIAL_ALPHATEST;
                            material.needDepthPrePass = false;
                            material.forceDepthWrite = false;
                            break;
                        case 'alphaBlend':
                            material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
                            material.needDepthPrePass = false;
                            material.forceDepthWrite = false;
                            break;
                        case 'alphaTestAndBlend':
                            material.transparencyMode = BabylonMaterial.MATERIAL_ALPHATESTANDBLEND;
                            material.needDepthPrePass = true;
                            material.forceDepthWrite = false;
                            break;
                    }
                    shadingStateManager.updateMaterialStateNew(modelId, i, { params: { alphaBlendMode: alphaMode } });
                }
            }
        }
    }

    // ===== 原有 MMD 标准方法（不变） =====

    syncOutlineFromState(): void {
        if (this.updatingState) return;
        this.updatingState = true;
        try {
            this.outlineSlider.setValue(this.readOutlineState());
        } finally {
            this.updatingState = false;
        }
    }

    private getAllMmdModelEntries(): IterableIterator<[string, MmdModel]> {
        const animManager = this.mainWindow?.getAnimationManager();
        if (!animManager) return [].values() as IterableIterator<[string, MmdModel]>;
        return animManager.getAllMmdModelEntries?.() ?? [].values() as IterableIterator<[string, MmdModel]>;
    }

    private hasAnyMmdModel(): boolean {
        const iterator = this.getAllMmdModelEntries();
        return !iterator.next().done;
    }

    private getFirstMmdModelEntry(): [string, MmdModel] | undefined {
        const iterator = this.getAllMmdModelEntries();
        const first = iterator.next();
        return first.done ? undefined : first.value;
    }

    //region MMD: Outline Width

    private readOutlineState(): number {
        const firstEntry = this.getFirstMmdModelEntry();
        if (!firstEntry) return 0;
        const [firstModelId] = firstEntry;
        const saved = shadingStateManager.getModelOutlineState(firstModelId);
        return saved?.outlineWidth ?? 0;
    }

    private applyOutlineWidthToAllModels(width: number): void {
        const entries = this.getAllMmdModelEntries();
        for (const [modelId, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (let i = 0; i < materials.length; i++) {
                const material = materials[i];
                if (!(material instanceof MmdStandardMaterial)) continue;

                const originalProps = shadingStateManager.getOriginalOutlineProperties(modelId, i);
                if (originalProps?.renderOutline) {
                    if (width > 0) {
                        material.renderOutline = true;
                        material.outlineWidth = width;
                    } else {
                        material.renderOutline = false;
                        material.outlineWidth = 0;
                    }
                }
            }

            shadingStateManager.updateModelOutlineWidth(modelId, width);
        }
    }

    //endregion

    //region MMD: Alpha Blend Mode

    private readAlphaModeFromAllModels(): string {
        const entries = this.getAllMmdModelEntries();
        for (const [_, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (const material of materials) {
                if (!(material instanceof MmdStandardMaterial)) continue;

                const transparencyMode = material.transparencyMode;
                if (transparencyMode === BabylonMaterial.MATERIAL_ALPHATEST) return 'alphaTest';
                if (transparencyMode === BabylonMaterial.MATERIAL_ALPHABLEND) return 'alphaBlend';
                if (transparencyMode === BabylonMaterial.MATERIAL_ALPHATESTANDBLEND) return 'alphaTestAndBlend';
                return 'opaque';
            }
        }
        return 'alphaBlend';
    }

    private applyAlphaModeToAllModels(alphaMode: string): void {
        const entries = this.getAllMmdModelEntries();
        for (const [modelId, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (let i = 0; i < materials.length; i++) {
                const material = materials[i];
                if (!(material instanceof MmdStandardMaterial)) continue;

                switch (alphaMode) {
                    case 'opaque':
                        material.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
                        material.needDepthPrePass = false;
                        material.forceDepthWrite = false;
                        break;
                    case 'alphaTest':
                        material.transparencyMode = BabylonMaterial.MATERIAL_ALPHATEST;
                        material.needDepthPrePass = false;
                        material.forceDepthWrite = false;
                        break;
                    case 'alphaBlend':
                        material.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
                        material.needDepthPrePass = false;
                        material.forceDepthWrite = true;
                        break;
                    case 'alphaTestAndBlend':
                        material.transparencyMode = BabylonMaterial.MATERIAL_ALPHATESTANDBLEND;
                        material.needDepthPrePass = true;
                        material.forceDepthWrite = false;
                        break;
                }
                shadingStateManager.updateMaterialStateNew(modelId, i, { params: { alphaBlendMode: alphaMode } });
            }
        }
    }

    //endregion

    //region MMD: SPA Texture

    private readSpaModeFromAllModels(): string {
        const entries = this.getAllMmdModelEntries();
        for (const [_, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (const material of materials) {
                if (!(material instanceof MmdStandardMaterial)) continue;
                if (material.sphereTexture === null) continue;

                const blendMode = material.sphereTextureBlendMode;
                if (blendMode === MmdPluginMaterialSphereTextureBlendMode.Multiply) return 'multiply';
                if (blendMode === MmdPluginMaterialSphereTextureBlendMode.Add) return 'add';
                if (blendMode === MmdPluginMaterialSphereTextureBlendMode.SubTexture) return 'subTexture';
                return 'multiply';
            }
        }
        return 'off';
    }

    private applySpaModeToAllModels(spaMode: string): void {
        const entries = this.getAllMmdModelEntries();
        for (const [modelId, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (let i = 0; i < materials.length; i++) {
                const material = materials[i];
                if (!(material instanceof MmdStandardMaterial)) continue;

                if (spaMode === 'off') {
                    if (material.sphereTexture !== null) {
                        shadingStateManager.setSavedSpaTexture(modelId, i, material.sphereTexture);
                    }
                    material.sphereTexture = null;
                } else {
                    if (material.sphereTexture === null) {
                        const savedTexture = shadingStateManager.getSavedSpaTexture(modelId, i);
                        if (savedTexture) {
                            material.sphereTexture = savedTexture;
                        }
                    }

                    if (material.sphereTexture !== null) {
                        switch (spaMode) {
                            case 'multiply':
                                material.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.Multiply;
                                break;
                            case 'add':
                                material.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.Add;
                                break;
                            case 'subTexture':
                                material.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.SubTexture;
                                break;
                        }
                    }
                }
                shadingStateManager.updateMaterialStateNew(modelId, i, { params: { spaMode } });
            }
        }
    }

    //endregion

    //region MMD: Shader

    private getShaderDropdownOptions(): DropdownOption[] {
        const mmdAdapter = materialAdapterRegistry.get('mmd-standard');
        if (!mmdAdapter) {
            return [
                { value: 'default', label: '默认' },
                { value: 'ToonShadow', label: '假阴影' }
            ];
        }

        const decls = mmdAdapter.getControlDeclarations();
        const shaderDecl = decls.find(
            (d) => d.param === 'useToonShadow'
        ) as DropdownControlDeclaration | undefined;

        if (!shaderDecl) {
            return [
                { value: 'default', label: '默认' },
                { value: 'ToonShadow', label: '假阴影' }
            ];
        }

        return shaderDecl.options.map((opt, idx) => ({
            value: opt,
            label: shaderDecl.optionLabels?.[idx] ?? opt
        }));
    }

    private readShaderFromAllModels(): string {
        const entries = this.getAllMmdModelEntries();
        for (const [_, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (const material of materials) {
                if (material instanceof MmdStandardMaterial) {
                    return material.useToonShadow ? 'ToonShadow' : 'default';
                }
            }
        }
        return 'default';
    }

    private applyShaderToAllModels(shaderValue: string): void {
        const useToonShadow = shaderValue === 'ToonShadow';
        const entries = this.getAllMmdModelEntries();

        for (const [modelId, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (let i = 0; i < materials.length; i++) {
                const material = materials[i];
                if (material instanceof MmdStandardMaterial) {
                    material.useToonShadow = useToonShadow;
                    shadingStateManager.updateMaterialStateNew(modelId, i, { params: { useToonShadow: shaderValue } });
                }
            }
        }
    }

    //endregion

    //region MMD: Toon Shadow Parameters

    private readToonSampleThresholdFromAllModels(): number {
        const entries = this.getAllMmdModelEntries();
        for (const [_, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (const material of materials) {
                if (material instanceof MmdStandardMaterial) {
                    const tsp = material.toonShadowParams;
                    return tsp?.r ?? 0.05;
                }
            }
        }
        return 0.05;
    }

    private readToonBlendThresholdFromAllModels(): number {
        const entries = this.getAllMmdModelEntries();
        for (const [_, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (const material of materials) {
                if (material instanceof MmdStandardMaterial) {
                    const tsp = material.toonShadowParams;
                    return tsp?.g ?? 0.24;
                }
            }
        }
        return 0.24;
    }

    private applyToonSampleThresholdToAllModels(threshold: number): void {
        const entries = this.getAllMmdModelEntries();
        for (const [modelId, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (let i = 0; i < materials.length; i++) {
                const material = materials[i];
                if (material instanceof MmdStandardMaterial) {
                    const current = material.toonShadowParams;
                    material.toonShadowParams = new Color4(
                        threshold,
                        current.g,
                        0,
                        0
                    );
                    shadingStateManager.updateMaterialStateNew(modelId, i, { params: { toonShadowSampleThreshold: threshold } });
                }
            }
        }
    }

    private applyToonBlendThresholdToAllModels(threshold: number): void {
        const entries = this.getAllMmdModelEntries();
        for (const [modelId, mmdModel] of entries) {
            const materials = mmdModel.mesh?.metadata?.materials;
            if (!materials) continue;

            for (let i = 0; i < materials.length; i++) {
                const material = materials[i];
                if (material instanceof MmdStandardMaterial) {
                    const current = material.toonShadowParams;
                    material.toonShadowParams = new Color4(
                        current.r,
                        threshold,
                        0,
                        0
                    );
                    shadingStateManager.updateMaterialStateNew(modelId, i, { params: { toonShadowBlendThreshold: threshold } });
                }
            }
        }
    }

    //endregion

    dispose(): void {
        if (this.unsubStyleChanged) {
            this.unsubStyleChanged();
            this.unsubStyleChanged = null;
        }
        this.outlineSlider.dispose();
        this.alphaDropdown.dispose();
        this.spaDropdown.dispose();
        this.shaderDropdown.dispose();
        this.toonSampleSlider.dispose();
        this.toonBlendSlider.dispose();
        this.pbrIblIntensity?.dispose();
        this.pbrIblRotation?.dispose();
        this.pbrMetallic?.dispose();
        this.pbrRoughness?.dispose();
        this.pbrIor?.dispose();
        this.pbrEmissiveIntensity?.dispose();
        this.pbrAlpha?.dispose();
        this.pbrAlphaBlend?.dispose();
        this.shadingSection.dispose();
        this.element.remove();
    }
}
