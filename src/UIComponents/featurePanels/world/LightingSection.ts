
import type { SceneManager } from '../../../features/scene';
import { Slider } from '../../shared/Slider';
import { RGBColorPicker } from '../../shared/RGBColorPicker';
import { ToggleSwitch } from '../../shared/ToggleSwitch';
import { Dropdown } from '../../shared/Dropdown';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { Events, eventBus } from '../../../core';

export class LightingSection {
    readonly element: DocumentFragment;

    private lightingCollapsible: CollapsibleSection | null = null;
    private shadowCollapsible: CollapsibleSection | null = null;

    private sceneManager: SceneManager | null;
    private sliders: Slider[] = [];
    private colorPickers: RGBColorPicker[] = [];
    private toggles: ToggleSwitch[] = [];
    private dropdowns: Dropdown[] = [];

    constructor(sceneManager: SceneManager | null) {
        this.sceneManager = sceneManager;

        this.lightingCollapsible = new CollapsibleSection({ title: '光照控制', initiallyExpanded: false });
        this.lightingCollapsible.element.classList.add('world-item');
        const lightingInner = this.lightingCollapsible.getContentContainer();
        lightingInner.style.padding = '0 20px 16px 20px';
        lightingInner.style.display = 'flex';
        lightingInner.style.flexDirection = 'column';
        lightingInner.style.gap = '12px';
        this.lightingCollapsible.element.querySelector('.mp-collapsible-header')!.classList.add('world-item-header');

        this.shadowCollapsible = new CollapsibleSection({ title: '阴影设置', initiallyExpanded: false });
        this.shadowCollapsible.element.classList.add('world-item', 'overflow-visible');
        const shadowInner = this.shadowCollapsible.getContentContainer();
        shadowInner.style.padding = '0 20px 16px 20px';
        shadowInner.style.display = 'flex';
        shadowInner.style.flexDirection = 'column';
        shadowInner.style.gap = '8px';
        this.shadowCollapsible.element.querySelector('.mp-collapsible-header')!.classList.add('world-item-header');

        const lightConfig = this.sceneManager?.getLightConfig();

        this.buildLightingControls(this.lightingCollapsible.getContentContainer(), lightConfig);
        this.buildShadowControls(this.shadowCollapsible.getContentContainer());

        // 使用 DocumentFragment 作为根，避免在 DOM 中增加多余容器层级
        const fragment = document.createDocumentFragment();
        fragment.appendChild(this.lightingCollapsible.element);
        fragment.appendChild(this.shadowCollapsible.element);
        this.element = fragment;
    }

    /**
     * 构建光照控制（环境光 + 方向光），继续使用 world-lighting-section
     */
    private buildLightingControls(inner: HTMLElement, lightConfig: any): void {
        const ambientSection = this.createAmbientSection(lightConfig);
        const directionalSection = this.createDirectionalSection(lightConfig);

        inner.appendChild(ambientSection);
        inner.appendChild(directionalSection);
    }

    /**
     * 构建阴影控制 —— 直接以普通控件形式呈现，不再被 world-lighting-section 包裹
     */
    private buildShadowControls(inner: HTMLElement): void {
        const lightManager = this.sceneManager?.getLightManager();
        const shadowConfig = lightManager?.getConfig().shadow;

        // 阴影开关
        const shadowToggle = new ToggleSwitch({
            label: '启用阴影',
            initialState: shadowConfig?.enabled ?? false
        });
        shadowToggle.onChange((checked) => {
            this.sceneManager?.getLightManager()?.setShadowEnabled(checked);
        });
        this.toggles.push(shadowToggle);

        // 阴影分辨率
        const resolutionDropdown = new Dropdown({
            options: [
                { value: '1024', label: '1024 (低)' },
                { value: '2048', label: '2048 (中)' },
                { value: '4096', label: '4096 (高)' },
                { value: '8192', label: '8192 (超高)' }
            ],
            selectedValue: String(shadowConfig?.resolution ?? 1024)
        });
        resolutionDropdown.onChange((value) => {
            this.sceneManager?.getLightManager()?.setShadowResolution(parseInt(value));
        });
        this.dropdowns.push(resolutionDropdown);

        // 过滤模式
        const filterDropdown = new Dropdown({
            options: [
                { value: 'none', label: '无过滤' },
                { value: 'blurCloseEsm', label: 'BCESM(远景)' },
                { value: 'pcf', label: 'PCF(均衡)' },
                { value: 'pcss', label: '软阴影(吃性能)' }
            ],
            selectedValue: shadowConfig?.filterMode ?? 'pcf'
        });
        filterDropdown.onChange((value) => {
            this.sceneManager?.getLightManager()?.setShadowFilterMode(value);
        });
        this.dropdowns.push(filterDropdown);

        // 阴影质量 (PCF/PCSS 专用)
        const qualityDropdown = new Dropdown({
            options: [
                { value: 'low', label: '低质量' },
                { value: 'medium', label: '中等质量' },
                { value: 'high', label: '高质量' }
            ],
            selectedValue: shadowConfig?.quality ?? 'medium'
        });
        qualityDropdown.onChange((value) => {
            this.sceneManager?.getLightManager()?.setShadowConfig({
                quality: value as 'low' | 'medium' | 'high'
            });
        });
        this.dropdowns.push(qualityDropdown);

        // 阴影偏移 (Bias)
        const biasSlider = new Slider({
            label: '阴影偏移(阴影异常时调整)',
            min: 0,
            max: 0.01,
            step: 0.0001,
            value: shadowConfig?.bias ?? 0.0003
        });
        biasSlider.onChange((value) => {
            this.sceneManager?.getLightManager()?.setShadowBias(value);
        });
        this.sliders.push(biasSlider);

        // 法线偏移
        const normalBiasSlider = new Slider({
            label: '法线偏移',
            min: 0,
            max: 0.1,
            step: 0.001,
            value: shadowConfig?.normalBias ?? 0
        });
        normalBiasSlider.onChange((value) => {
            this.sceneManager?.getLightManager()?.setShadowNormalBias(value);
        });
        this.sliders.push(normalBiasSlider);

        // 阴影深度
        const darknessSlider = new Slider({
            label: '阴影亮度',
            min: 0,
            max: 1,
            step: 0.01,
            value: shadowConfig?.darkness ?? 0
        });
        darknessSlider.onChange((value) => {
            this.sceneManager?.getLightManager()?.setShadowDarkness(value);
        });
        this.sliders.push(darknessSlider);

        // 视锥边缘衰减
        const falloffSlider = new Slider({
            label: '边缘衰减',
            min: 0,
            max: 1,
            step: 0.01,
            value: shadowConfig?.frustumEdgeFalloff ?? 0.1
        });
        falloffSlider.onChange((value) => {
            this.sceneManager?.getLightManager()?.setShadowFrustumEdgeFalloff(value);
        });
        this.sliders.push(falloffSlider);

        // 阴影投射范围（精度与覆盖范围的平衡）
        const shadowAreaSlider = new Slider({
            label: '投射范围',
            min: 0,
            max: 100,
            step: 1,
            value: shadowConfig?.shadowArea ?? 12
        });
        shadowAreaSlider.onChange((value) => {
            this.sceneManager?.getLightManager()?.setShadowArea(value);
        });
        this.sliders.push(shadowAreaSlider);

        // 自动视锥体开关
        // const autoFrustumToggle = new ToggleSwitch({
        //     label: '自动视锥体（特写高精度）',
        //     initialState: shadowConfig?.autoFrustum ?? false
        // });
        // autoFrustumToggle.onChange((checked) => {
        //     this.sceneManager?.getLightManager()?.setAutoFrustum(checked);
        // });
        // this.toggles.push(autoFrustumToggle);

        // 透明阴影开关
        const transparencyToggle = new ToggleSwitch({
            label: '透明阴影',
            initialState: shadowConfig?.transparencyShadow ?? true
        });
        transparencyToggle.onChange((checked) => {
            this.sceneManager?.getLightManager()?.setShadowConfig({ transparencyShadow: checked });
        });
        this.toggles.push(transparencyToggle);

        // 组装 UI
        inner.appendChild(shadowToggle.element);
        inner.appendChild(resolutionDropdown.element);
        inner.appendChild(filterDropdown.element);
        inner.appendChild(qualityDropdown.element);
        inner.appendChild(biasSlider.element);
        inner.appendChild(normalBiasSlider.element);
        inner.appendChild(darknessSlider.element);
        inner.appendChild(falloffSlider.element);
        inner.appendChild(shadowAreaSlider.element);
        // inner.appendChild(autoFrustumToggle.element);
        inner.appendChild(transparencyToggle.element);
    }

    private createAmbientSection(lightConfig: any): HTMLElement {
        const section = document.createElement('div');
        section.className = 'world-lighting-section';

        const title = document.createElement('div');
        title.className = 'world-lighting-section-title';
        title.textContent = '环境光';

        const intensitySlider = new Slider({
            label: '亮度',
            min: 0,
            max: 1,
            step: 0.01,
            value: lightConfig?.ambientIntensity ?? 0.25
        });
        intensitySlider.onChange((value) => {
            this.sceneManager?.getLightManager()?.setAmbientIntensity(value);
            eventBus.emit(Events.LIGHT_AMBIENT_CHANGED, { intensity: value });
        });
        this.sliders.push(intensitySlider);

        const colorPicker = new RGBColorPicker({
            label: '颜色',
            color: lightConfig?.ambientColor ?? { r: 1, g: 0.95, b: 0.88 },
            mode: 'popup'
        });
        colorPicker.onChange(({ r, g, b }) => {
            this.sceneManager?.getLightManager()?.setAmbientColor(r, g, b);
            eventBus.emit(Events.LIGHT_AMBIENT_CHANGED, { r, g, b });
        });
        this.colorPickers.push(colorPicker);

        section.appendChild(title);
        section.appendChild(intensitySlider.element);
        section.appendChild(colorPicker.element);

        return section;
    }

    private createDirectionalSection(lightConfig: any): HTMLElement {
        const section = document.createElement('div');
        section.className = 'world-lighting-section';

        const title = document.createElement('div');
        title.className = 'world-lighting-section-title';
        title.textContent = '方向光';

        const intensitySlider = new Slider({
            label: '亮度',
            min: 0,
            max: 2,
            step: 0.01,
            value: lightConfig?.directionalIntensity ?? 1
        });
        intensitySlider.onChange((value) => {
            this.sceneManager?.getLightManager()?.setDirectionalIntensity(value);
            eventBus.emit(Events.LIGHT_DIRECTIONAL_CHANGED, { intensity: value });
        });
        this.sliders.push(intensitySlider);

        const colorPicker = new RGBColorPicker({
            label: '颜色',
            color: lightConfig?.directionalColor ?? { r: 1, g: 1, b: 1 },
            mode: 'popup'
        });
        colorPicker.onChange(({ r, g, b }) => {
            this.sceneManager?.getLightManager()?.setDirectionalColor(r, g, b);
            eventBus.emit(Events.LIGHT_DIRECTIONAL_CHANGED, { r, g, b });
        });
        this.colorPickers.push(colorPicker);

        const lightManager = this.sceneManager?.getLightManager() as any;
        const currentRotations = lightManager?.currentRotationX !== undefined
            ? { x: lightManager.currentRotationX / Math.PI, y: lightManager.currentRotationY / Math.PI }
            : { x: 0, y: 0 };

        const angleXSlider = new Slider({
            label: 'X轴角度',
            min: -1,
            max: 1,
            step: 0.01,
            value: currentRotations.x
        });
        angleXSlider.onChange((value) => {
            const angle = value * Math.PI;
            this.sceneManager?.getLightManager()?.rotateDirectionalLight(angle, null, null);
            eventBus.emit(Events.LIGHT_DIRECTIONAL_CHANGED, { angleX: value });
        });
        this.sliders.push(angleXSlider);

        const angleYSlider = new Slider({
            label: 'Y轴角度',
            min: -1,
            max: 1,
            step: 0.01,
            value: currentRotations.y
        });
        angleYSlider.onChange((value) => {
            const angle = value * Math.PI;
            this.sceneManager?.getLightManager()?.rotateDirectionalLight(null, angle, null);
            eventBus.emit(Events.LIGHT_DIRECTIONAL_CHANGED, { angleY: value });
        });
        this.sliders.push(angleYSlider);

        section.appendChild(title);
        section.appendChild(intensitySlider.element);
        section.appendChild(colorPicker.element);
        section.appendChild(angleXSlider.element);
        section.appendChild(angleYSlider.element);

        return section;
    }

    dispose(): void {
        this.sliders.forEach(s => s.dispose());
        this.colorPickers.forEach(c => c.dispose());
        this.toggles.forEach(t => t.dispose());
        this.dropdowns.forEach(d => d.dispose());
        this.sliders = [];
        this.colorPickers = [];
        this.toggles = [];
        this.dropdowns = [];
        this.lightingCollapsible?.dispose();
        this.shadowCollapsible?.dispose();
        this.lightingCollapsible = null;
        this.shadowCollapsible = null;
    }
}
