
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { Material } from '@babylonjs/core/Materials/material';
import type { IMaterialAdapter, ParamValue } from '../../../core/IMaterialAdapter';
import type { ControlDeclaration, DropdownControlDeclaration, ToggleControlDeclaration, ColorControlDeclaration } from '../../../core/IPlugin';
import { shadingStateManager, Color3State, MaterialState } from '../../../features/state';
import { materialAdapterRegistry } from '../../../features/shading/MaterialAdapterRegistry';
import { MmdStandardMaterial } from 'babylon-mmd/esm/Loader/mmdStandardMaterial';
import { MmdPluginMaterialSphereTextureBlendMode } from 'babylon-mmd/esm/Loader/mmdPluginMaterial';
import { Slider } from '../../shared/Slider';
import { RGBColorPicker } from '../../shared/RGBColorPicker';
import { TexturePicker } from '../../shared/TexturePicker';
import { Dropdown } from '../../shared/Dropdown';

interface GroupInfo {
    name: string;
    title: string;
    declarations: ControlDeclaration[];
}

export class MaterialParamsSection {
    readonly element: HTMLElement;

    private materialParams: HTMLElement | null = null;
    private paramsEmpty: HTMLElement | null = null;
    private sliders: Slider[] = [];
    private dropdowns: Dropdown[] = [];
    private currentModelId: string | null = null;
    private currentMmdModel: MmdModel | null = null;
    private currentMaterialIndex: number = -1;

    constructor() {
        this.element = this.create();
    }

    private create(): HTMLElement {
        this.materialParams = document.createElement('div');
        this.materialParams.className = 'shading-material-params';

        this.paramsEmpty = document.createElement('div');
        this.paramsEmpty.className = 'shading-material-params-empty';
        this.paramsEmpty.textContent = '请选择材质';
        this.paramsEmpty.id = 'shading-material-params-empty';

        this.materialParams.appendChild(this.paramsEmpty);

        return this.materialParams;
    }

    showEmpty(): void {
        if (!this.materialParams || !this.paramsEmpty) return;

        const existingContent = this.materialParams.querySelector('.shading-material-params-content');
        if (existingContent) {
            existingContent.remove();
        }
        this.paramsEmpty.style.display = 'flex';
    }

    renderMaterial(modelId: string, mmdModel: MmdModel, materialIndex: number): void {
        if (!this.materialParams || !this.paramsEmpty) return;

        this.currentModelId = modelId;
        this.currentMmdModel = mmdModel;
        this.currentMaterialIndex = materialIndex;
        this.paramsEmpty.style.display = 'none';

        let paramsContent = this.materialParams.querySelector('.shading-material-params-content') as HTMLElement | null;
        if (!paramsContent) {
            paramsContent = document.createElement('div');
            paramsContent.className = 'shading-material-params-content';
            this.materialParams.appendChild(paramsContent);
        }

        this.disposeDropdowns();
        paramsContent.innerHTML = '';

        const material = mmdModel.mesh.metadata.materials[materialIndex];
        if (!material) return;

        // 顶部显示当前材质名（内联样式）
        const currentMaterialLabel = document.createElement('div');
        currentMaterialLabel.style.cssText = [
            'font-size: 13px',
            'font-weight: 500',
            'color: var(--color-text-primary)',
            'padding: 0 2px 8px 2px',
            'flex-shrink: 0',
            'user-select: none',
            '-webkit-touch-callout: none'
        ].join(';');
        currentMaterialLabel.textContent = `当前材质：${material.name}`;
        paramsContent.appendChild(currentMaterialLabel);

        // 使用适配器查找替代 instanceof
        const adapter = materialAdapterRegistry.findAdapter(material);

        if (!adapter) {
            const unsupported = document.createElement('div');
            unsupported.className = 'shading-material-params-empty';
            unsupported.textContent = '不支持的材质类型';
            paramsContent.appendChild(unsupported);
            return;
        }

        this.renderDynamicControls(paramsContent, adapter, material, materialIndex);
    }

    clearParams(): void {
        if (!this.materialParams) return;

        this.disposeDropdowns();
        const existingContent = this.materialParams.querySelector('.shading-material-params-content');
        if (existingContent) {
            existingContent.remove();
        }
        if (this.paramsEmpty) {
            this.paramsEmpty.style.display = 'flex';
        }
    }

    private renderDynamicControls(
        container: HTMLElement,
        adapter: IMaterialAdapter,
        material: Material,
        materialIndex: number
    ): void {
        if (!this.currentModelId) return;

        // 通过适配器读取状态
        const runtimeParams = adapter.readState(material);

        // 合并已保存的状态
        const savedState = shadingStateManager.getMaterialStateNew(this.currentModelId, materialIndex);
        let state: Record<string, ParamValue>;

        if (savedState && savedState.adapterTypeId === adapter.typeId) {
            // 使用运行时值更新状态
            state = { ...savedState.params, ...runtimeParams };
        } else {
            state = { ...runtimeParams };
            // 首次加载 MMD 材质时保存 SPA 贴图
            if (adapter.typeId === 'mmd-standard' && material instanceof MmdStandardMaterial) {
                if (material.sphereTexture) {
                    shadingStateManager.setSavedSpaTexture(this.currentModelId, materialIndex, material.sphereTexture);
                }
            }
        }

        // 保存状态
        shadingStateManager.setMaterialStateNew(this.currentModelId, materialIndex, {
            adapterTypeId: adapter.typeId,
            params: state,
            isVisible: (state.isVisible as boolean) ?? true
        });

        const scrollContainer = document.createElement('div');
        scrollContainer.className = 'shading-params-scroll';

        let declarations = adapter.getControlDeclarations();

        // 根据 Shader 变体过滤 Toon 参数控件（仅在 ToonShadow 模式下显示）
        const shaderVariant = state.useToonShadow as string | undefined;
        if (shaderVariant !== 'ToonShadow') {
            declarations = declarations.filter(
                (d) => d.param !== 'toonShadowSampleThreshold' && d.param !== 'toonShadowBlendThreshold'
            );
        }

        // 分组：将声明按 group 字段分组，无 group 的各自独立
        const groups = this.buildGroups(declarations);

        for (const group of groups) {
            if (group.declarations.length === 1 && !group.name) {
                // 无分组单控件：保持原有行为
                this.renderSingleControl(scrollContainer, group.declarations[0], state, material, adapter, materialIndex, container);
            } else {
                // 分组：合并到一个 container
                this.renderGroupedControls(scrollContainer, group, state, material, adapter, materialIndex, container);
            }
        }

        container.appendChild(scrollContainer);
    }

    private buildGroups(declarations: ControlDeclaration[]): GroupInfo[] {
        const groupMap = new Map<string, GroupInfo>();
        const result: GroupInfo[] = [];

        for (const decl of declarations) {
            const groupName = (decl as { group?: string }).group;
            if (!groupName) {
                // 无分组，独立渲染
                result.push({ name: '', title: decl.label, declarations: [decl] });
            } else if (groupMap.has(groupName)) {
                groupMap.get(groupName)!.declarations.push(decl);
            } else {
                const group: GroupInfo = { name: groupName, title: groupName, declarations: [decl] };
                groupMap.set(groupName, group);
                result.push(group);
            }
        }

        return result;
    }

    private renderSingleControl(
        scrollContainer: HTMLElement,
        decl: ControlDeclaration,
        state: Record<string, ParamValue>,
        material: Material,
        adapter: IMaterialAdapter,
        materialIndex: number,
        panelContainer: HTMLElement
    ): void {
        switch (decl.type) {
            case 'slider':
                this.renderSliderControl(scrollContainer, decl, state, material, adapter, materialIndex);
                break;
            case 'color':
                this.renderColorControl(scrollContainer, decl, state, material, adapter, materialIndex, panelContainer);
                break;
            case 'texture':
                this.renderTextureControl(scrollContainer, decl, state, material, adapter, materialIndex);
                break;
            case 'dropdown':
                this.renderDropdownControl(scrollContainer, decl, state, material, adapter, materialIndex, panelContainer);
                break;
            case 'toggle':
                this.renderToggleControl(scrollContainer, decl, state, material, adapter, materialIndex);
                break;
            case 'vector':
                break;
        }
    }

    private renderGroupedControls(
        scrollContainer: HTMLElement,
        group: GroupInfo,
        state: Record<string, ParamValue>,
        material: Material,
        adapter: IMaterialAdapter,
        materialIndex: number,
        panelContainer: HTMLElement
    ): void {
        const { container, content, titleEl } = this.createGroupContainer(group.title);

        for (const decl of group.declarations) {
            switch (decl.type) {
                case 'toggle': {
                    // Toggle 放入标题栏
                    const currentValue = !!state[decl.param];
                    const toggleTrack = document.createElement('div');
                    toggleTrack.className = 'shading-toggle' + (currentValue ? ' active' : '');
                    const toggleThumb = document.createElement('div');
                    toggleThumb.className = 'shading-toggle-thumb';
                    toggleTrack.appendChild(toggleThumb);
                    titleEl.appendChild(toggleTrack);
                    toggleTrack.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const isActive = toggleTrack.classList.toggle('active');
                        state[decl.param] = isActive;
                        adapter.writeState(material, state);
                        shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                            params: { [decl.param]: isActive }
                        });
                    });
                    break;
                }
                case 'color': {
                    const color = (state[decl.param] as Color3State) ?? { r: 0, g: 0, b: 0 };

                    const onChange = (newColor: Color3State) => {
                        state[decl.param] = newColor;
                        adapter.writeState(material, state);
                        shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                            params: { [decl.param]: newColor }
                        });
                    };

                    const picker = new RGBColorPicker({
                        color: { r: color.r, g: color.g, b: color.b },
                        mode: 'popup',
                        popupContainer: panelContainer
                    });
                    picker.onChange((value) => {
                        onChange({ r: value.r, g: value.g, b: value.b });
                    });
                    titleEl.appendChild(picker.element);
                    break;
                }
                case 'texture': {
                    const url = (state[decl.param] as string) ?? '';

                    const onChangeTex = (newUrl: string) => {
                        state[decl.param] = newUrl;
                        adapter.writeState(material, state);
                        shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                            params: { [decl.param]: newUrl }
                        });
                    };

                    const texPicker = new TexturePicker({ value: url });
                    texPicker.onChange((newUrl) => onChangeTex(newUrl));
                    titleEl.appendChild(texPicker.element);
                    break;
                }
                case 'slider': {
                    const value = typeof state[decl.param] === 'number' ? state[decl.param] as number : decl.min;
                    const sliderRow = document.createElement('div');
                    sliderRow.className = 'shading-slider-row';

                    const sliderLabel = document.createElement('span');
                    sliderLabel.className = 'shading-group-slider-label';
                    sliderLabel.textContent = decl.label;

                    const slider = new Slider({
                        label: decl.label,
                        min: decl.min,
                        max: decl.max,
                        step: decl.step,
                        value,
                        showValue: false
                    });

                    const valueLabel = document.createElement('span');
                    valueLabel.className = 'shading-slider-minmax';
                    valueLabel.textContent = value.toFixed(2);

                    slider.onChange((newValue) => {
                        valueLabel.textContent = newValue.toFixed(2);
                        state[decl.param] = newValue;
                        adapter.writeState(material, state);
                        shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                            params: { [decl.param]: newValue }
                        });
                    });
                    this.sliders.push(slider);

                    sliderRow.appendChild(sliderLabel);
                    sliderRow.appendChild(slider.element);
                    sliderRow.appendChild(valueLabel);
                    content.appendChild(sliderRow);
                    break;
                }
                case 'dropdown': {
                    const dropdownDecl = decl as DropdownControlDeclaration;
                    const currentValue = (state[decl.param] as string) ?? dropdownDecl.options[0];
                    const labels = dropdownDecl.optionLabels ?? dropdownDecl.options;
                    const options = dropdownDecl.options.map((value, i) => ({
                        value,
                        label: labels[i] ?? value
                    }));

                    // SPA 贴图特殊处理
                    if (decl.param === 'spaMode' && adapter.typeId === 'mmd-standard') {
                        const hasSpaTexture = this.hasSpaTexture(materialIndex);
                        const spaSection = this.createSpaModeSection(currentValue as 'off' | 'multiply' | 'add' | 'subTexture', hasSpaTexture, (mode) => {
                            state[decl.param] = mode;
                            this.applySpaModeChange(material as MmdStandardMaterial, mode, materialIndex);
                            adapter.writeState(material, state);
                            shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                                params: { [decl.param]: mode }
                            });
                        });
                        content.appendChild(spaSection.querySelector('.shading-container-content') ?? spaSection);
                        break;
                    }

                    const dropdownRow = document.createElement('div');
                    dropdownRow.className = 'shading-group-dropdown-row';

                    const dropdownLabel = document.createElement('span');
                    dropdownLabel.className = 'shading-group-dropdown-label';
                    dropdownLabel.textContent = decl.label;

                    const dropdownEl = this.createDropdownElement(options, currentValue, (value) => {
                        state[decl.param] = value;
                        adapter.writeState(material, state);
                        shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                            params: { [decl.param]: value }
                        });
                    }, panelContainer);

                    dropdownRow.appendChild(dropdownLabel);
                    dropdownRow.appendChild(dropdownEl);
                    content.appendChild(dropdownRow);
                    break;
                }
                case 'vector':
                    break;
            }
        }

        // 如果内容区没有子元素，隐藏它
        if (content.children.length === 0) {
            content.style.display = 'none';
        }

        scrollContainer.appendChild(container);
    }

    private createGroupContainer(title: string): { container: HTMLElement; content: HTMLElement; titleEl: HTMLElement } {
        const container = document.createElement('div');
        container.className = 'shading-container';

        const titleEl = document.createElement('div');
        titleEl.className = 'shading-container-title';

        const titleText = document.createElement('span');
        titleText.className = 'shading-container-title-text';
        titleText.textContent = title;

        titleEl.appendChild(titleText);

        const content = document.createElement('div');
        content.className = 'shading-container-content';

        container.appendChild(titleEl);
        container.appendChild(content);

        return { container, content, titleEl };
    }

    private renderSliderControl(
        scrollContainer: HTMLElement,
        decl: ControlDeclaration & { type: 'slider' },
        state: Record<string, ParamValue>,
        material: Material,
        adapter: IMaterialAdapter,
        materialIndex: number
    ): void {
        const value = typeof state[decl.param] === 'number' ? state[decl.param] as number : decl.min;
        scrollContainer.appendChild(this.createSliderSection(decl.label, value, decl.min, decl.max, decl.step, (newValue) => {
            state[decl.param] = newValue;
            adapter.writeState(material, state);
            shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                params: { [decl.param]: newValue }
            });
        }));
    }

    private renderColorControl(
        scrollContainer: HTMLElement,
        decl: ControlDeclaration & { type: 'color' },
        state: Record<string, ParamValue>,
        material: Material,
        adapter: IMaterialAdapter,
        materialIndex: number,
        panelContainer: HTMLElement
    ): void {
        const color = (state[decl.param] as Color3State) ?? { r: 0, g: 0, b: 0 };
        scrollContainer.appendChild(this.createColorSection(decl.label, color, (newColor) => {
            state[decl.param] = newColor;
            adapter.writeState(material, state);
            shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                params: { [decl.param]: newColor }
            });
        }, panelContainer));
    }

    private renderTextureControl(
        scrollContainer: HTMLElement,
        decl: ControlDeclaration & { type: 'texture' },
        state: Record<string, ParamValue>,
        material: Material,
        adapter: IMaterialAdapter,
        materialIndex: number
    ): void {
        const url = (state[decl.param] as string) ?? '';
        scrollContainer.appendChild(this.createTextureSection(decl.label, url, (newUrl) => {
            state[decl.param] = newUrl;
            adapter.writeState(material, state);
            shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                params: { [decl.param]: newUrl }
            });
        }));
    }

    private renderDropdownControl(
        scrollContainer: HTMLElement,
        decl: DropdownControlDeclaration,
        state: Record<string, ParamValue>,
        material: Material,
        adapter: IMaterialAdapter,
        materialIndex: number,
        panelContainer: HTMLElement
    ): void {
        const currentValue = (state[decl.param] as string) ?? decl.options[0];
        const labels = decl.optionLabels ?? decl.options;
        const options = decl.options.map((value, i) => ({
            value,
            label: labels[i] ?? value
        }));

        // SPA 贴图特殊处理：检查是否有贴图
        if (decl.param === 'spaMode' && adapter.typeId === 'mmd-standard') {
            const hasSpaTexture = this.hasSpaTexture(materialIndex);
            scrollContainer.appendChild(this.createSpaModeSection(currentValue as 'off' | 'multiply' | 'add' | 'subTexture', hasSpaTexture, (mode) => {
                state[decl.param] = mode;
                this.applySpaModeChange(material as MmdStandardMaterial, mode, materialIndex);
                adapter.writeState(material, state);
                shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                    params: { [decl.param]: mode }
                });
            }));
            return;
        }

        const dropDownOnChange = (value: string) => {
            state[decl.param] = value;
            adapter.writeState(material, state);
            shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                params: { [decl.param]: value }
            });
            // Shader 变体切换：重新渲染面板以显示/隐藏相关控件
            if (decl.param === 'useToonShadow' && this.currentModelId !== null) {
                if (this.currentMmdModel) {
                    this.renderMaterial(this.currentModelId, this.currentMmdModel, this.currentMaterialIndex);
                }
            }
        };

        scrollContainer.appendChild(this.createDropdownSection(decl.label, options, currentValue, dropDownOnChange, panelContainer));
    }

    private renderToggleControl(
        scrollContainer: HTMLElement,
        decl: ToggleControlDeclaration,
        state: Record<string, ParamValue>,
        material: Material,
        adapter: IMaterialAdapter,
        materialIndex: number
    ): void {
        const currentValue = !!state[decl.param];
        scrollContainer.appendChild(this.createToggleSection(decl.label, currentValue, (newValue) => {
            state[decl.param] = newValue;
            adapter.writeState(material, state);
            shadingStateManager.updateMaterialStateNew(this.currentModelId!, materialIndex, {
                params: { [decl.param]: newValue }
            });
        }));
    }

    private hasSpaTexture(materialIndex: number): boolean {
        if (!this.currentModelId) return false;
        const savedState = shadingStateManager.getMaterialStateNew(this.currentModelId, materialIndex);
        if (!savedState) return false;
        const spaTexture = shadingStateManager.getSavedSpaTexture(this.currentModelId, materialIndex);
        const spaMode = savedState.params.spaMode as string | undefined;
        // 如果当前 spaMode 不是 off，或有保存的 SPA 贴图，则认为有贴图
        return (spaMode && spaMode !== 'off') || spaTexture !== null;
    }

    private applySpaModeChange(material: MmdStandardMaterial, mode: string, materialIndex: number): void {
        if (!this.currentModelId) return;
        if (mode === 'off') {
            if (material.sphereTexture) {
                shadingStateManager.setSavedSpaTexture(this.currentModelId, materialIndex, material.sphereTexture);
                material.sphereTexture = null;
            }
        } else {
            if (!material.sphereTexture) {
                const saved = shadingStateManager.getSavedSpaTexture(this.currentModelId, materialIndex);
                if (saved) {
                    material.sphereTexture = saved;
                }
            }
            if (material.sphereTexture) {
                if (mode === 'multiply') {
                    material.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.Multiply;
                } else if (mode === 'add') {
                    material.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.Add;
                } else if (mode === 'subTexture') {
                    material.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.SubTexture;
                }
            }
        }
    }

    private createContainer(title: string): { container: HTMLElement; content: HTMLElement } {
        const container = document.createElement('div');
        container.className = 'shading-container';

        const titleEl = document.createElement('div');
        titleEl.className = 'shading-container-title';
        titleEl.textContent = title;

        const content = document.createElement('div');
        content.className = 'shading-container-content';

        container.appendChild(titleEl);
        container.appendChild(content);

        return { container, content };
    }

    private createColorSection(title: string, color: Color3State, onChange: (color: Color3State) => void, panelContainer: HTMLElement): HTMLElement {
        const { container, content } = this.createContainer(title);
        content.style.display = 'none';

        const titleEl = container.querySelector('.shading-container-title') as HTMLElement;

        const picker = new RGBColorPicker({
            color: { r: color.r, g: color.g, b: color.b },
            mode: 'popup',
            popupContainer: panelContainer
        });
        picker.onChange((value) => {
            onChange({ r: value.r, g: value.g, b: value.b });
        });
        titleEl.appendChild(picker.element);

        return container;
    }

    private createTextureSection(title: string, value: string, onChange: (url: string) => void): HTMLElement {
        const { container, content } = this.createContainer(title);
        content.style.display = 'none';

        const titleEl = container.querySelector('.shading-container-title') as HTMLElement;

        const picker = new TexturePicker({ value });
        picker.onChange((url) => {
            onChange(url);
        });
        titleEl.appendChild(picker.element);

        return container;
    }

    private createSliderSection(title: string, value: number, min: number, max: number, step: number, onChange: (value: number) => void): HTMLElement {
        const { container, content } = this.createContainer(title);

        const sliderRow = document.createElement('div');
        sliderRow.className = 'shading-slider-row';

        const slider = new Slider({
            label: title,
            min,
            max,
            step,
            value,
            showValue: false
        });

        const valueLabel = document.createElement('span');
        valueLabel.className = 'shading-slider-minmax';
        valueLabel.textContent = value.toFixed(2);

        slider.onChange((newValue) => {
            valueLabel.textContent = newValue.toFixed(2);
            onChange(newValue);
        });
        this.sliders.push(slider);

        sliderRow.appendChild(slider.element);
        sliderRow.appendChild(valueLabel);

        content.appendChild(sliderRow);

        return container;
    }

    private createDropdownElement(
        options: { value: string; label: string }[],
        defaultValue: string,
        onChange: (value: string) => void,
        _panelContainer?: HTMLElement | null
    ): HTMLElement {
        const dropdown = new Dropdown({
            options,
            selectedValue: defaultValue
        });
        dropdown.element.classList.add('shading-dropdown');
        this.dropdowns.push(dropdown);
        dropdown.onChange((value) => {
            onChange(value);
        });
        return dropdown.element;
    }

    private createDropdownSection(title: string, options: { value: string; label: string }[], defaultValue: string, onChange: (value: string) => void, panelContainer?: HTMLElement | null): HTMLElement {
        const { container, content } = this.createContainer(title);

        const dropdown = this.createDropdownElement(options, defaultValue, onChange, panelContainer);
        content.appendChild(dropdown);

        return container;
    }

    private createToggleSection(title: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
        const { container, content } = this.createContainer(title);
        content.style.display = 'none';

        const toggleTrack = document.createElement('div');
        toggleTrack.className = 'shading-toggle' + (value ? ' active' : '');

        const toggleThumb = document.createElement('div');
        toggleThumb.className = 'shading-toggle-thumb';

        toggleTrack.appendChild(toggleThumb);

        const titleEl = container.querySelector('.shading-container-title') as HTMLElement;
        titleEl.appendChild(toggleTrack);

        toggleTrack.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = toggleTrack.classList.toggle('active');
            onChange(isActive);
        });

        return container;
    }

    private createSpaModeSection(currentMode: string, hasTexture: boolean, onChange: (mode: 'off' | 'multiply' | 'add' | 'subTexture') => void): HTMLElement {
        const { container, content } = this.createContainer('Spa 贴图');

        if (!hasTexture) {
            const noTexture = document.createElement('div');
            noTexture.className = 'shading-spa-no-texture';
            noTexture.textContent = '该材质无 Spa 贴图';
            content.appendChild(noTexture);
            return container;
        }

        const modeContainer = document.createElement('div');
        modeContainer.className = 'shading-spa-mode-container';

        const modes: { value: 'off' | 'multiply' | 'add' | 'subTexture'; label: string }[] = [
            { value: 'off', label: '关闭' },
            { value: 'multiply', label: '乘算' },
            { value: 'add', label: '加算' },
            { value: 'subTexture', label: '副纹理' }
        ];

        modes.forEach(mode => {
            const btn = document.createElement('div');
            btn.className = `shading-spa-mode-btn${mode.value === currentMode ? ' active' : ''}`;
            btn.textContent = mode.label;

            btn.addEventListener('click', () => {
                modeContainer.querySelectorAll('.shading-spa-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                onChange(mode.value);
            });

            modeContainer.appendChild(btn);
        });

        content.appendChild(modeContainer);

        return container;
    }

    private disposeDropdowns(): void {
        this.dropdowns.forEach(d => d.dispose());
        this.dropdowns = [];
    }

    dispose(): void {
        this.disposeDropdowns();

        this.sliders.forEach(s => s.dispose());
        this.sliders = [];
        this.materialParams = null;
        this.paramsEmpty = null;
        this.currentModelId = null;
        this.element.remove();
    }
}
