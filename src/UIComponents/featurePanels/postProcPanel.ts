
import type { IPanel } from '../../core/IPanel';
import type { MainWindow } from '../MainWindow';
import type { SceneManager } from '../../features/scene';
import type { MmdModelProvider } from '../../features/scene/AutoFocusController';
import type { IPostProcessAdapter } from '../../core/IPostProcessAdapter';
import type { ControlDeclaration } from '../../core/IPlugin';
import type { ParamValue } from '../../core/IMaterialAdapter';
import type { Scene, Camera } from '@babylonjs/core';
import { injectStyles } from '../../styles/mainWindow.css';
import { postProcPanelStyles } from '../../styles/panels/postProcPanel.css';
import { PostProcStateManager, type PostProcState } from '../../features/state/PostProcStateManager';
import type { Color3State } from '../../features/state/ShadingStateManager';
import { PostProcessManager } from '../../features/scene/PostProcessManager';
import { postProcessAdapterRegistry } from '../../features/postproc/PostProcessAdapterRegistry';
import { getSharedPostProcessManager } from '../../features/project/ProjectRestorer';
import { Events, eventBus } from '../../core';
import { Slider } from '../shared/Slider';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { Dropdown } from '../shared/Dropdown';
import { RGBColorPicker } from '../shared/RGBColorPicker';
import { CollapsibleSection } from '../shared/CollapsibleSection';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

const AUTO_FOCUS_NONE_VALUE = '__none__';

export class PostProcPanel implements IPanel {
    readonly id = 'postprocess';
    readonly tabLabel = '后处理';
    readonly tabIcon = TAB_ICON;
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private sceneManager: SceneManager | null;
    private postProcessManager: PostProcessManager | null = null;
    private autoFocusDropdown: Dropdown | null = null;
    private aaSamplesSlider: Slider | null = null;
    private unsubscribePostProc: (() => void) | null = null;
    private unsubscribeAdapterRegistered: (() => void) | null = null;
    private unsubscribeAdapterUnregistered: (() => void) | null = null;
    private isInitialized: boolean = false;
    private initPromise: Promise<void> | null = null;
    private sliders: Slider[] = [];
    private toggles: ToggleSwitch[] = [];
    private colorPickers: RGBColorPicker[] = [];
    private collapsibleSections: CollapsibleSection[] = [];

    /** 插件效果容器 */
    private pluginEffectsContainer: HTMLElement;
    /** 已渲染的适配器 typeId → DOM 元素映射 */
    private renderedAdapters = new Map<string, HTMLElement>();
    /** 适配器状态缓存 typeId → state */
    private adapterStates = new Map<string, Record<string, ParamValue>>();

    constructor(options: { mainWindow?: MainWindow; sceneManager: SceneManager | null }) {
        this.mainWindow = options.mainWindow ?? null;
        this.sceneManager = options.sceneManager;
        injectStyles(postProcPanelStyles, 'panel-postproc');
        this.pluginEffectsContainer = document.createElement('div');
        this.pluginEffectsContainer.className = 'post-proc-plugin-effects';
        this.element = this.buildPanel();
    }

    private buildPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'post-proc-panel';

        const state = PostProcStateManager.getInstance().getState();

        const aaSection = this.createAntiAliasingSection(state);
        const bloomSection = this.createBloomCollapsibleSection(state);
        const dofSection = this.createDOFCollapsibleSection(state);
        const specialEffectsSection = this.createSpecialEffectsCollapsibleSection(state);

        panel.appendChild(aaSection);
        panel.appendChild(dofSection);
        panel.appendChild(specialEffectsSection);
        panel.appendChild(bloomSection);
        panel.appendChild(this.pluginEffectsContainer);

        // 渲染已注册的插件适配器
        this.renderExistingAdapters();

        return panel;
    }

    private async initializePostProcessManager(): Promise<void> {
        if (!this.sceneManager || this.isInitialized) return;

        try {
            const scene = this.sceneManager.getScene();
            const camera = this.sceneManager.getCamera();

            if (!scene || !camera) return;

            // 优先复用 restore 时创建的共享 PostProcessManager
            const sharedPpm = getSharedPostProcessManager();
            if (sharedPpm) {
                this.postProcessManager = sharedPpm;
            } else {
                const modelProvider = await this.buildModelProvider();
                if (!this.postProcessManager) {
                    this.postProcessManager = new PostProcessManager();
                }
                this.postProcessManager.initialize(scene, camera, modelProvider);

                const state = PostProcStateManager.getInstance().getState();
                this.postProcessManager.applyState(state);
            }

            this.isInitialized = true;

            // 初始化已注册的插件适配器
            this.initializeRegisteredAdapters(scene, camera);
        } catch (error) {
            console.error('初始化 PostProcessManager 失败:', error);
        }
    }

    private async buildModelProvider(): Promise<MmdModelProvider | undefined> {
        if (!this.mainWindow) return undefined;

        const modelManager = this.mainWindow.getModelManager();
        const animationManager = this.mainWindow.getAnimationManager();

        if (!modelManager || !animationManager) return undefined;

        const modelProvider: MmdModelProvider = {
            getMmdModel(modelId: string) {
                return animationManager.getMmdModel(modelId);
            },
            getAllMmdModelIds(): string[] {
                const models = modelManager.getAllModels();
                return models.map(m => m.id);
            },
            getMeshForModel(modelId: string) {
                const models = modelManager.getAllModels();
                const model = models.find(m => m.id === modelId);
                return model?.mesh || undefined;
            }
        };

        return modelProvider;
    }

    private createCollapsibleItem(
        title: string,
        innerElements: HTMLElement[],
        defaultExpanded: boolean = true
    ): HTMLElement {
        const collapsible = new CollapsibleSection({ title, initiallyExpanded: defaultExpanded });
        collapsible.element.classList.add('post-proc-item');
        collapsible.getContentContainer().style.padding = '0 20px 16px 20px';
        collapsible.getContentContainer().style.display = 'flex';
        collapsible.getContentContainer().style.flexDirection = 'column';
        collapsible.getContentContainer().style.gap = '8px';
        collapsible.element.querySelector('.mp-collapsible-header')!.classList.add('post-proc-item-header');

        innerElements.forEach(el => collapsible.getContentContainer().appendChild(el));

        this.collapsibleSections.push(collapsible);
        return collapsible.element;
    }

    private async loadAutoFocusOptions(initialModelId: string): Promise<void> {
        const modelOptions = await this.getModelOptions();
        const allOptions = [
            { value: AUTO_FOCUS_NONE_VALUE, label: '无' },
            ...modelOptions
        ];
        const currentId = PostProcStateManager.getInstance().getState().dofAutoFocusModelId || initialModelId;
        this.autoFocusDropdown?.setOptions(allOptions);
        this.autoFocusDropdown?.setValue(currentId);
    }

    private createSliderItem(
        label: string,
        initialValue: number,
        min: number,
        max: number,
        step: number,
        onChange?: (value: number) => void
    ): HTMLElement {
        const slider = new Slider({
            label,
            min,
            max,
            step,
            value: initialValue,
            valueFormatter: (v) => v.toFixed(2)
        });
        slider.onChange((value) => { onChange?.(value); });
        this.sliders.push(slider);
        return slider.element;
    }

    private createToggleItem(
        label: string,
        defaultEnabled: boolean,
        onChange?: (enabled: boolean) => void
    ): HTMLElement {
        const toggle = new ToggleSwitch({
            label,
            initialState: defaultEnabled
        });
        toggle.onChange((value) => { onChange?.(value); });
        this.toggles.push(toggle);
        return toggle.element;
    }

    //创建抗锯齿设置项
    private createAntiAliasingSection(state: PostProcState): HTMLElement {
        const toggle = this.createToggleItem('启用抗锯齿 (FXAA)', state.aaEnabled, (enabled) => {
            PostProcStateManager.getInstance().setAAEnabled(enabled);
        });

        // 采样数滑块
        const samplesSlider = new Slider({
            label: '采样数',
            min: 1,
            max: 8,
            step: 1,
            value: state.samples,
            valueFormatter: (v) => v.toFixed(0)
        });
        samplesSlider.onChange((value) => {
            PostProcStateManager.getInstance().setSamples(value);
        });
        this.sliders.push(samplesSlider);
        this.aaSamplesSlider = samplesSlider;

        return this.createCollapsibleItem('抗锯齿', [toggle, samplesSlider.element], false);
    }

    //创建色彩调整子功能
    private createColorAdjustSection(state: PostProcState): HTMLElement {
        const section = document.createElement('div');
        section.className = 'post-proc-special-section';

        const title = document.createElement('div');
        title.className = 'post-proc-special-section-title';
        title.textContent = '色彩调整';

        const exposureSlider = this.createSliderItem('曝光', state.exposure, -1, 1, 0.01, (value) => {
            PostProcStateManager.getInstance().setExposure(value);
        });

        const saturationSlider = this.createSliderItem('饱和度', state.saturation, 0, 2, 0.01, (value) => {
            PostProcStateManager.getInstance().setSaturation(value);
        });

        const contrastSlider = this.createSliderItem('对比度', state.contrast, 0, 2, 0.01, (value) => {
            PostProcStateManager.getInstance().setContrast(value);
        });

        section.appendChild(title);
        section.appendChild(exposureSlider);
        section.appendChild(saturationSlider);
        section.appendChild(contrastSlider);

        return section;
    }

    //创建Bloom设置项
    private createBloomCollapsibleSection(state: PostProcState): HTMLElement {
        const toggle = this.createToggleItem('启用 Bloom', state.bloomEnabled, (enabled) => {
            PostProcStateManager.getInstance().setBloomEnabled(enabled);
        });

        const intensitySlider = this.createSliderItem('强度', state.bloomIntensity, 0, 2, 0.01, (value) => {
            PostProcStateManager.getInstance().setBloomIntensity(value);
        });

        const thresholdSlider = this.createSliderItem('阈值', state.bloomThreshold, 0, 1, 0.01, (value) => {
            PostProcStateManager.getInstance().setBloomThreshold(value);
        });

        const radiusSlider = this.createSliderItem('半径', state.bloomKernel, 16, 128, 1, (value) => {
            PostProcStateManager.getInstance().setBloomKernel(value);
        });

        return this.createCollapsibleItem('Bloom', [toggle, intensitySlider, thresholdSlider, radiusSlider], false);
    }

    //创建DoF设置项
    private createDOFCollapsibleSection(state: PostProcState): HTMLElement {
        const toggle = this.createToggleItem('启用景深', state.dofEnabled, (enabled) => {
            PostProcStateManager.getInstance().setDOFEnabled(enabled);
        });

        const autoFocusToggle = this.createToggleItem('自动对焦', state.dofAutoFocusEnabled, (enabled) => {
            PostProcStateManager.getInstance().setDOFAutoFocusEnabled(enabled);
        });

        const autoFocusDropdown = this.createAutoFocusDropdown(state);

        const blurIntensitySlider = this.createSliderItem('模糊强度', state.dofBlurIntensity, 0, 1, 0.01, (value) => {
            PostProcStateManager.getInstance().setDOFBlurIntensity(value);
        });

        const focusDistanceSlider = this.createSliderItem('对焦距离', state.dofFocusDistance, 0, 200, 1, (value) => {
            PostProcStateManager.getInstance().setDOFFocusDistance(value);
        });

        const dofDepthSlider = this.createSliderItem('景深范围', state.dofDepth, 0.1, 100, 0.5, (value) => {
            PostProcStateManager.getInstance().setDOFDepth(value);
        });

        return this.createCollapsibleItem('景深 (DoF)', [
            toggle,
            autoFocusToggle,
            autoFocusDropdown,
            blurIntensitySlider,
            focusDistanceSlider,
            dofDepthSlider
        ], false);
    }

    // 创建特效设置项（色彩调整、暗角、色散、颗粒、柔焦、色调）
    private createSpecialEffectsCollapsibleSection(state: PostProcState): HTMLElement {
        const colorAdjustSection = this.createColorAdjustSection(state);
        const vignetteSection = this.createVignetteSection(state);
        const caSection = this.createCASection(state);
        const grainSection = this.createGrainSection(state);
        const softFocusSection = this.createSoftFocusSection(state);
        const hueSection = this.createHueSection(state);

        return this.createCollapsibleItem('滤镜', [hueSection, softFocusSection, caSection, colorAdjustSection,vignetteSection, grainSection], false);
    }

    private createHueSection(state: PostProcState): HTMLElement {
        const section = document.createElement('div');
        section.className = 'post-proc-special-section';

        const title = document.createElement('div');
        title.className = 'post-proc-special-section-title';
        title.textContent = '色调';

        const toggle = this.createToggleItem('启用', state.hueEnabled, (enabled) => {
            PostProcStateManager.getInstance().setHueEnabled(enabled);
        });

        const hueSlider = this.createSliderItem('HUE', state.hueShift, -180, 180, 0.5, (value) => {
            PostProcStateManager.getInstance().setHueShift(value);
        });

        section.appendChild(title);
        section.appendChild(toggle);
        section.appendChild(hueSlider);

        return section;
    }

    private createVignetteSection(state: PostProcState): HTMLElement {
        const section = document.createElement('div');
        section.className = 'post-proc-special-section';

        const title = document.createElement('div');
        title.className = 'post-proc-special-section-title';
        title.textContent = '暗角';

        const toggle = this.createToggleItem('启用', state.vignetteEnabled, (enabled) => {
            PostProcStateManager.getInstance().setVignetteEnabled(enabled);
        });

        const intensitySlider = this.createSliderItem('强度', state.vignetteIntensity, 0, 1, 0.01, (value) => {
            PostProcStateManager.getInstance().setVignetteIntensity(value);
        });

        const softnessSlider = this.createSliderItem('柔和度', state.vignetteSoftness, 0, 0.5, 0.01, (value) => {
            PostProcStateManager.getInstance().setVignetteSoftness(value);
        });

        const colorPicker = new RGBColorPicker({
            label: '暗角色',
            color: state.vignetteColor ?? { r: 0, g: 0, b: 0 },
            mode: 'popup'
        });
        colorPicker.onChange(({ r, g, b }) => {
            PostProcStateManager.getInstance().setVignetteColor(r, g, b);
        });
        this.colorPickers.push(colorPicker);

        section.appendChild(title);
        section.appendChild(toggle);
        section.appendChild(intensitySlider);
        section.appendChild(softnessSlider);
        section.appendChild(colorPicker.element);

        return section;
    }

    private createCASection(state: PostProcState): HTMLElement {
        const section = document.createElement('div');
        section.className = 'post-proc-special-section';

        const title = document.createElement('div');
        title.className = 'post-proc-special-section-title';
        title.textContent = '色散';

        const toggle = this.createToggleItem('启用', state.caEnabled, (enabled) => {
            PostProcStateManager.getInstance().setCAEnabled(enabled);
        });

        const intensitySlider = this.createSliderItem('强度', state.caIntensity, 0, 0.1, 0.001, (value) => {
            PostProcStateManager.getInstance().setCAIntensity(value);
        });

        section.appendChild(title);
        section.appendChild(toggle);
        section.appendChild(intensitySlider);

        return section;
    }

    private createGrainSection(state: PostProcState): HTMLElement {
        const section = document.createElement('div');
        section.className = 'post-proc-special-section';

        const title = document.createElement('div');
        title.className = 'post-proc-special-section-title';
        title.textContent = '胶片颗粒';

        const toggle = this.createToggleItem('启用', state.grainEnabled, (enabled) => {
            PostProcStateManager.getInstance().setGrainEnabled(enabled);
        });

        const intensitySlider = this.createSliderItem('强度', state.grainIntensity, 0, 0.3, 0.005, (value) => {
            PostProcStateManager.getInstance().setGrainIntensity(value);
        });

        section.appendChild(title);
        section.appendChild(toggle);
        section.appendChild(intensitySlider);

        return section;
    }

    private createSoftFocusSection(state: PostProcState): HTMLElement {
        const section = document.createElement('div');
        section.className = 'post-proc-special-section';

        const title = document.createElement('div');
        title.className = 'post-proc-special-section-title';
        title.textContent = '柔焦';

        const toggle = this.createToggleItem('启用', state.softFocusEnabled, (enabled) => {
            PostProcStateManager.getInstance().setSoftFocusEnabled(enabled);
        });

        const intensitySlider = this.createSliderItem('强度', state.softFocusIntensity, 0, 1, 0.01, (value) => {
            PostProcStateManager.getInstance().setSoftFocusIntensity(value);
        });

        section.appendChild(title);
        section.appendChild(toggle);
        section.appendChild(intensitySlider);

        return section;
    }

    private async getModelOptions(): Promise<{ value: string; label: string }[]> {
        const modelManager = this.mainWindow?.getModelManager();
        if (!modelManager) return [];
        const models = modelManager.getAllModels();
        return models.map(m => ({ value: m.id, label: m.name }));
    }

    private createAutoFocusDropdown(state: PostProcState): HTMLElement {
        const currentModelId = state.dofAutoFocusModelId || AUTO_FOCUS_NONE_VALUE;

        this.autoFocusDropdown = new Dropdown({
            options: [{ value: AUTO_FOCUS_NONE_VALUE, label: '无' }],
            selectedValue: currentModelId,
            placeholder: '加载中...'
        });

        this.autoFocusDropdown.onChange((value) => {
            PostProcStateManager.getInstance().setDOFAutoFocusModelId(value);
        });

        this.loadAutoFocusOptions(currentModelId);

        return this.autoFocusDropdown.element;
    }

    private updateAutoFocusUI(state: PostProcState): void {
        const modelId = state.dofAutoFocusModelId || AUTO_FOCUS_NONE_VALUE;
        this.autoFocusDropdown?.setValue(modelId);
    }

    // ========== 插件适配器动态渲染 ==========

    /** 渲染构建面板时已注册的适配器 */
    private renderExistingAdapters(): void {
        const adapters = postProcessAdapterRegistry.getAll();
        for (const adapter of adapters) {
            this.renderAdapterSection(adapter);
        }
    }

    /** 初始化已注册的适配器（场景/相机就绪后调用） */
    private initializeRegisteredAdapters(scene: Scene, camera: Camera): void {
        const adapters = postProcessAdapterRegistry.getAll();
        console.log(`[PostProcPanel] 初始化已注册适配器, 数量: ${adapters.length}`);
        for (const adapter of adapters) {
            if (!adapter.isInitialized()) {
                console.log(`[PostProcPanel] 初始化适配器: ${adapter.typeId} (${adapter.displayName})`);
                adapter.initialize(scene, camera);
            }
            if (!adapter.isEnabled()) {
                console.log(`[PostProcPanel] 启用适配器: ${adapter.typeId}`);
                adapter.setEnabled(true);
            }
        }
    }

    /** 处理适配器注册事件 */
    private handleAdapterRegistered(typeId: string): void {
        const adapter = postProcessAdapterRegistry.get(typeId);
        if (!adapter) {
            console.warn(`[PostProcPanel] 适配器注册事件: 未找到适配器 ${typeId}`);
            return;
        }

        console.log(`[PostProcPanel] 适配器注册事件: ${typeId} (${adapter.displayName})`);

        // 渲染 UI
        this.renderAdapterSection(adapter);

        // 如果场景已初始化，立即初始化并启用适配器
        if (this.isInitialized && this.sceneManager) {
            const scene = this.sceneManager.getScene();
            const camera = this.sceneManager.getCamera();
            if (scene && camera) {
                if (!adapter.isInitialized()) {
                    console.log(`[PostProcPanel] 初始化适配器: ${typeId}`);
                    adapter.initialize(scene, camera);
                }
                if (!adapter.isEnabled()) {
                    console.log(`[PostProcPanel] 启用适配器: ${typeId}`);
                    adapter.setEnabled(true);
                }
            }
        }
    }

    /** 处理适配器注销事件 */
    private handleAdapterUnregistered(typeId: string): void {
        // 移除 DOM
        const sectionEl = this.renderedAdapters.get(typeId);
        if (sectionEl) {
            sectionEl.remove();
            this.renderedAdapters.delete(typeId);
        }
        this.adapterStates.delete(typeId);
    }

    /** 为单个适配器渲染折叠区域 */
    private renderAdapterSection(adapter: IPostProcessAdapter): void {
        if (this.renderedAdapters.has(adapter.typeId)) return;

        const state = { ...adapter.getDefaultState(), ...adapter.readState() };
        this.adapterStates.set(adapter.typeId, state);

        const declarations = adapter.getControlDeclarations();
        if (declarations.length === 0) return;

        // 按分组构建控件
        const groups = this.buildAdapterGroups(declarations);
        const innerElements: HTMLElement[] = [];

        for (const group of groups) {
            if (group.declarations.length === 1 && !group.name) {
                // 无分组单控件
                const el = this.createAdapterControl(adapter, group.declarations[0], state);
                if (el) innerElements.push(el);
            } else {
                // 分组控件
                const groupEl = this.createAdapterGroupedControls(adapter, group, state);
                if (groupEl) innerElements.push(groupEl);
            }
        }

        if (innerElements.length === 0) return;

        const section = this.createCollapsibleItem(adapter.displayName, innerElements, false);
        section.dataset.adapterTypeId = adapter.typeId;
        this.renderedAdapters.set(adapter.typeId, section);
        this.pluginEffectsContainer.appendChild(section);
    }

    /** 构建适配器控件的分组信息 */
    private buildAdapterGroups(declarations: ControlDeclaration[]): AdapterGroupInfo[] {
        const groupMap = new Map<string, AdapterGroupInfo>();
        const groups: AdapterGroupInfo[] = [];

        for (const decl of declarations) {
            const groupName = (decl as { group?: string }).group;
            if (groupName) {
                if (!groupMap.has(groupName)) {
                    const group: AdapterGroupInfo = { name: groupName, title: groupName, declarations: [] };
                    groupMap.set(groupName, group);
                    groups.push(group);
                }
                groupMap.get(groupName)!.declarations.push(decl);
            } else {
                groups.push({ name: '', title: '', declarations: [decl] });
            }
        }

        return groups;
    }

    /** 创建分组控件容器（参照 MaterialParamsSection 的分组渲染逻辑） */
    private createAdapterGroupedControls(
        adapter: IPostProcessAdapter,
        group: AdapterGroupInfo,
        state: Record<string, ParamValue>
    ): HTMLElement | null {
        const collapsible = new CollapsibleSection({ title: group.title, initiallyExpanded: true });
        collapsible.element.classList.add('post-proc-item');
        collapsible.getContentContainer().style.padding = '0 20px 16px 20px';
        collapsible.getContentContainer().style.display = 'flex';
        collapsible.getContentContainer().style.flexDirection = 'column';
        collapsible.getContentContainer().style.gap = '8px';
        collapsible.element.querySelector('.mp-collapsible-header')!.classList.add('post-proc-item-header');

        const header = collapsible.element.querySelector('.mp-collapsible-header')!;
        const arrow = header.querySelector('.mp-collapsible-arrow')!;

        for (const decl of group.declarations) {
            if (decl.type === 'toggle') {
                // toggle 放入标题栏
                const currentValue = !!state[decl.param];
                const toggleTrack = document.createElement('div');
                toggleTrack.className = 'shading-toggle' + (currentValue ? ' active' : '');
                const toggleThumb = document.createElement('div');
                toggleThumb.className = 'shading-toggle-thumb';
                toggleTrack.appendChild(toggleThumb);
                header.insertBefore(toggleTrack, arrow);

                toggleTrack.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newState = !toggleTrack.classList.contains('active');
                    toggleTrack.classList.toggle('active', newState);
                    this.updateAdapterState(adapter, decl.param, newState);
                });
            } else if (decl.type === 'color') {
                // color 预览放入标题栏
                const color = (state[decl.param] as Color3State) ?? { r: 0, g: 0, b: 0 };
                const colorPreview = document.createElement('div');
                colorPreview.className = 'shading-color-preview';
                this.updateColorPreview(colorPreview, color);
                header.insertBefore(colorPreview, arrow);

                colorPreview.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openColorPicker(adapter, decl.param, colorPreview, state);
                });
            } else {
                // slider / dropdown 放入内容区
                const el = this.createAdapterControl(adapter, decl, state);
                if (el) collapsible.getContentContainer().appendChild(el);
            }
        }

        this.collapsibleSections.push(collapsible);
        return collapsible.element;
    }

    /** 创建单个适配器控件 */
    private createAdapterControl(
        adapter: IPostProcessAdapter,
        decl: ControlDeclaration,
        state: Record<string, ParamValue>
    ): HTMLElement | null {
        switch (decl.type) {
            case 'slider': {
                const value = state[decl.param] as number ?? decl.min;
                return this.createSliderItem(decl.label, value, decl.min, decl.max, decl.step, (v) => {
                    this.updateAdapterState(adapter, decl.param, v);
                });
            }
            case 'toggle': {
                const enabled = !!state[decl.param];
                return this.createToggleItem(decl.label, enabled, (v) => {
                    this.updateAdapterState(adapter, decl.param, v);
                });
            }
            case 'color': {
                const color = (state[decl.param] as Color3State) ?? { r: 0, g: 0, b: 0 };
                const wrapper = document.createElement('div');
                wrapper.className = 'post-proc-color-item';

                const label = document.createElement('span');
                label.className = 'post-proc-color-label';
                label.textContent = decl.label;

                const colorPreview = document.createElement('div');
                colorPreview.className = 'shading-color-preview';
                this.updateColorPreview(colorPreview, color);

                colorPreview.addEventListener('click', () => {
                    this.openColorPicker(adapter, decl.param, colorPreview, state);
                });

                wrapper.appendChild(label);
                wrapper.appendChild(colorPreview);
                return wrapper;
            }
            case 'dropdown': {
                const currentValue = state[decl.param] as string ?? decl.options[0];
                const dropdown = new Dropdown({
                    options: decl.options.map((opt, i) => ({
                        value: opt,
                        label: decl.optionLabels?.[i] ?? opt
                    })),
                    selectedValue: currentValue,
                    placeholder: decl.label
                });
                dropdown.onChange((value) => {
                    this.updateAdapterState(adapter, decl.param, value);
                });
                return dropdown.element;
            }
            default:
                return null;
        }
    }

    /** 更新适配器状态并写入 */
    private updateAdapterState(adapter: IPostProcessAdapter, param: string, value: ParamValue): void {
        const state = this.adapterStates.get(adapter.typeId);
        if (!state) {
            console.warn(`[PostProcPanel] updateAdapterState: 未找到适配器状态 ${adapter.typeId}`);
            return;
        }

        state[param] = value;
        console.log(`[PostProcPanel] 更新适配器 ${adapter.typeId} 参数: ${param} = ${JSON.stringify(value)}`);
        // 直接传入 state 对象，避免每次创建浅拷贝
        adapter.writeState(state);
    }

    /** 更新颜色预览块 */
    private updateColorPreview(el: HTMLElement, color: Color3State): void {
        el.style.backgroundColor = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
    }

    /** 打开颜色选择器（使用与着色面板一致的弹窗方式） */
    private openColorPicker(
        adapter: IPostProcessAdapter,
        param: string,
        previewEl: HTMLElement,
        state: Record<string, ParamValue>
    ): void {
        // 复用 state 中已有的颜色对象，避免创建新对象
        const currentColor = (state[param] as Color3State) ?? { r: 0, g: 0, b: 0 };
        // 如果 state 中没有颜色对象，创建一个并存入 state
        if (!state[param]) {
            state[param] = currentColor;
        }

        const colorPickerPopup = document.createElement('div');
        colorPickerPopup.className = 'shading-color-picker-popup';

        const redSlider = this.createRGBSlider('R', currentColor.r, (value) => {
            currentColor.r = value;
            previewEl.style.backgroundColor = `rgb(${Math.round(currentColor.r * 255)}, ${Math.round(currentColor.g * 255)}, ${Math.round(currentColor.b * 255)})`;
            // 直接传入 currentColor 对象，避免创建浅拷贝
            this.updateAdapterState(adapter, param, currentColor);
        });
        const greenSlider = this.createRGBSlider('G', currentColor.g, (value) => {
            currentColor.g = value;
            previewEl.style.backgroundColor = `rgb(${Math.round(currentColor.r * 255)}, ${Math.round(currentColor.g * 255)}, ${Math.round(currentColor.b * 255)})`;
            this.updateAdapterState(adapter, param, currentColor);
        });
        const blueSlider = this.createRGBSlider('B', currentColor.b, (value) => {
            currentColor.b = value;
            previewEl.style.backgroundColor = `rgb(${Math.round(currentColor.r * 255)}, ${Math.round(currentColor.g * 255)}, ${Math.round(currentColor.b * 255)})`;
            this.updateAdapterState(adapter, param, currentColor);
        });
        const confirmButton = document.createElement('button');
        confirmButton.className = 'shading-color-confirm-btn';
        confirmButton.textContent = '确定';
        confirmButton.addEventListener('click', () => {
            colorPickerPopup.classList.remove('visible');
        });

        colorPickerPopup.appendChild(redSlider);
        colorPickerPopup.appendChild(greenSlider);
        colorPickerPopup.appendChild(blueSlider);
        colorPickerPopup.appendChild(confirmButton);
        this.element.appendChild(colorPickerPopup);

        // 关闭其他已打开的颜色选择器
        this.element.querySelectorAll('.shading-color-picker-popup.visible').forEach((popup) => {
            if (popup !== colorPickerPopup) {
                popup.classList.remove('visible');
            }
        });
        colorPickerPopup.classList.toggle('visible');

        // 点击外部关闭
        const outsideClickHandler = (e: MouseEvent) => {
            if (!colorPickerPopup.contains(e.target as Node) && e.target !== previewEl) {
                colorPickerPopup.classList.remove('visible');
                document.removeEventListener('click', outsideClickHandler);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', outsideClickHandler);
        }, 0);
    }

    /** 创建 RGB 滑块（与着色面板一致的实现） */
    private createRGBSlider(label: string, initialValue: number, onChange?: (value: number) => void): HTMLElement {
        const container = document.createElement('div');
        container.className = 'shading-rgb-slider-container';

        const labelElement = document.createElement('span');
        labelElement.className = `shading-rgb-label shading-rgb-label-${label.toLowerCase()}`;
        labelElement.textContent = label;

        const sliderWrapper = document.createElement('div');
        sliderWrapper.className = 'shading-rgb-slider-wrapper';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'shading-rgb-slider';
        slider.min = '0';
        slider.max = '255';
        slider.step = '1';
        slider.value = Math.round(initialValue * 255).toString();

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'shading-rgb-value';
        valueDisplay.textContent = Math.round(initialValue * 255).toString();

        slider.addEventListener('input', () => {
            const value = parseInt(slider.value);
            valueDisplay.textContent = value.toString();
            onChange?.(value / 255);
        });

        sliderWrapper.appendChild(slider);
        sliderWrapper.appendChild(valueDisplay);

        container.appendChild(labelElement);
        container.appendChild(sliderWrapper);

        return container;
    }

    onShown(): void {
        // 如果共享后处理管理器已被替换（例如加载了新工程），需要重新初始化
        const sharedPpm = getSharedPostProcessManager();
        if (sharedPpm && sharedPpm !== this.postProcessManager) {
            this.isInitialized = false;
        }

        if (!this.isInitialized) {
            this.initPromise = this.initializePostProcessManager();
        }

        if (this.unsubscribePostProc) {
            this.unsubscribePostProc();
        }
        this.unsubscribePostProc = eventBus.on(Events.POSTPROC_CHANGED, (data: PostProcState) => {
            if (this.postProcessManager) {
                this.postProcessManager.applyState(data);
            }
            this.updateAutoFocusUI(data);
        });

        // 监听后处理适配器注册/注销事件
        if (this.unsubscribeAdapterRegistered) {
            this.unsubscribeAdapterRegistered();
        }
        this.unsubscribeAdapterRegistered = eventBus.on(Events.POSTPROC_ADAPTER_REGISTERED, (data: { typeId: string }) => {
            this.handleAdapterRegistered(data.typeId);
        });

        if (this.unsubscribeAdapterUnregistered) {
            this.unsubscribeAdapterUnregistered();
        }
        this.unsubscribeAdapterUnregistered = eventBus.on(Events.POSTPROC_ADAPTER_UNREGISTERED, (data: { typeId: string }) => {
            this.handleAdapterUnregistered(data.typeId);
        });
    }

    onHidden(): void {
        if (this.unsubscribePostProc) {
            this.unsubscribePostProc();
            this.unsubscribePostProc = null;
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

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        this.element.remove();
    }

    dispose(): void {
        this.onHidden();
        this.sliders.forEach(s => s.dispose());
        this.sliders = [];
        this.toggles.forEach(t => t.dispose());
        this.toggles = [];
        this.colorPickers.forEach(c => c.dispose());
        this.colorPickers = [];
        this.collapsibleSections.forEach(c => c.dispose());
        this.collapsibleSections = [];
        if (this.postProcessManager) {
            this.postProcessManager.dispose();
            this.postProcessManager = null;
        }
        this.autoFocusDropdown?.dispose();
        this.autoFocusDropdown = null;
        this.aaSamplesSlider = null;
        this.renderedAdapters.clear();
        this.adapterStates.clear();
        this.element.remove();
    }
}

interface AdapterGroupInfo {
    name: string;
    title: string;
    declarations: ControlDeclaration[];
}

let panelInstance: PostProcPanel | null = null;

export default PostProcPanel;

export function createPanelContent(mainWindow?: MainWindow): HTMLElement {
    if (panelInstance) {
        panelInstance.dispose();
        panelInstance = null;
    }

    panelInstance = new PostProcPanel({
        mainWindow,
        sceneManager: mainWindow?.getSceneManager() ?? null
    });

    return panelInstance.element;
}

export function disposePostProcessManager(): void {
    if (panelInstance) {
        panelInstance.dispose();
        panelInstance = null;
    }
}
