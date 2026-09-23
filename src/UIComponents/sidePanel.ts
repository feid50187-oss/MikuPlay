import { injectStyles } from '../styles/mainWindow.css';
import { sidePanelStyles } from '../styles/components/sidePanel.css';
import { ToggleSwitch } from './shared/ToggleSwitch';
import { Dropdown } from './shared/Dropdown';
import { pluginRegistry } from '../core/PluginRegistry';
import { pluginLoader } from '../plugins/PluginLoader';
import { showConfirmDialog, toast } from './shared';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { PluginEntry } from '../core/IPlugin';
import { getCdpHandle, type CdpHandle } from '../utils/cdpClient';
import { theme, type ThemeKey } from '../styles/theme';
import { themeStateManager } from '../features/state';
import { ProjectSaveUI } from './ProjectSaveUI';
import { showSafeAreaTuner } from '../utils/safeArea';

export class SidePanel {
    private overlay: HTMLElement;
    private panel: HTMLElement;
    private isOpen: boolean = false;
    private performanceToggleCallback: ((enabled: boolean) => void) | null = null;
    private performanceToggle: ToggleSwitch | null = null;
    private physicsToggleCallback: ((enabled: boolean) => void) | null = null;
    private physicsToggle: ToggleSwitch | null = null;
    private physicsEngineChangeCallback: ((value: string) => void) | null = null;
    private physicsEngineDropdown: Dropdown | null = null;
    private sharedPhysicsWorldToggle: ToggleSwitch | null = null;
    private groundToggleCallback: ((enabled: boolean) => void) | null = null;
    private groundToggle: ToggleSwitch | null = null;
    private textureDownsampleToggleCallback: ((enabled: boolean) => void) | null = null;
    private textureDownsampleToggle: ToggleSwitch | null = null;
    private gravityChangeCallback: ((x: number, y: number, z: number) => void) | null = null;
    private gravitySliders: { x: HTMLInputElement | null; y: HTMLInputElement | null; z: HTMLInputElement | null } = { x: null, y: null, z: null };
    private gravityValues: { x: HTMLElement | null; y: HTMLElement | null; z: HTMLElement | null } = { x: null, y: null, z: null };
    private physicsPrecisionCallback: ((maxSubSteps: number, fixedTimeStep: number) => void) | null = null;
    private maxSubStepsSelect: Dropdown | null = null;
    private fixedTimeStepSelect: Dropdown | null = null;
    private frustumCullingToggleCallback: ((enabled: boolean) => void) | null = null;
    private frustumCullingToggle: ToggleSwitch | null = null;
    private renderScaleChangeCallback: ((scale: number) => void) | null = null;
    private renderScaleDropdown: Dropdown | null = null;
    private pluginSectionExpanded: boolean = false;
    private debugSectionExpanded: boolean = false;
    private pluginDetailOverlay: HTMLElement | null = null;
    private pluginListContainer: HTMLElement | null = null;
    private themeToggleBtn: HTMLElement | null = null;
    private saveToggleBtn: HTMLElement | null = null;
    private projectSaveUI: ProjectSaveUI | null = null;
    /** 共享物理世界开关的容器元素（用于 RezePhysics 时隐藏） */
    private _sharedPhysicsWorldElement: HTMLElement | null = null;
    /** 地面开关的容器元素（用于 RezePhysics 时隐藏） */
    private _groundToggleElement: HTMLElement | null = null;
    /** 物理子步数容器元素（用于 RezePhysics 时隐藏） */
    private _subStepsElement: HTMLElement | null = null;
    /** 物理更新频率容器元素（用于 RezePhysics 时隐藏） */
    private _timeStepElement: HTMLElement | null = null;

    /* 彩蛋状态 */
    private _easterEggClickCount: number = 0;
    private _easterEggTimer: ReturnType<typeof setTimeout> | null = null;
    private _easterEggTier1Triggered: boolean = false;
    private _footerAppElement: HTMLElement | null = null;
    private _footerAuthorElement: HTMLElement | null = null;
    private _footerLinksElement: HTMLElement | null = null;
    private _easterEggEmojiElements: HTMLElement[] = [];
    private _easterEggOverlayElement: HTMLElement | null = null;

    constructor() {
        injectStyles(sidePanelStyles, 'component-sidepanel');

        this.overlay = this.createOverlay();
        this.panel = this.createPanel();

        document.body.appendChild(this.overlay);
        document.body.appendChild(this.panel);

        // 订阅主题变化，更新按钮图标
        themeStateManager.subscribe((state) => {
            this.updateThemeToggleIcon(state.theme);
        });
    }

    /**
     * 设置重力变化回调
     * @param callback 重力值变化回调 (x, y, z)
     */
    public onGravityChange(callback: (x: number, y: number, z: number) => void): void {
        this.gravityChangeCallback = callback;
    }

    /**
     * 获取当前重力值（内部实际值，已乘以10）
     * @returns 重力值 {x, y, z}
     */
    public getGravity(): { x: number; y: number; z: number } {
        // 显示值乘以10得到内部实际值
        return {
            x: parseFloat(this.gravitySliders.x?.value ?? '0') * 10,
            y: parseFloat(this.gravitySliders.y?.value ?? '-9.8') * 10,
            z: parseFloat(this.gravitySliders.z?.value ?? '0') * 10
        };
    }

    /**
     * 设置重力值（内部实际值，会自动除以10显示）
     * @param x X轴重力
     * @param y Y轴重力
     * @param z Z轴重力
     */
    public setGravity(x: number, y: number, z: number): void {
        // 内部值除以10得到显示值
        const displayX = x / 10;
        const displayY = y / 10;
        const displayZ = z / 10;

        if (this.gravitySliders.x) {
            this.gravitySliders.x.value = displayX.toString();
            if (this.gravityValues.x) this.gravityValues.x.textContent = displayX.toFixed(1);
        }
        if (this.gravitySliders.y) {
            this.gravitySliders.y.value = displayY.toString();
            if (this.gravityValues.y) this.gravityValues.y.textContent = displayY.toFixed(1);
        }
        if (this.gravitySliders.z) {
            this.gravitySliders.z.value = displayZ.toString();
            if (this.gravityValues.z) this.gravityValues.z.textContent = displayZ.toFixed(1);
        }
        this.gravityChangeCallback?.(x, y, z);
    }

    /**
     * 设置物理模拟开关回调
     * @param callback 开关状态变化回调
     */
    public onPhysicsToggle(callback: (enabled: boolean) => void): void {
        this.physicsToggleCallback = callback;
    }

    /**
     * 设置物理引擎切换回调
     * @param callback 引擎切换回调 (value: 'spr' | 'reze')
     */
    public onPhysicsEngineChange(callback: (value: string) => void): void {
        this.physicsEngineChangeCallback = callback;
    }

    /**
     * 获取当前物理引擎类型
     * @returns 'spr' | 'reze'
     */
    public getPhysicsEngine(): string {
        return this.physicsEngineDropdown?.getValue() ?? 'reze';
    }

    /**
     * 设置物理引擎类型
     * @param value 'spr' | 'reze'
     */
    public setPhysicsEngine(value: string): void {
        if (this.physicsEngineDropdown) {
            this.physicsEngineDropdown.setValue(value);
        }
        // 同步跟随显示（用于取消切换时恢复与当前引擎一致的 UI）
        this.updateRezeUI(value === 'reze');
    }

    /**
     * 引擎实际切换成功后应用 UI 与持久化
     * 在 MainWindow 完成引擎切换后调用，确保 UI 与实际引擎保持一致
     * @param value 'spr' | 'reze'
     */
    public applyPhysicsEngineUI(value: string): void {
        localStorage.setItem('mikuplay_physics_engine', value);
        this.updateRezeUI(value === 'reze');
    }

    /**
     * 获取物理模拟开关当前状态
     * @returns 是否开启
     */
    public isPhysicsEnabled(): boolean {
        return this.physicsToggle?.getValue() ?? true;
    }

    /**
     * 设置物理模拟开关状态
     * @param enabled 是否开启
     */
    public setPhysicsEnabled(enabled: boolean): void {
        if (this.physicsToggle) {
            this.physicsToggle.setValue(enabled);
        }
    }

    /**
     * 设置地面碰撞开关回调
     * @param callback 开关状态变化回调
     */
    public onGroundToggle(callback: (enabled: boolean) => void): void {
        this.groundToggleCallback = callback;
    }

    /**
     * 获取地面碰撞开关当前状态
     * @returns 是否开启
     */
    public isGroundEnabled(): boolean {
        return this.groundToggle?.getValue() ?? true;
    }

    /**
     * 设置地面碰撞开关状态
     * @param enabled 是否开启
     */
    public setGroundEnabled(enabled: boolean): void {
        if (this.groundToggle) {
            this.groundToggle.setValue(enabled);
        }
    }

    /**
     * 设置性能监测开关回调
     * @param callback 开关状态变化回调
     */
    public onPerformanceToggle(callback: (enabled: boolean) => void): void {
        this.performanceToggleCallback = callback;
    }

    public onTextureDownsampleToggle(callback: (enabled: boolean) => void): void {
        this.textureDownsampleToggleCallback = callback;
    }

    public isTextureDownsampleEnabled(): boolean {
        return this.textureDownsampleToggle?.getValue() ?? false;
    }

    public setTextureDownsampleEnabled(enabled: boolean): void {
        if (this.textureDownsampleToggle) {
            this.textureDownsampleToggle.setValue(enabled);
        }
    }

    /**
     * 设置视锥裁剪开关回调
     * @param callback 开关状态变化回调
     */
    public onFrustumCullingToggle(callback: (enabled: boolean) => void): void {
        this.frustumCullingToggleCallback = callback;
    }

    /**
     * 获取视锥裁剪开关当前状态
     * @returns 是否开启
     */
    public isFrustumCullingEnabled(): boolean {
        return this.frustumCullingToggle?.getValue() ?? false;
    }

    /**
     * 设置视锥裁剪开关状态
     * @param enabled 是否开启
     */
    public setFrustumCullingEnabled(enabled: boolean): void {
        if (this.frustumCullingToggle) {
            this.frustumCullingToggle.setValue(enabled);
        }
    }

    /**
     * 设置渲染比例变化回调
     * @param callback 比例变化回调 (hardwareScalingLevel)
     */
    public onRenderScaleChange(callback: (scale: number) => void): void {
        this.renderScaleChangeCallback = callback;
    }

    /**
     * 获取当前渲染缩放比例
     * @returns hardwareScalingLevel 值（0表示设备默认）
     */
    public getRenderScale(): number {
        return parseFloat(this.renderScaleDropdown?.getValue() ?? '0');
    }

    /**
     * 设置渲染缩放比例
     * @param scale hardwareScalingLevel 值（0表示设备默认）
     */
    public setRenderScale(scale: number): void {
        this.renderScaleDropdown?.setValue(scale.toString());
        this.renderScaleChangeCallback?.(scale);
    }

    /**
     * 设置物理精度控制回调
     * @param callback 精度变化回调 (maxSubSteps, fixedTimeStep)
     */
    public onPhysicsPrecisionChange(callback: (maxSubSteps: number, fixedTimeStep: number) => void): void {
        this.physicsPrecisionCallback = callback;
    }

    /**
     * 获取当前物理精度设置
     * @returns 物理精度设置 {maxSubSteps, fixedTimeStep}
     */
    public getPhysicsPrecision(): { maxSubSteps: number; fixedTimeStep: number } {
        const maxSubSteps = parseInt(this.maxSubStepsSelect?.getValue() ?? '3');
        const fixedTimeStep = parseFloat(this.fixedTimeStepSelect?.getValue() ?? '0.01667');
        return { maxSubSteps, fixedTimeStep };
    }

    /**
     * 设置物理精度
     * @param maxSubSteps 最大子步数
     * @param fixedTimeStep 固定时间步长
     */
    public setPhysicsPrecision(maxSubSteps: number, fixedTimeStep: number): void {
        this.maxSubStepsSelect?.setValue(maxSubSteps.toString());
        this.fixedTimeStepSelect?.setValue(fixedTimeStep.toString());
        this.physicsPrecisionCallback?.(maxSubSteps, fixedTimeStep);
    }

    /**
     * 获取性能监测开关当前状态
     * @returns 是否开启
     */
    public isPerformanceMonitorEnabled(): boolean {
        return this.performanceToggle?.getValue() ?? false;
    }

    /**
     * 设置性能监测开关状态
     * @param enabled 是否开启
     */
    public setPerformanceMonitorEnabled(enabled: boolean): void {
        if (this.performanceToggle) {
            this.performanceToggle.setValue(enabled);
        }
    }

    private createOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        overlay.className = 'side-panel-overlay';
        overlay.addEventListener('click', () => this.close());
        return overlay;
    }

    private createPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'side-panel';

        const header = document.createElement('div');
        header.className = 'side-panel-header';

        const title = document.createElement('span');
        title.className = 'side-panel-title';
        title.textContent = '菜单';

        this.themeToggleBtn = this.createThemeToggleBtn();
        this.saveToggleBtn = this.createSaveToggleBtn();
        const headerActions = document.createElement('div');
        headerActions.className = 'side-panel-header-actions';
        headerActions.appendChild(this.saveToggleBtn);
        headerActions.appendChild(this.themeToggleBtn);
        header.appendChild(title);
        header.appendChild(headerActions);
        panel.appendChild(header);

        const content = this.createPanelContent();
        panel.appendChild(content);

        const footer = this.createCopyrightFooter();
        panel.appendChild(footer);

        return panel;
    }

    private createThemeToggleBtn(): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'side-panel-theme-toggle';
        btn.title = '切换主题';
        btn.innerHTML = this.getThemeSvgIcon(themeStateManager.getTheme());
        btn.addEventListener('click', () => themeStateManager.toggleTheme());
        return btn;
    }

    private createSaveToggleBtn(): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'side-panel-save-toggle';
        btn.title = '工程存档';
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="${theme.accentColor}"><path d="M840-680v480q0 33-23.5 56.5T760-120H200q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h480l160 160Zm-80 34L646-760H200v560h560v-446ZM480-240q35 0 60-25t25-60q0-35-25-60t-60-25q-35 0-60 25t-25 60q0 35 25 60t60 25ZM240-560h360v-160H240v160Zm-40-86v446-560 114Z"/></svg>`;
        btn.addEventListener('click', () => this.openProjectSaveUI());
        return btn;
    }

    private openProjectSaveUI(): void {
        if (!this.projectSaveUI) {
            this.projectSaveUI = new ProjectSaveUI();
        }
        this.projectSaveUI.open().catch(error => {
            console.error('[SidePanel] 打开工程存档面板失败:', error);
        });
    }

    private updateThemeToggleIcon(themeKey: ThemeKey): void {
        if (!this.themeToggleBtn) return;
        this.themeToggleBtn.innerHTML = this.getThemeSvgIcon(themeKey);
    }

    private getThemeSvgIcon(themeKey: ThemeKey): string {
        const fill = theme.accentColor;
        if (themeKey === 'dark') {
            // lightmode.svg - 当前为暗色，显示切换为亮色的图标
            return `<svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" fill="${fill}"><path d="M565-395q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Zm-226.5 56.5Q280-397 280-480t58.5-141.5Q397-680 480-680t141.5 58.5Q680-563 680-480t-58.5 141.5Q563-280 480-280t-141.5-58.5ZM200-440H40v-80h160v80Zm720 0H760v-80h160v80ZM440-760v-160h80v160h-80Zm0 720v-160h80v160h-80ZM256-650l-101-97 57-59 96 100-52 56Zm492 496-97-101 53-55 101 97-57 59Zm-98-550 97-101 59 57-100 96-56-52ZM154-212l101-97 55 53-97 101-59-57Zm326-268Z"/></svg>`;
        }
        // darkmode.svg - 当前为亮色，显示切换为暗色的图标
        return `<svg xmlns="http://www.w3.org/2000/svg" height="22px" viewBox="0 -960 960 960" width="22px" fill="${fill}"><path d="M600-640 480-760l120-120 120 120-120 120Zm200 120-80-80 80-80 80 80-80 80ZM483-80q-84 0-157.5-32t-128-86.5Q143-253 111-326.5T79-484q0-146 93-257.5T409-880q-18 99 11 193.5T520-521q71 71 165.5 100T879-410q-26 144-138 237T483-80Zm0-80q88 0 163-44t118-121q-86-8-163-43.5T463-465q-61-61-97-138t-43-163q-77 43-120.5 118.5T159-484q0 135 94.5 229.5T483-160Zm-20-305Z"/></svg>`;
    }

    private createPanelContent(): HTMLElement {
        const content = document.createElement('div');
        content.className = 'side-panel-content';

        // 性能监测开关（默认开启）
        const performanceToggleItem = this.createToggleItem('性能监测', true, (enabled) => {
            this.performanceToggleCallback?.(enabled);
        });
        content.appendChild(performanceToggleItem);

        // 纹理降采样开关
        const textureDownsampleToggleItem = this.createToggleItem('纹理降采样', false, (enabled) => {
            this.textureDownsampleToggleCallback?.(enabled);
        });
        content.appendChild(textureDownsampleToggleItem);

        // 视锥裁剪开关
        const frustumCullingToggle = new ToggleSwitch({
            label: '视锥裁剪',
            initialState: this.loadFrustumCullingDefault()
        });
        frustumCullingToggle.onChange((enabled) => {
            localStorage.setItem('mikuplay_frustum_culling', String(enabled));
            this.frustumCullingToggleCallback?.(enabled);
        });
        this.frustumCullingToggle = frustumCullingToggle;
        content.appendChild(frustumCullingToggle.element);
        // const frustumCullingSubtitle = document.createElement('div');
        // frustumCullingSubtitle.className = 'side-panel-toggle-subtitle';
        // frustumCullingSubtitle.textContent = '提升性能，特写镜头可能异常';
        // content.appendChild(frustumCullingSubtitle);

        // 物理模拟开关
        const physicsToggleItem = this.createToggleItem('物理模拟', true, (enabled) => {
            this.physicsToggleCallback?.(enabled);
        });
        content.appendChild(physicsToggleItem);

        // 共享物理世界开关（持久化，下次启动生效）
        const sharedPhysicsWorldToggle = new ToggleSwitch({
            label: '模型间碰撞',
            initialState: this.loadSharedPhysicsWorldDefault()
        });
        sharedPhysicsWorldToggle.onChange((enabled) => {
            localStorage.setItem('mikuplay_shared_physics_world', String(enabled));
            toast.show('下次启动生效', 'info');
        });
        this.sharedPhysicsWorldToggle = sharedPhysicsWorldToggle;
        this._sharedPhysicsWorldElement = sharedPhysicsWorldToggle.element;
        content.appendChild(sharedPhysicsWorldToggle.element);

        // 地面碰撞开关（只修改碰撞掩码，不创建/销毁地面碰撞体）
        const groundToggleItem = this.createToggleItem('地面', true, (enabled) => {
            this.groundToggleCallback?.(enabled);
        });
        this._groundToggleElement = groundToggleItem;
        content.appendChild(groundToggleItem);

        // 物理精度控制
        const precisionSection = this.createPhysicsPrecisionSection();
        content.appendChild(precisionSection);

        // 重力控制
        const gravitySection = this.createGravitySection();
        content.appendChild(gravitySection);

        // 插件管理区域
        const pluginSection = this.createPluginSection();
        content.appendChild(pluginSection);

        // 调试工具区域
        const debugSection = this.createDebugSection();
        content.appendChild(debugSection);

        // 安全区校准入口（置于面板底部，方便用户在安全区错误时依然能点击）
        const safeAreaEntry = this.createSafeAreaEntry();
        content.appendChild(safeAreaEntry);

        // 根据保存的引擎类型初始化 Reze 相关 UI 可见性
        const savedEngine = this.loadPhysicsEngineDefault();
        this.updateRezeUI(savedEngine === 'reze');

        return content;
    }

    private createPhysicsPrecisionSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'side-panel-precision-section';

        // 物理引擎切换（作为第一个项目）
        const physicsEngineItem = document.createElement('div');
        physicsEngineItem.className = 'side-panel-precision-item';
        const physicsEngineLabel = document.createElement('span');
        physicsEngineLabel.className = 'side-panel-precision-label';
        physicsEngineLabel.textContent = '物理引擎';
        physicsEngineItem.appendChild(physicsEngineLabel);
        const savedEngine = this.loadPhysicsEngineDefault();
        const physicsEngineDropdown = new Dropdown({
            options: [
                { value: 'spr', label: 'Bullet' },
                { value: 'reze', label: 'RezePhysics' }
            ],
            selectedValue: savedEngine
        });
        physicsEngineDropdown.onChange((value) => {
            // 仅通知引擎切换回调；UI 刷新与持久化放在引擎实际切换成功之后（见 applyPhysicsEngineUI）
            this.physicsEngineChangeCallback?.(value);
        });
        this.physicsEngineDropdown = physicsEngineDropdown;
        physicsEngineItem.appendChild(physicsEngineDropdown.element);
        section.appendChild(physicsEngineItem);

        // 渲染比例
        const renderScaleItem = document.createElement('div');
        renderScaleItem.className = 'side-panel-precision-item';
        const renderScaleLabel = document.createElement('span');
        renderScaleLabel.className = 'side-panel-precision-label';
        renderScaleLabel.textContent = '渲染缩放比例';
        renderScaleItem.appendChild(renderScaleLabel);
        const savedScale = this.loadRenderScaleDefault();
        const renderScaleDropdown = new Dropdown({
            options: [
                { value: '0.25', label: '0.25x' },
                { value: '0.5', label: '0.5x' },
                { value: '1', label: '1.0x' },
                { value: '0', label: '设备默认' }
            ],
            selectedValue: savedScale.toString()
        });
        renderScaleDropdown.onChange((value) => {
            const scaleNum = parseFloat(value);
            localStorage.setItem('mikuplay_render_scale', value);
            this.renderScaleChangeCallback?.(scaleNum);
        });

        // 子步数选项
        const subStepsOptions = [
            { value: '1', label: '低 (1步)' },
            { value: '3', label: '中 (3步)' },
            { value: '5', label: '高 (5步)' },
            { value: '10', label: '极高 (10步)' }
        ];

        // 固定时间步长选项
        const timeStepOptions = [
            { value: '0.03333', label: '30 FPS' },
            { value: '0.01667', label: '60 FPS' },
            { value: '0.01111', label: '90 FPS' },
            { value: '0.00833', label: '120 FPS' }
        ];

        // 创建子步数下拉框
        const subStepsContainer = document.createElement('div');
        subStepsContainer.className = 'side-panel-precision-item';
        this._subStepsElement = subStepsContainer;

        const subStepsLabel = document.createElement('span');
        subStepsLabel.className = 'side-panel-precision-label';
        subStepsLabel.textContent = '物理子步数';

        const subStepsDropdown = new Dropdown({
            options: subStepsOptions,
            selectedValue: '3'
        });
        subStepsDropdown.onChange((value) => {
            const maxSubSteps = parseInt(value);
            const fixedTimeStep = parseFloat(this.fixedTimeStepSelect?.getValue() ?? '0.01667');
            this.physicsPrecisionCallback?.(maxSubSteps, fixedTimeStep);
        });
        this.maxSubStepsSelect = subStepsDropdown;

        subStepsContainer.appendChild(subStepsLabel);
        subStepsContainer.appendChild(subStepsDropdown.element);
        section.appendChild(subStepsContainer);

        // 创建固定时间步长下拉框
        const timeStepContainer = document.createElement('div');
        timeStepContainer.className = 'side-panel-precision-item';
        this._timeStepElement = timeStepContainer;

        const timeStepLabel = document.createElement('span');
        timeStepLabel.className = 'side-panel-precision-label';
        timeStepLabel.textContent = '物理更新频率';

        const timeStepDropdown = new Dropdown({
            options: timeStepOptions,
            selectedValue: '0.01667'
        });
        timeStepDropdown.onChange((value) => {
            const maxSubSteps = parseInt(this.maxSubStepsSelect?.getValue() ?? '5');
            const fixedTimeStep = parseFloat(value);
            this.physicsPrecisionCallback?.(maxSubSteps, fixedTimeStep);
        });
        this.fixedTimeStepSelect = timeStepDropdown;

        timeStepContainer.appendChild(timeStepLabel);
        timeStepContainer.appendChild(timeStepDropdown.element);
        section.appendChild(timeStepContainer);

        //创建渲染比例下拉框
        this.renderScaleDropdown = renderScaleDropdown;
        renderScaleItem.appendChild(renderScaleDropdown.element);
        section.appendChild(renderScaleItem);

        // 渲染比例说明小字
        // const subtitle = document.createElement('div');
        // subtitle.className = 'side-panel-precision-subtitle';
        // subtitle.textContent = '正式渲染应恢复默认值';
        // section.appendChild(subtitle);

        return section;
    }

    private createDebugSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'side-panel-debug-section';

        const header = document.createElement('div');
        header.className = 'side-panel-debug-header';

        const title = document.createElement('span');
        title.className = 'side-panel-debug-title';
        title.textContent = '调试工具';

        const arrowIcon = this.createArrowIcon();

        header.appendChild(title);
        header.appendChild(arrowIcon);

        const content = document.createElement('div');
        content.className = 'side-panel-debug-content';

        const inner = document.createElement('div');
        inner.className = 'side-panel-debug-inner';

        const btnRow = document.createElement('div');
        btnRow.className = 'side-panel-debug-btn-row';

        const gcBtn = document.createElement('button');
        gcBtn.className = 'side-panel-debug-btn';
        gcBtn.textContent = 'GC';
        gcBtn.addEventListener('click', () => this.handleGcClick(gcBtn));

        btnRow.appendChild(gcBtn);
        inner.appendChild(btnRow);

        // 自定义 CDP 命令区域
        const customCmdRow = document.createElement('div');
        customCmdRow.className = 'side-panel-debug-custom-cmd';
        customCmdRow.style.marginTop = '12px';
        customCmdRow.style.display = 'flex';
        customCmdRow.style.flexDirection = 'column';
        customCmdRow.style.gap = '8px';

        const methodInput = document.createElement('input');
        methodInput.type = 'text';
        methodInput.placeholder = 'CDP方法';
        methodInput.className = 'side-panel-debug-input';
        methodInput.style.padding = '6px 10px';
        methodInput.style.borderRadius = '6px';
        methodInput.style.border = `1px solid var(--mp-border, ${theme.borderColor})`;
        methodInput.style.background = `var(--mp-surface, ${theme.surfaceColor})`;
        methodInput.style.color = `var(--mp-text, ${theme.textPrimary})`;
        methodInput.style.fontSize = '13px';
        // 默认填入执行控制台命令的 CDP 方法，用户可直接在 expression 中写空命令
        methodInput.value = 'Runtime.evaluate';

        const paramsInput = document.createElement('textarea');
        paramsInput.placeholder = 'JSON参数';
        paramsInput.className = 'side-panel-debug-textarea';
        paramsInput.rows = 5;
        paramsInput.style.padding = '6px 10px';
        paramsInput.style.borderRadius = '6px';
        paramsInput.style.border = `1px solid var(--mp-border, ${theme.borderColor})`;
        paramsInput.style.background = `var(--mp-surface, ${theme.surfaceColor})`;
        paramsInput.style.color = `var(--mp-text, ${theme.textPrimary})`;
        paramsInput.style.fontSize = '13px';
        paramsInput.style.resize = 'vertical';
        paramsInput.style.fontFamily = 'monospace';
        // 默认填入带空命令 expression 的 evaluate 参数，例如填入 __mmd.setPostPhysicsAppend(false) 即可执行
        paramsInput.value = JSON.stringify(
            {
                expression: "",
                returnByValue: true
            },
            null,
            2
        );

        const sendBtn = document.createElement('button');
        sendBtn.className = 'side-panel-debug-btn';
        sendBtn.textContent = '发送命令';
        sendBtn.addEventListener('click', () =>
            this.handleCustomCommandClick(sendBtn, methodInput, paramsInput, resultPre)
        );

        const resultPre = document.createElement('pre');
        resultPre.className = 'side-panel-debug-result';
        resultPre.style.margin = '4px 0 0';
        resultPre.style.padding = '8px';
        resultPre.style.borderRadius = '6px';
        resultPre.style.background = `var(--mp-surface, ${theme.surfaceColor})`;
        resultPre.style.color = `var(--mp-text, ${theme.textPrimary})`;
        resultPre.style.fontSize = '12px';
        resultPre.style.maxHeight = '200px';
        resultPre.style.overflow = 'auto';
        resultPre.style.whiteSpace = 'pre-wrap';
        resultPre.style.wordBreak = 'break-word';
        resultPre.style.display = 'none';

        customCmdRow.appendChild(methodInput);
        customCmdRow.appendChild(paramsInput);
        customCmdRow.appendChild(sendBtn);
        customCmdRow.appendChild(resultPre);
        inner.appendChild(customCmdRow);

        content.appendChild(inner);

        header.addEventListener('click', () => {
            this.debugSectionExpanded = !this.debugSectionExpanded;
            section.classList.toggle('expanded', this.debugSectionExpanded);
        });

        section.appendChild(header);
        section.appendChild(content);

        return section;
    }

    private async handleGcClick(btn: HTMLButtonElement): Promise<void> {
        btn.disabled = true;
        btn.textContent = '执行中...';

        try {
            const handle = getCdpHandle();
            await handle.send('HeapProfiler.enable');
            await handle.send('HeapProfiler.collectGarbage');
            toast.show('GC 已执行', 'success');
        } catch (error) {
            console.error('[SidePanel] GC 执行失败:', error);
            toast.show('GC 执行失败', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'GC';
        }
    }

    private async handleCustomCommandClick(
        btn: HTMLButtonElement,
        methodInput: HTMLInputElement,
        paramsInput: HTMLTextAreaElement,
        resultPre: HTMLPreElement
    ): Promise<void> {
        const method = methodInput.value.trim();
        if (!method) {
            toast.show('请输入 CDP 方法名', 'error');
            return;
        }

        let params: Record<string, any> = {};
        const paramsText = paramsInput.value.trim();
        if (paramsText) {
            try {
                params = JSON.parse(paramsText);
            } catch {
                toast.show('JSON 参数格式错误', 'error');
                return;
            }
        }

        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = '发送中...';
        resultPre.style.display = 'none';

        try {
            const handle = getCdpHandle();
            const result = await handle.send(method, params);
            resultPre.textContent = JSON.stringify(result, null, 2);
            resultPre.style.display = 'block';
            toast.show('命令执行成功', 'success');
        } catch (error) {
            console.error('[SidePanel] 自定义命令执行失败:', error);
            resultPre.textContent = String(error);
            resultPre.style.display = 'block';
            toast.show('命令执行失败', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    private createGravitySection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'side-panel-gravity-section';

        const title = document.createElement('div');
        title.className = 'side-panel-gravity-title';
        title.textContent = '重力控制';
        section.appendChild(title);

        // Y轴重力（主要控制）- 显示范围 -20 到 0（对应内部 -200 到 0）
        const ySlider = this.createGravitySlider('Y', -20, 0, -9.8, () => {
            this.onGravitySliderChange();
        });
        section.appendChild(ySlider);

        // X轴重力 - 显示范围 -5 到 5（对应内部 -50 到 50）
        const xSlider = this.createGravitySlider('X', -5, 5, 0, () => {
            this.onGravitySliderChange();
        });
        section.appendChild(xSlider);

        // Z轴重力 - 显示范围 -5 到 5（对应内部 -50 到 50）
        const zSlider = this.createGravitySlider('Z', -5, 5, 0, () => {
            this.onGravitySliderChange();
        });
        section.appendChild(zSlider);

        return section;
    }

    private createGravitySlider(
        axis: string,
        min: number,
        max: number,
        defaultValue: number,
        onChange: (value: number) => void
    ): HTMLElement {
        const container = document.createElement('div');
        container.className = 'side-panel-gravity-slider-container';

        const labelRow = document.createElement('div');
        labelRow.className = 'side-panel-gravity-label-row';

        const label = document.createElement('span');
        label.className = 'side-panel-gravity-axis-label';
        label.textContent = `${axis}轴`;

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'side-panel-gravity-value';
        valueDisplay.textContent = defaultValue.toFixed(1);

        labelRow.appendChild(label);
        labelRow.appendChild(valueDisplay);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'side-panel-gravity-slider';
        slider.min = min.toString();
        slider.max = max.toString();
        slider.step = '1';
        slider.value = defaultValue.toString();

        // 保存引用
        if (axis === 'X') {
            this.gravitySliders.x = slider;
            this.gravityValues.x = valueDisplay;
        } else if (axis === 'Y') {
            this.gravitySliders.y = slider;
            this.gravityValues.y = valueDisplay;
        } else if (axis === 'Z') {
            this.gravitySliders.z = slider;
            this.gravityValues.z = valueDisplay;
        }

        slider.addEventListener('input', () => {
            let value = parseFloat(slider.value);
            // Y轴重力吸附到 -9.8
            if (axis === 'Y' && Math.abs(value - (-9.8)) < 0.3) {
                value = -9.8;
            }
            valueDisplay.textContent = value.toFixed(1);
            onChange(value);
        });

        container.appendChild(labelRow);
        container.appendChild(slider);

        return container;
    }

    private onGravitySliderChange(): void {
        // 显示值乘以10得到内部实际值
        const x = parseFloat(this.gravitySliders.x?.value ?? '0') * 10;
        const y = parseFloat(this.gravitySliders.y?.value ?? '-9.8') * 10;
        const z = parseFloat(this.gravitySliders.z?.value ?? '0') * 10;
        this.gravityChangeCallback?.(x, y, z);
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

        // 保存开关的引用
        if (label === '物理模拟') {
            this.physicsToggle = toggle;
        } else if (label === '地面') {
            this.groundToggle = toggle;
        } else if (label === '性能监测') {
            this.performanceToggle = toggle;
        } else if (label === '纹理降采样') {
            this.textureDownsampleToggle = toggle;
        }

        return toggle.element;
    }

    /**
     * 创建带小字说明的开关项
     */
    /**
     * 从 localStorage 加载视锥裁剪开关默认值
     */
    private loadFrustumCullingDefault(): boolean {
        try {
            const saved = localStorage.getItem('mikuplay_frustum_culling');
            if (saved !== null) return saved === 'true';
        } catch { /* ignore */ }
        return false;
    }

    private loadSharedPhysicsWorldDefault(): boolean {
        try {
            const saved = localStorage.getItem('mikuplay_shared_physics_world');
            if (saved !== null) return saved === 'true';
        } catch { /* ignore */ }
        return false;
    }

    /**
     * 获取共享物理世界开关当前状态
     * @returns 是否启用共享物理世界
     */
    public isSharedPhysicsWorldEnabled(): boolean {
        return this.sharedPhysicsWorldToggle?.getValue() ?? this.loadSharedPhysicsWorldDefault();
    }

    /**
     * 从 localStorage 加载渲染比例默认值（0表示设备默认）
     */
    private loadRenderScaleDefault(): number {
        try {
            const saved = localStorage.getItem('mikuplay_render_scale');
            if (saved !== null) return parseFloat(saved);
        } catch { /* ignore */ }
        return 0;
    }

    /**
     * 从 localStorage 加载物理引擎默认值
     */
    private loadPhysicsEngineDefault(): string {
        try {
            const saved = localStorage.getItem('mikuplay_physics_engine');
            if (saved !== null) return saved;
        } catch { /* ignore */ }
        return 'reze';
    }

    /**
     * 根据是否使用 RezePhysics 更新 UI 显示
     * RezePhysics 下隐藏"共享物理世界""地面""物理子步数""物理更新频率"
     */
    private updateRezeUI(isReze: boolean): void {
        if (this._sharedPhysicsWorldElement) {
            this._sharedPhysicsWorldElement.style.display = isReze ? 'none' : '';
        }
        if (this._groundToggleElement) {
            this._groundToggleElement.style.display = isReze ? 'none' : '';
        }
        if (this._subStepsElement) {
            this._subStepsElement.style.display = isReze ? 'none' : '';
        }
        if (this._timeStepElement) {
            this._timeStepElement.style.display = isReze ? 'none' : '';
        }
    }

    private createCollapsibleSection(title: string, contentFactory: () => HTMLElement): HTMLElement {
        const section = document.createElement('div');
        section.className = 'side-panel-collapsible';

        const header = document.createElement('div');
        header.className = 'side-panel-collapsible-header';

        const titleElement = document.createElement('span');
        titleElement.className = 'side-panel-collapsible-title';
        titleElement.textContent = title;

        const arrowIcon = this.createArrowIcon();

        header.appendChild(titleElement);
        header.appendChild(arrowIcon);

        const content = document.createElement('div');
        content.className = 'side-panel-collapsible-content';

        const inner = document.createElement('div');
        inner.className = 'side-panel-collapsible-inner';

        const factoryContent = contentFactory();
        inner.appendChild(factoryContent);
        content.appendChild(inner);

        let isExpanded = false;
        header.addEventListener('click', () => {
            isExpanded = !isExpanded;
            section.classList.toggle('expanded', isExpanded);
        });

        section.appendChild(header);
        section.appendChild(content);

        return section;
    }

    /**
     * 创建箭头图标
     * @returns SVG 元素
     */
    private createArrowIcon(): SVGSVGElement {
        const arrowIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        arrowIcon.setAttribute('class', 'side-panel-collapsible-arrow');
        arrowIcon.setAttribute('viewBox', '0 0 24 24');
        arrowIcon.setAttribute('fill', 'none');
        arrowIcon.setAttribute('stroke', 'currentColor');
        arrowIcon.setAttribute('stroke-width', '2');
        arrowIcon.setAttribute('stroke-linecap', 'round');
        arrowIcon.setAttribute('stroke-linejoin', 'round');
        arrowIcon.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>';
        return arrowIcon;
    }

    private createPluginSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'side-panel-plugin-section';

        const header = document.createElement('div');
        header.className = 'side-panel-plugin-header';

        const title = document.createElement('span');
        title.className = 'side-panel-plugin-title';
        title.textContent = '插件管理';

        const arrowIcon = this.createArrowIcon();

        header.appendChild(title);
        header.appendChild(arrowIcon);

        const content = document.createElement('div');
        content.className = 'side-panel-plugin-content';

        const inner = document.createElement('div');
        inner.className = 'side-panel-plugin-inner';

        const installBtn = document.createElement('button');
        installBtn.className = 'side-panel-plugin-install-btn';
        installBtn.textContent = '安装插件';
        installBtn.addEventListener('click', () => this.handlePluginInstall());

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'side-panel-plugin-install-btn';
        downloadBtn.textContent = '下载插件';
        downloadBtn.addEventListener('click', () => {
            window.open('https://gitcode.com/akusera1/mikuplayplugins', '_blank');
        });

        const btnRow = document.createElement('div');
        btnRow.className = 'side-panel-plugin-btn-row';
        btnRow.appendChild(installBtn);
        btnRow.appendChild(downloadBtn);
        inner.appendChild(btnRow);

        // pdev 变体：开发者工具入口（依赖 window.__dev，由 devconsole 注入）
        if (typeof __PDEV__ !== 'undefined' && __PDEV__) {
            const pdevRow = document.createElement('div');
            pdevRow.className = 'side-panel-plugin-btn-row';

            const consoleBtn = document.createElement('button');
            consoleBtn.className = 'side-panel-plugin-install-btn';
            consoleBtn.textContent = '打开控制台';
            consoleBtn.addEventListener('click', () => {
                const dev = (window as any).__dev;
                dev?.showConsole?.();
            });

            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'side-panel-plugin-install-btn';
            refreshBtn.textContent = '刷新插件';
            refreshBtn.addEventListener('click', () => {
                const dev = (window as any).__dev;
                void dev?.refreshPlugins?.();
            });

            pdevRow.appendChild(consoleBtn);
            pdevRow.appendChild(refreshBtn);
            inner.appendChild(pdevRow);
        }

        this.pluginListContainer = document.createElement('div');
        this.pluginListContainer.className = 'side-panel-plugin-list';
        this.renderPluginList(this.pluginListContainer);
        inner.appendChild(this.pluginListContainer);

        content.appendChild(inner);

        header.addEventListener('click', () => {
            this.pluginSectionExpanded = !this.pluginSectionExpanded;
            section.classList.toggle('expanded', this.pluginSectionExpanded);
        });

        section.appendChild(header);
        section.appendChild(content);

        return section;
    }

    private renderPluginList(container: HTMLElement): void {
        container.replaceChildren();
        const allPlugins = pluginRegistry.getAll().filter(p => !p.builtIn);

        if (allPlugins.length === 0) {
            const emptyTip = document.createElement('div');
            emptyTip.className = 'side-panel-plugin-empty';
            emptyTip.textContent = '暂无已安装的插件';
            container.appendChild(emptyTip);
            return;
        }

        for (const entry of allPlugins) {
            const item = this.createPluginListItem(entry);
            container.appendChild(item);
        }
    }

    private createPluginListItem(entry: PluginEntry): HTMLElement {
        const item = document.createElement('div');
        item.className = 'side-panel-plugin-item';

        const name = document.createElement('span');
        name.className = 'side-panel-plugin-item-name';
        name.textContent = entry.manifest.name;

        const toggle = new ToggleSwitch({
            label: '',
            initialState: entry.enabled,
        });
        toggle.onChange((checked: boolean) => this.handlePluginToggle(entry.manifest.id, checked));

        item.appendChild(name);
        item.appendChild(toggle.element);

        item.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.mp-toggle-item')) {
                this.showPluginDetail(entry);
            }
        });

        return item;
    }

    private showPluginDetail(entry: PluginEntry): void {
        if (this.pluginDetailOverlay) {
            this.pluginDetailOverlay.remove();
        }

        const overlay = document.createElement('div');
        overlay.className = 'mp-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'mp-dialog';

        const header = document.createElement('div');
        header.className = 'mp-dialog-header';

        const title = document.createElement('span');
        title.className = 'mp-dialog-title';
        title.textContent = entry.manifest.name;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'mp-dialog-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', () => overlay.remove());

        header.appendChild(title);
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'mp-dialog-body';

        const infoItems = [
            { label: '版本:', value: entry.manifest.version },
            { label: '作者:', value: entry.manifest.author || '未知' },
            { label: '类型:', value: entry.manifest.type },
            { label: 'ID:', value: entry.manifest.id },
        ];

        for (const item of infoItems) {
            const row = document.createElement('div');
            row.className = 'plugin-detail-row';
            row.innerHTML = `<span class="plugin-detail-label">${item.label}</span><span class="plugin-detail-value">${item.value}</span>`;
            body.appendChild(row);
        }

        if (entry.manifest.description) {
            const desc = document.createElement('div');
            desc.className = 'plugin-detail-desc';
            desc.textContent = entry.manifest.description;
            body.appendChild(desc);
        }

        const footer = document.createElement('div');
        footer.className = 'mp-dialog-footer';

        if (!entry.builtIn) {
            const updateBtn = document.createElement('button');
            updateBtn.className = 'plugin-detail-btn update mp-btn';
            updateBtn.textContent = '更新';
            updateBtn.addEventListener('click', () => this.handlePluginUpdate(entry.manifest.id));
            footer.appendChild(updateBtn);

            const uninstallBtn = document.createElement('button');
            uninstallBtn.className = 'plugin-detail-btn uninstall mp-btn mp-btn--danger';
            uninstallBtn.textContent = '卸载';
            uninstallBtn.addEventListener('click', () => this.handlePluginUninstall(entry.manifest.id));
            footer.appendChild(uninstallBtn);
        } else {
            const builtInLabel = document.createElement('span');
            builtInLabel.className = 'plugin-detail-builtin';
            builtInLabel.textContent = '内置插件';
            footer.appendChild(builtInLabel);
        }

        dialog.appendChild(header);
        dialog.appendChild(body);
        dialog.appendChild(footer);
        overlay.appendChild(dialog);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        document.body.appendChild(overlay);
        this.pluginDetailOverlay = overlay;
    }

    private async handlePluginInstall(): Promise<void> {
        try {
            const filePath = await this.pickPluginFile();
            if (!filePath) return;

            const pluginId = await pluginLoader.installPlugin(filePath);
            if (pluginId) {
                await showConfirmDialog({
                    title: '安装完成',
                    message: '插件已安装，需要重启应用才能生效。点击确定退出应用。',
                    confirmText: '确定',
                });
                App.exitApp();
            }
        } catch (error) {
            console.error('[SidePanel] 安装失败:', error);
            toast.show('安装失败', 'error');
        }
    }

    private async handlePluginToggle(pluginId: string, enabled: boolean): Promise<void> {
        await pluginLoader.setPluginEnabled(pluginId, enabled);
        toast.show(enabled ? '插件已启用，下次启动生效' : '插件已禁用，下次启动生效', 'info');
    }

    private async handlePluginUninstall(pluginId: string): Promise<void> {
        this.pluginDetailOverlay?.remove();

        const confirmed = await showConfirmDialog({
            title: '确认卸载',
            message: '确定要卸载此插件吗？卸载后应用将自动退出。',
            confirmText: '卸载',
            cancelText: '取消',
        });
        if (!confirmed) return;

        await pluginLoader.uninstallPlugin(pluginId);
        App.exitApp();
    }

    private async handlePluginUpdate(pluginId: string): Promise<void> {
        this.pluginDetailOverlay?.remove();

        const confirmed = await showConfirmDialog({
            title: '确认更新',
            message: '确定要更新此插件吗？更新后应用将自动退出。',
            confirmText: '更新',
            cancelText: '取消',
        });
        if (!confirmed) return;

        try {
            const filePath = await this.pickPluginFile();
            if (!filePath) return;

            await pluginLoader.uninstallPlugin(pluginId);
            await pluginLoader.installPlugin(filePath);
            App.exitApp();
        } catch (error) {
            console.error('[SidePanel] 更新失败:', error);
            toast.show('更新失败', 'error');
        }
    }

    private async pickPluginFile(): Promise<string | null> {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.mkp';

            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) {
                    resolve(null);
                    return;
                }

                try {
                    if (Capacitor.isNativePlatform()) {
                        const reader = new FileReader();
                        reader.onload = async () => {
                            const arrayBuffer = reader.result as ArrayBuffer;
                            const uint8Array = new Uint8Array(arrayBuffer);

                            const tempPath = `temp_${Date.now()}.mkp`;
                            const base64 = this.uint8ArrayToBase64(uint8Array);

                            await Filesystem.writeFile({
                                path: tempPath,
                                directory: Directory.Cache,
                                data: base64,
                            });

                            const uriResult = await Filesystem.getUri({
                                path: tempPath,
                                directory: Directory.Cache,
                            });

                            resolve(uriResult.uri);
                        };
                        reader.readAsArrayBuffer(file);
                    } else {
                        resolve(file.name);
                    }
                } catch (error) {
                    console.error('[SidePanel] 文件处理失败:', error);
                    resolve(null);
                }
            });

            input.addEventListener('cancel', () => resolve(null));
            input.click();
        });
    }

    private uint8ArrayToBase64(bytes: Uint8Array): string {
        // 分块处理优化：避免 O(n^2) 字符串拼接
        const chunkSize = 8192;
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            chunks.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
        }
        return btoa(chunks.join(''));
    }

    /** 安全区校准入口，置于菜单底部，方便用户在安全区异常时快速触发重新校准 */
    private createSafeAreaEntry(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'side-panel-safe-area-entry';

        // const divider = document.createElement('div');
        // divider.className = 'side-panel-safe-area-divider';

        const btn = document.createElement('button');
        btn.className = 'side-panel-safe-area-btn';
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" style="margin-right:8px;">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M12 8v4"/>
                <path d="M12 16h.01"/>
            </svg>
            <span>显示区域校准</span>
        `;
        btn.addEventListener('click', () => showSafeAreaTuner());

        //container.appendChild(divider);
        container.appendChild(btn);
        return container;
    }

    private createCopyrightFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'side-panel-footer';

        const appElement = document.createElement('div');
        appElement.className = 'side-panel-footer-application';
        appElement.textContent = 'MikuPlay Reburn ' + __APP_VERSION__;
        this._footerAppElement = appElement;

        const authorElement = document.createElement('div');
        authorElement.className = 'side-panel-footer-copyright';
        authorElement.textContent = '©2026 AKUSERA';
        this._footerAuthorElement = authorElement;
       
        const linksElement = document.createElement('div');
        linksElement.className = 'side-panel-footer-links';
        this._footerLinksElement = linksElement;

        const homepageLink = document.createElement('a');
        homepageLink.className = 'side-panel-footer-link';
        homepageLink.textContent = '主页';
        homepageLink.href = 'https://space.bilibili.com/353601685';
        homepageLink.target = '_blank';
        homepageLink.rel = 'noopener noreferrer';

        const updateLink = document.createElement('a');
        updateLink.className = 'side-panel-footer-link';
        updateLink.textContent = '检查更新';
        updateLink.href = 'https://github.com/AKUSERA1/mikuplay-reburn/releases';
        updateLink.target = '_blank';
        updateLink.rel = 'noopener noreferrer';

        linksElement.appendChild(homepageLink);
        linksElement.appendChild(updateLink);

        footer.appendChild(appElement);
        footer.appendChild(authorElement);
        footer.appendChild(linksElement);

        footer.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).tagName === 'A') return;
            this._handleEasterEggClick();
        });

        return footer;
    }

    /* ===== 彩蛋逻辑 ===== */

    private _handleEasterEggClick(): void {
        this._easterEggClickCount++;
        if (this._easterEggTimer !== null) {
            clearTimeout(this._easterEggTimer);
        }
        this._easterEggTimer = setTimeout(() => {
            this._easterEggClickCount = 0;
            this._easterEggTimer = null;
        }, 1500);

        const count = this._easterEggClickCount;
        if (count === 5) {
            this._triggerTier1();
        } else if (count === 10) {
            this._triggerTier2();
        } else if (count === 15) {
            this._triggerTier3();
        }
    }

    private _triggerTier1(): void {
        if (this._easterEggTier1Triggered) return;
        this._easterEggTier1Triggered = true;

        const appEl = this._footerAppElement;
        if (!appEl) return;

        const originalText = appEl.textContent || '';
        appEl.classList.add('ee-shaking');
        appEl.textContent = 'MikuPlay Reburn 喵~';

        setTimeout(() => {
            appEl.classList.remove('ee-shaking');
            appEl.textContent = originalText;
            this._easterEggTier1Triggered = false;
        }, 2000);
    }

    private _triggerTier2(): void {
        const footer = this.panel.querySelector('.side-panel-footer');
        if (!footer) return;

        const emojis = ['🎉', '🎊', '🎂', '❤️', '💕', '✨', '🌟', '🎀', '🎈', '🥳', '🎶', '💖'];
        const elements: HTMLElement[] = [];

        for (const emoji of emojis) {
            const span = document.createElement('span');
            span.className = 'side-panel-footer-emoji';
            span.textContent = emoji;
            span.style.left = `${10 + Math.random() * 80}%`;
            span.style.bottom = '0px';
            span.style.fontSize = `${18 + Math.random() * 14}px`;
            span.style.animationDelay = `${Math.random() * 0.3}s`;
            footer.appendChild(span);
            elements.push(span);
        }

        this._easterEggEmojiElements = elements;

        setTimeout(() => {
            for (const el of elements) {
                if (el.parentElement) {
                    el.parentElement.removeChild(el);
                }
            }
            this._easterEggEmojiElements = [];
        }, 3000);
    }

    private _triggerTier3(): void {
        const footer = this.panel.querySelector('.side-panel-footer');
        if (!footer) return;

        if (this._easterEggTimer !== null) {
            clearTimeout(this._easterEggTimer);
            this._easterEggTimer = null;
        }

        const appEl = this._footerAppElement;
        const authorEl = this._footerAuthorElement;
        const linksEl = this._footerLinksElement;
        if (appEl) appEl.style.display = 'none';
        if (authorEl) authorEl.style.display = 'none';
        if (linksEl) linksEl.style.display = 'none';

        const overlay = document.createElement('div');
        overlay.className = 'side-panel-footer-easter-egg-text';
        overlay.textContent = 'みくみくにしてあげる♪';
        footer.appendChild(overlay);
        this._easterEggOverlayElement = overlay;

        setTimeout(() => {
            overlay.classList.add('ee-fading-out');
        }, 3000);

        setTimeout(() => {
            if (overlay.parentElement) {
                overlay.parentElement.removeChild(overlay);
            }
            this._easterEggOverlayElement = null;
            if (appEl) appEl.style.display = '';
            if (authorEl) authorEl.style.display = '';
            if (linksEl) linksEl.style.display = '';
        }, 3600);
    }

    public open(): void {
        if (!this.isOpen) {
            this.isOpen = true;
            this.overlay.classList.add('visible');
            this.panel.classList.add('open');
            if (this.pluginListContainer) {
                this.renderPluginList(this.pluginListContainer);
            }
        }
    }

    public close(): void {
        if (this.isOpen) {
            this.isOpen = false;
            this.overlay.classList.remove('visible');
            this.panel.classList.remove('open');
        }
    }

    public toggle(): void {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    public isOpened(): boolean {
        return this.isOpen;
    }

    public dispose(): void {
        this.projectSaveUI?.dispose();
        this.projectSaveUI = null;
        this.performanceToggle?.dispose();
        this.physicsToggle?.dispose();
        this.sharedPhysicsWorldToggle?.dispose();
        this.groundToggle?.dispose();
        this.textureDownsampleToggle?.dispose();
        this.maxSubStepsSelect?.dispose();
        this.fixedTimeStepSelect?.dispose();
        this.frustumCullingToggle?.dispose();
        this.renderScaleDropdown?.dispose();
        this.physicsEngineDropdown?.dispose();
        this.performanceToggle = null;
        this.physicsToggle = null;
        this.physicsEngineDropdown = null;
        this.sharedPhysicsWorldToggle = null;
        this.groundToggle = null;
        this.textureDownsampleToggle = null;
        this.maxSubStepsSelect = null;
        this.fixedTimeStepSelect = null;
        this.frustumCullingToggle = null;
        this.renderScaleDropdown = null;

        /* 清理彩蛋 */
        if (this._easterEggTimer !== null) {
            clearTimeout(this._easterEggTimer);
            this._easterEggTimer = null;
        }
        for (const el of this._easterEggEmojiElements) {
            if (el.parentElement) {
                el.parentElement.removeChild(el);
            }
        }
        this._easterEggEmojiElements = [];
        if (this._easterEggOverlayElement && this._easterEggOverlayElement.parentElement) {
            this._easterEggOverlayElement.parentElement.removeChild(this._easterEggOverlayElement);
            this._easterEggOverlayElement = null;
        }

        if (this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }
        if (this.panel.parentElement) {
            this.panel.parentElement.removeChild(this.panel);
        }
    }
}
