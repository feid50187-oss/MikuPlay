
import type { Material } from '@babylonjs/core/Materials/material';
import type { IPanel } from '../../../core/IPanel';
import type { MainWindow } from '../../MainWindow';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { IMaterialAdapter } from '../../../core/IMaterialAdapter';
import { injectStyles } from '../../../styles/mainWindow.css';
import { shadingPanelStyles } from '../../../styles/panels/shadingPanel.css';
import { ModelStateManager } from '../../../features/mmd/ModelStateManager';
import { ModelOptStateManager } from '../../../features/state/ModelOptStateManager';
import { shadingStateManager } from '../../../features/state';
import { materialAdapterRegistry } from '../../../features/shading/MaterialAdapterRegistry';
import { MmdStandardMaterial } from 'babylon-mmd/esm/Loader/mmdStandardMaterial';
import { Events, eventBus } from '../../../core';
import { MaterialListSection } from './MaterialListSection';
import { MaterialParamsSection } from './MaterialParamsSection';
import { Dropdown } from '../../shared/Dropdown';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>`;

export class ShadingPanel implements IPanel {
    readonly id = 'shading';
    readonly tabLabel = '着色';
    readonly tabIcon = TAB_ICON;
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private materialListSection: MaterialListSection | null = null;
    private materialParamsSection: MaterialParamsSection | null = null;
    private unsubscribeModelSelected: (() => void) | null = null;
    private unsubscribeAdapterRegistered: (() => void) | null = null;
    private unsubscribeAdapterUnregistered: (() => void) | null = null;
    private outlineSlider: HTMLInputElement | null = null;
    private outlineValue: HTMLElement | null = null;
    private styleSelectorContainer: HTMLElement | null = null;
    private styleDropdown: Dropdown | null = null;

    constructor(options: { mainWindow?: MainWindow }) {
        this.mainWindow = options.mainWindow ?? null;
        injectStyles(shadingPanelStyles, 'panel-shading');
        this.element = this.buildPanel();
    }

    private buildPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'shading-panel';

        const topSection = document.createElement('div');
        topSection.className = 'shading-panel-top';

        // 风格选择器容器（默认隐藏，仅在有 createsMaterial=true 的适配器时显示）
        const outlineContainer = document.createElement('div');
        outlineContainer.className = 'shading-outline-container';
        outlineContainer.id = 'shading-outline-container';

        const outlineLabel = document.createElement('span');
        outlineLabel.className = 'shading-outline-label';
        outlineLabel.textContent = '描边宽度';

        const outlineSliderWrapper = document.createElement('div');
        outlineSliderWrapper.className = 'shading-outline-slider-wrapper';

        this.outlineSlider = document.createElement('input');
        this.outlineSlider.type = 'range';
        this.outlineSlider.className = 'shading-outline-slider';
        this.outlineSlider.min = '0';
        this.outlineSlider.max = '2';
        this.outlineSlider.step = '0.01';
        this.outlineSlider.value = '0';

        this.outlineValue = document.createElement('span');
        this.outlineValue.className = 'shading-outline-value';
        this.outlineValue.textContent = '0';

        this.outlineSlider.addEventListener('input', () => {
            const val = parseFloat(this.outlineSlider!.value);
            this.outlineValue!.textContent = val.toFixed(3);
            this.updateOutlineWidth(val);
        });

        outlineSliderWrapper.appendChild(this.outlineSlider);
        outlineSliderWrapper.appendChild(this.outlineValue);

        outlineContainer.appendChild(outlineLabel);
        outlineContainer.appendChild(outlineSliderWrapper);

        topSection.appendChild(outlineContainer);

        // 风格选择器容器（始终显示，因为 PBR 材质为内置功能）
        this.styleSelectorContainer = document.createElement('div');
        this.styleSelectorContainer.className = 'shading-style-selector-container';
        topSection.appendChild(this.styleSelectorContainer);

        const bottomSection = document.createElement('div');
        bottomSection.className = 'shading-panel-bottom';

        this.materialListSection = new MaterialListSection({ mainWindow: this.mainWindow });
        this.materialListSection.onMaterialSelected = (index: number) => {
            this.onMaterialSelected(index);
        };

        const verticalDivider = document.createElement('div');
        verticalDivider.className = 'shading-vertical-divider';

        this.materialParamsSection = new MaterialParamsSection();

        bottomSection.appendChild(this.materialListSection.element);
        bottomSection.appendChild(verticalDivider);
        bottomSection.appendChild(this.materialParamsSection.element);

        panel.appendChild(topSection);
        panel.appendChild(bottomSection);

        // 构建风格选择器
        this.rebuildStyleSelector();

        this.initializeWithSelectedModel();

        return panel;
    }

    private initializeWithSelectedModel(): void {
        let initialModelId = ModelOptStateManager.getInstance().getSelectedModel();

        if (!initialModelId) {
            const stateManager = ModelStateManager.getInstance();
            const models = stateManager.getModels();
            if (models.length > 0) {
                const firstModel = models[0];
                ModelOptStateManager.getInstance().selectModel(firstModel.id);
                initialModelId = firstModel.id;
            }
        }

        if (initialModelId) {
            this.materialListSection?.updateMaterialList(initialModelId);
            this.updateOutlineSlider(initialModelId);
        }
    }

    onShown(): void {
        if (this.unsubscribeModelSelected) {
            this.unsubscribeModelSelected();
        }
        this.unsubscribeModelSelected = eventBus.on(Events.MODEL_SELECTED, (modelId: string) => {
            this.materialListSection?.updateMaterialList(modelId);
            this.materialParamsSection?.showEmpty();
            this.updateOutlineSlider(modelId);
        });

        // 监听适配器注册/注销事件，动态更新风格选择器选项
        this.unsubscribeAdapterRegistered = eventBus.on(Events.SHADING_ADAPTER_REGISTERED, () => {
            this.rebuildStyleSelector();
        });
        this.unsubscribeAdapterUnregistered = eventBus.on(Events.SHADING_ADAPTER_UNREGISTERED, () => {
            this.rebuildStyleSelector();
        });

        const currentModelId = ModelOptStateManager.getInstance().getSelectedModel();
        if (currentModelId !== this.materialListSection?.getCurrentModelId()) {
            this.materialListSection?.updateMaterialList(currentModelId);
            this.materialParamsSection?.showEmpty();
            this.updateOutlineSlider(currentModelId);
        }
    }

    onHidden(): void {
        if (this.unsubscribeModelSelected) {
            this.unsubscribeModelSelected();
            this.unsubscribeModelSelected = null;
        }
        if (this.unsubscribeAdapterRegistered) {
            this.unsubscribeAdapterRegistered();
            this.unsubscribeAdapterRegistered = null;
        }
        if (this.unsubscribeAdapterUnregistered) {
            this.unsubscribeAdapterUnregistered();
            this.unsubscribeAdapterUnregistered = null;
        }
    }

    /**
     * 重建风格选择器
     * 始终显示，包含 MMD 标准和所有 createsMaterial=true 的适配器
     */
    private rebuildStyleSelector(): void {
        if (!this.styleSelectorContainer) return;

        this.styleSelectorContainer.innerHTML = '';

        const materialCreatingAdapters = materialAdapterRegistry.getMaterialCreatingAdapters();
        const dropdown = this.createStyleDropdown(materialCreatingAdapters);
        this.styleSelectorContainer.appendChild(dropdown);
    }

    private createStyleDropdown(adapters: IMaterialAdapter[]): HTMLElement {
        // 选项：MMD 标准 + 所有 createsMaterial=true 的适配器
        const options = [
            { value: 'mmd-standard', label: 'MMD 标准' },
            ...adapters.map(a => ({ value: a.typeId, label: a.displayName }))
        ];

        // 获取当前模型的渲染风格
        const modelId = this.materialListSection?.getCurrentModelId();
        const currentStyle = modelId ? shadingStateManager.getRenderStyle(modelId) : 'mmd-standard';

        if (this.styleDropdown) {
            this.styleDropdown.dispose();
        }

        this.styleDropdown = new Dropdown({
            options,
            selectedValue: currentStyle,
            placeholder: '选择渲染风格'
        });
        this.styleDropdown.element.classList.add('shading-style-dropdown');
        this.styleDropdown.onChange((value) => {
            this.switchStyle(value);
        });

        return this.styleDropdown.element;
    }

    /**
     * 切换渲染风格
     * 仅当 adapterTypeId 不是 'mmd-standard' 且对应适配器的 createsMaterial=true 时执行材质替换
     */
    private switchStyle(adapterTypeId: string): void {
        const modelId = this.materialListSection?.getCurrentModelId();
        const mmdModel = this.materialListSection?.getCurrentMmdModel();
        if (!modelId || !mmdModel) return;

        if (adapterTypeId === 'mmd-standard') {
            this.restoreMmdStyle(modelId, mmdModel);
            return;
        }

        const adapter = materialAdapterRegistry.get(adapterTypeId);
        if (!adapter || !adapter.createsMaterial) return;

        const scene = this.mainWindow?.getSceneManager()?.getScene();
        if (!scene) return;

        const materials = mmdModel.mesh.metadata.materials;
        const meshes = mmdModel.mesh.metadata.meshes;

        for (let i = 0; i < materials.length; i++) {
            const oldMaterial = materials[i];

            if (adapter.canHandle(oldMaterial)) continue;

            // 转换源：始终用真正的 MMD 原版。首次转换时（原版尚未保存）
            // 当前材质就是 MMD 材质，保存为原版并作为转换源。
            let source = shadingStateManager.getOriginalMmdMaterial(modelId, i);
            if (!source) {
                source = oldMaterial;
                shadingStateManager.saveOriginalMmdMaterial(modelId, i, source);
            }

            // 转换材质
            let newMaterial;
            if (adapter.convertFromMmd) {
                newMaterial = adapter.convertFromMmd(source, scene);
            } else {
                continue;
            }

            // 记录转换后的材质
            shadingStateManager.setConvertedMaterial(modelId, i, newMaterial);

            // 替换 mesh 的材质
            for (const mesh of meshes) {
                if (mesh.material === oldMaterial) {
                    mesh.material = newMaterial;
                }
            }

            // 同步更新 metadata 中的材质引用（readonly 仅是 TS 类型约束，运行时可写）
            (materials as Material[])[i] = newMaterial;
        }

        // 更新渲染风格状态
        shadingStateManager.setRenderStyle(modelId, adapterTypeId);

        // 同步更新所有材质的 adapterTypeId（否则存档时仍会保存为 'mmd-standard'）
        for (let i = 0; i < materials.length; i++) {
            shadingStateManager.updateMaterialStateNew(modelId, i, { adapterTypeId });
        }

        // 更新描边区域可见性
        this.updateOutlineVisibility(adapter.supportsOutline);

        // 刷新材质参数面板
        this.materialParamsSection?.showEmpty();
    }

    /** 恢复 MMD 标准风格 */
    private restoreMmdStyle(modelId: string, mmdModel: MmdModel): void {
        const materials = mmdModel.mesh.metadata.materials;
        const meshes = mmdModel.mesh.metadata.meshes;

        for (let i = 0; i < materials.length; i++) {
            const currentMaterial = materials[i];
            const originalMmdMaterial = shadingStateManager.getOriginalMmdMaterial(modelId, i);

            if (!originalMmdMaterial) continue;

            // 恢复 mesh 的材质
            for (const mesh of meshes) {
                if (mesh.material === currentMaterial) {
                    mesh.material = originalMmdMaterial;
                }
            }

            // 释放非 MMD 材质
            if (currentMaterial !== originalMmdMaterial) {
                const adapter = materialAdapterRegistry.findAdapter(currentMaterial);
                if (adapter) {
                    adapter.disposeMaterial(currentMaterial);
                } else {
                    currentMaterial.dispose();
                }
            }

            // 同步更新 metadata 中的材质引用
            (materials as Material[])[i] = originalMmdMaterial;

            // 清理保存的引用
            shadingStateManager.setConvertedMaterial(modelId, i, null);
        }

        // 更新渲染风格状态
        shadingStateManager.setRenderStyle(modelId, 'mmd-standard');

        // 同步更新所有材质的 adapterTypeId
        for (let i = 0; i < materials.length; i++) {
            shadingStateManager.updateMaterialStateNew(modelId, i, { adapterTypeId: 'mmd-standard' });
        }

        // 恢复描边区域
        this.updateOutlineVisibility(true);
        this.materialParamsSection?.showEmpty();
    }

    /** 描边区域可见性控制 */
    private updateOutlineVisibility(supportsOutline: boolean): void {
        const outlineContainer = this.element.querySelector('#shading-outline-container') as HTMLElement;
        if (outlineContainer) {
            outlineContainer.style.display = supportsOutline ? '' : 'none';
        }
    }

    private updateOutlineSlider(modelId: string | null): void {
        if (!this.outlineSlider || !this.outlineValue) return;

        if (!modelId) {
            this.outlineSlider.value = '0';
            this.outlineValue.textContent = '0';
            return;
        }

        const savedState = shadingStateManager.getModelOutlineState(modelId);
        if (savedState) {
            this.outlineSlider.value = savedState.outlineWidth.toString();
            this.outlineValue.textContent = savedState.outlineWidth.toFixed(3);
        } else {
            this.outlineSlider.value = '0';
            this.outlineValue.textContent = '0';
        }
    }

    private updateOutlineWidth(width: number): void {
        const modelId = this.materialListSection?.getCurrentModelId();
        const mmdModel = this.materialListSection?.getCurrentMmdModel();
        if (!modelId || !mmdModel) return;

        const materials = mmdModel.mesh.metadata.materials;
        if (!materials) return;

        for (let i = 0; i < materials.length; i++) {
            const material = materials[i];
            // 使用适配器查找替代 instanceof；MmdStandardMaterial 与 Toon ShaderMaterial 都支持描边
            const adapter = materialAdapterRegistry.findAdapter(material);
            if (adapter?.supportsOutline) {
                const originalProps = shadingStateManager.getOriginalOutlineProperties(modelId, i);

                if (originalProps?.renderOutline) {
                    const mmdLike = material as any;
                    if (width > 0) {
                        mmdLike.renderOutline = true;
                        mmdLike.outlineWidth = width;
                    } else {
                        mmdLike.renderOutline = false;
                        mmdLike.outlineWidth = 0;
                    }
                }
            }
        }

        shadingStateManager.updateModelOutlineWidth(modelId, width);
    }

    private onMaterialSelected(index: number): void {
        const modelId = this.materialListSection?.getCurrentModelId();
        const mmdModel = this.materialListSection?.getCurrentMmdModel();

        if (modelId && mmdModel) {
            this.materialParamsSection?.renderMaterial(modelId, mmdModel, index);
        }
    }

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        this.element.remove();
    }

    dispose(): void {
        this.onHidden();

        this.styleDropdown?.dispose();
        this.materialListSection?.dispose();
        this.materialParamsSection?.dispose();
        this.styleDropdown = null;
        this.materialListSection = null;
        this.materialParamsSection = null;
        this.outlineSlider = null;
        this.outlineValue = null;
        this.styleSelectorContainer = null;
        this.element.remove();
    }
}
