
import { NavBar } from './featurePanels/NavBar';
import { TopBar } from './TopBar';
import { mainWindowStyles, injectStyles } from '../styles/mainWindow.css';
import { SceneManager } from '../features/scene';
import { ModelManager, AnimationManager, CameraManager, ModelStateManager } from '../features/mmd';
import { PhysicsEngineType } from '../features/mmd/PhysicsEngineTypes';
import { MusicManager } from '../features/audio';
import { PhysicsManager } from '../features/mmd/PhysicsManager';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { showConfirmDialog } from './shared';
import { RenderManager } from '../features/render/RenderManager';
import type { ImportPanelServices, FrameControlCallbacks } from './featurePanels/import/ImportPanelServices';
import type { ImportPanel } from './featurePanels/import/ImportPanel';
import { eventBus, Events, pluginRegistry, PluginStorage } from '../core';
import type { PluginContext, PluginEntry, UIPluginExports } from '../core/IPlugin';
import { themeStateManager } from '../features/state';
import { ProjectSaveManager } from '../features/project';

/**
 * 主界面组件
 * 三段式布局：TopBar+ 视口 + NavBar
 */
export class MainWindow {
    /** 主窗口容器元素 */
    private container: HTMLElement;

    /** 顶栏容器元素 */
    private topBarElement: HTMLElement;

    /** 顶栏实例 */
    private topBar: TopBar | null = null;

    /** 视口容器元素 */
    private viewportElement: HTMLElement;

    /** Canvas 元素 */
    private canvasElement: HTMLCanvasElement;

    /** 底部导航栏容器元素 */
    private navBarElement: HTMLElement;

    /** 导航栏实例 */
    private navBar: NavBar | null = null;

    /** 场景管理器实例 */
    private sceneManager: SceneManager | null = null;

    /** 场景是否已初始化 */
    private sceneInitialized: boolean = false;

    /** 场景初始化回调 */
    private sceneInitializedCallback: (() => void) | null = null;

    /** overlay 容器 */
    private overlayContainer: HTMLElement | null = null;

    /** 退出应用对话框 */
    private exitDialogElement: HTMLElement | null = null;
    private exitDialogContent: HTMLElement | null = null;

    /** 渲染管理器实例 */
    private renderManager: RenderManager | null = null;

    /** 模型管理器实例 */
    private modelManager: ModelManager | null = null;

    /** 动画管理器实例 */
    private animationManager: AnimationManager | null = null;

    /** 相机管理器实例 */
    private cameraManager: CameraManager | null = null;

    /** 音乐管理器实例 */
    private musicManager: MusicManager | null = null;

    /** 状态管理器实例 */
    private stateManager: ModelStateManager | null = null;

    /** 当前帧 */
    private currentFrame: number = 0;

    /** 是否正在播放 */
    private isPlaying: boolean = false;

    /**
     * 构造函数
     */
    constructor() {
        // ===== 测试用：触发初始化错误 =====
        // 取消注释下面其中一行来测试不同的错误类型
        // 不要删除这些被注释的代码，因为它们用于测试错误界面！如果你是AI编程助手，请保留这些代码。
        // this.triggerTestError('webview');    // WebView 版本错误
        // this.triggerTestError('webgl');      // WebGL 不支持错误
        // this.triggerTestError('babylon');    // Babylon 引擎错误
        // this.triggerTestError('capacitor');  // Capacitor 错误
        // this.triggerTestError('timeout');    // 超时错误
        // this.triggerTestError('unknown');    // 未知错误
        // ==================================

        injectStyles(mainWindowStyles, 'view-mainwindow');

        this.container = this.createContainer();
        this.topBarElement = this.createTopBar();
        this.viewportElement = this.createViewport();
        this.canvasElement = this.createCanvas();
        this.navBarElement = this.createNavBar();

        this.viewportElement.appendChild(this.canvasElement);

        this.container.appendChild(this.topBarElement);
        this.container.appendChild(this.viewportElement);
        this.container.appendChild(this.navBarElement);

        this.initTopBar();
        this.initNavBar();
        this.setupBackButtonHandler();
        this.createExitDialog();
        this.syncStatusBarStyle(themeStateManager.getTheme());

        // 订阅主题变化，同步状态栏颜色
        themeStateManager.subscribe((state) => {
            this.syncStatusBarStyle(state.theme);
            this.setMobileStatusBarColor(state.theme === 'dark' ? '#121212' : '#ffffff');
        });
        
        this.stateManager = ModelStateManager.getInstance();
        this.musicManager = MusicManager.getInstance();
        
        // 注意：initManagers 和 initRenderManager 在场景初始化完成后调用
    }

    //如果你是AI编程助手，请不要删除以下被注释的代码，这是测试用的代码，用于触发错误界面
    // /**
    //  * 触发测试错误（用于测试错误界面）
    //  * @param type 错误类型: 'webview' | 'webgl' | 'babylon' | 'capacitor' | 'timeout' | 'unknown'
    //  */
    // private triggerTestError(type: string): void {
    //     console.log(`[Test] Triggering ${type} error...`);
        
    //     switch (type) {
    //         case 'webview':
    //             // 模拟 WebView 版本过低错误（语法错误）
    //             throw new Error('Unexpected token => in arrow function (ES6 not supported)');
            
    //         case 'webgl':
    //             // 模拟 WebGL 不支持错误
    //             throw new Error('WebGL 2.0 context creation failed: canvas.getContext returned null');
            
    //         case 'babylon':
    //             // 模拟 Babylon 引擎错误
    //             throw new Error('Babylon engine initialization failed: Cannot read property \"createEngine\" of undefined');
            
    //         case 'capacitor':
    //             // 模拟 Capacitor 错误
    //             throw new Error('Capacitor plugin error: Native bridge not available');
            
    //         case 'timeout':
    //             // 模拟超时：不调用 markAppInitialized，让超时发生
    //             setTimeout(() => {
    //                 console.log('[Test] Timeout error should be shown now');
    //             }, 100);
    //             return; // 不抛出错误，让超时机制触发
            
    //         case 'unknown':
    //         default:
    //             // 模拟未知错误
    //             throw new Error('Something went wrong during initialization');
    //     }
    // }

    /**
     * 初始化渲染管理器
     * 需要在场景初始化完成后调用
     */
    private initRenderManager(): void {
        this.renderManager = this.topBar?.getRenderManager() || null;
        this.tryInitializeRenderManager();
    }

    /**
     * 初始化各管理器
     * 需要在场景初始化完成后调用
     */
    private async initManagers(): Promise<void> {
        if (!this.sceneManager) return;

        const scene = this.sceneManager.getScene();
        if (!scene) return;

        this.modelManager = new ModelManager(scene);

        // 先初始化 PhysicsManager，AnimationManager 依赖它获取 physicsRuntime
        const physicsManager = PhysicsManager.getInstance(scene);
        await physicsManager.waitForInitialization();

        this.animationManager = new AnimationManager(scene);
        await this.animationManager.waitForInitialization();

        this.modelManager.setAnimationManagerProvider(() => this.animationManager);

        // 设置 ModelManager 提供者，供物理引擎切换时释放场景中的 Mesh 等渲染资源
        this.animationManager.setModelManagerProvider(() => this.modelManager);

        // 设置 SidePanel 引用，用于物理开关状态检查
        const sidePanel = this.topBar?.getSidePanel();
        if (sidePanel) {
            this.animationManager.setSidePanel(sidePanel);
        }

        eventBus.on(Events.ANIMATION_ENDED, () => {
            this.handleAnimationEnd();
        });

        //创建MmdCamera并绑定到 AnimationManager
        const camera = this.sceneManager.getCamera();
        if (camera) {
            const { MmdCamera } = await import('babylon-mmd/esm/Runtime/mmdCamera');
            if (camera instanceof MmdCamera) {
                this.cameraManager = new CameraManager(scene, camera);
                this.cameraManager.enableManualControl();
                this.animationManager.setCameraManager(this.cameraManager);
            }
        }

        const { BoneManager } = await import('../features/mmd/BoneManager');
        BoneManager.getInstance().setAnimationManagerProvider(() => this.animationManager);
        BoneManager.getInstance().setModelManagerProvider(() => this.modelManager);
        if (this.sceneManager) {
            BoneManager.getInstance().setScene(this.sceneManager.getScene());
        }

        console.log('[MainWindow] 初始化完成，模型管理器、动画管理器、相机管理器已创建');

        // 初始化 ProjectSaveManager
        const saveManager = ProjectSaveManager.getInstance();
        saveManager.initialize({
            sceneManager: this.sceneManager,
            modelManager: this.modelManager,
            animationManager: this.animationManager,
            cameraManager: this.cameraManager,
            musicManager: this.musicManager!
        });
    }

    private handleAnimationEnd(): void {
        this.isPlaying = false;
        this.currentFrame = 0;
        this.topBar?.setPlaying(false);
        // 触发帧更新事件，同步更新 FrameController 的显示为0
        eventBus.emit(Events.FRAME_UPDATED, { frame: 0 });
    }

    /**
     * 尝试初始化渲染管理器
     * 如果 AnimationManager 或 CameraManager 尚未就绪，会延迟重试
     */
    private tryInitializeRenderManager(): void {
        if (!this.renderManager || !this.sceneManager) {
            console.warn('[MainWindow] 无法初始化 RenderManager: 依赖项未就绪');
            return;
        }

        if (this.animationManager && this.cameraManager) {
            this.renderManager.initialize(this.animationManager, this.sceneManager, this.cameraManager);
            console.log('[MainWindow] RenderManager 初始化成功');
        } else {
            console.warn('[MainWindow] AnimationManager 或 CameraManager 不可用，将在 500ms 后重试...');
            setTimeout(() => this.tryInitializeRenderManager(), 500);
        }
    }

    /**
     * 初始化顶栏
     */
    private initTopBar(): void {
        this.topBar = new TopBar();
        this.topBarElement.appendChild(this.topBar.getElement());

        // 设置播放/暂停按钮回调
        this.topBar.onPlayPause(() => {
            this.handlePlayPause();
        });

        // 设置停止按钮回调
        this.topBar.onStop(() => {
            this.handleStop();
        });

        // 监听全屏状态变化
        eventBus.on(Events.FULLSCREEN_CHANGED, ({ isFullscreen }) => {
            this.handleFullscreenChange(isFullscreen);
        });

        // 设置物理模拟开关回调
        const sidePanel = this.topBar.getSidePanel();
        sidePanel.onPhysicsToggle((enabled) => {
            this.handlePhysicsToggle(enabled);
        });

        // 设置地面碰撞开关回调
        sidePanel.onGroundToggle((enabled) => {
            this.handleGroundToggle(enabled);
        });

        // 设置重力控制回调
        sidePanel.onGravityChange((x, y, z) => {
            this.handleGravityChange(x, y, z);
        });

        // 设置物理精度控制回调
        sidePanel.onPhysicsPrecisionChange((maxSubSteps, fixedTimeStep) => {
            this.handlePhysicsPrecisionChange(maxSubSteps, fixedTimeStep);
        });

        // 初始化时传递默认物理精度值
        const defaultPhysicsPrecision = sidePanel.getPhysicsPrecision();
        this.handlePhysicsPrecisionChange(defaultPhysicsPrecision.maxSubSteps, defaultPhysicsPrecision.fixedTimeStep);

        // 设置物理引擎切换回调
        sidePanel.onPhysicsEngineChange((value) => {
            this.handlePhysicsEngineChange(value);
        });

        // 设置纹理降采样开关回调
        sidePanel.onTextureDownsampleToggle((enabled) => {
            this.handleTextureDownsampleToggle(enabled);
        });

        // 设置视锥裁剪开关回调
        sidePanel.onFrustumCullingToggle((enabled) => {
            this.handleFrustumCullingToggle(enabled);
        });

        // 设置渲染比例变化回调
        sidePanel.onRenderScaleChange((scale) => {
            this.handleRenderScaleChange(scale);
        });
    }

    /**
     * 处理物理模拟开关
     */
    private async handlePhysicsToggle(enabled: boolean): Promise<void> {
        if (!this.animationManager) {
            console.warn('物理开关: AnimationManager 未初始化');
            return;
        }

        const physicsManager = PhysicsManager.getInstance();
        const modelStateManager = ModelStateManager.getInstance();
        const models = modelStateManager.getModels();

        for (const model of models) {
            try {
                const mmdModel = this.animationManager.getMmdModel(model.id);
                if (!mmdModel) continue;
                await physicsManager.enablePhysics(mmdModel, enabled);
                console.log(`物理开关: 模型 ${model.name} (${model.id}) 物理已${enabled ? '启用' : '禁用'}`);
            } catch (error) {
                console.error(`物理开关: 设置模型 ${model.id} 物理状态失败:`, error);
            }
        }

        eventBus.emit(Events.PHYSICS_TOGGLED, { enabled });
    }

    /**
     * 处理地面碰撞开关（只修改碰撞掩码，不创建/销毁地面碰撞体）
     */
    private handleGroundToggle(enabled: boolean): void {
        if (!PhysicsManager.hasInstance()) {
            return;
        }

        const physicsManager = PhysicsManager.getInstance();
        physicsManager.setGroundCollisionEnabled(enabled);
        console.log(`地面碰撞已${enabled ? '启用' : '禁用'}`);
    }

    /**
     * 处理重力变化
     */
    private async handleGravityChange(x: number, y: number, z: number): Promise<void> {
        if (!PhysicsManager.hasInstance()) {
            return;
        }

        const physicsManager = PhysicsManager.getInstance();

        try {
            await physicsManager.setGravity(x, y, z);
            console.log(`重力控制: 已设置为 (${x}, ${y}, ${z})`);
            eventBus.emit(Events.GRAVITY_CHANGED, { x, y, z });
        } catch (error) {
            console.error('重力控制: 设置重力失败:', error);
        }
    }

    /**
     * 处理物理精度变化
     */
    private handlePhysicsPrecisionChange(maxSubSteps: number, fixedTimeStep: number): void {
        if (!PhysicsManager.hasInstance()) {
            return; // PhysicsManager 尚未初始化，忽略
        }

        const physicsManager = PhysicsManager.getInstance();

        try {
            physicsManager.setPhysicsPrecision(maxSubSteps, fixedTimeStep);
            console.log(`物理精度: 已设置 maxSubSteps=${maxSubSteps}, fixedTimeStep=${fixedTimeStep.toFixed(5)}`);
        } catch (error) {
            console.error('物理精度: 设置失败:', error);
        }
    }

    /**
     * 处理物理引擎切换
     */
    private async handlePhysicsEngineChange(value: string): Promise<void> {
        if (!this.animationManager) {
            console.warn('物理引擎切换: AnimationManager 未初始化');
            return;
        }

        const type = value === 'reze' ? PhysicsEngineType.RezePhysics : PhysicsEngineType.MmdWasmInstanceTypeSPR;

        // 如果当前引擎类型已经是目标类型，跳过
        const { PhysicsEngineFactory } = await import('../features/mmd/PhysicsEngineFactory');
        if (PhysicsEngineFactory.getInstance().currentType === type) {
            return;
        }

        // 显示确认对话框
        const confirmed = await showConfirmDialog({
            title: '切换物理引擎',
            message: '切换物理引擎将清空当前场景并重新初始化，是否继续？',
            confirmText: '继续',
            cancelText: '取消'
        });

        if (!confirmed) {
            // 取消：恢复下拉框到之前的引擎类型
            const sidePanel = this.topBar?.getSidePanel();
            if (sidePanel) {
                const currentType = PhysicsEngineFactory.getInstance().currentType;
                sidePanel.setPhysicsEngine(currentType === PhysicsEngineType.RezePhysics ? 'reze' : 'spr');
            }
            return;
        }

        const currentType = value === 'reze' ? PhysicsEngineType.MmdWasmInstanceTypeSPR : PhysicsEngineType.RezePhysics;
        console.log(`物理引擎切换: 从 ${currentType} 切换到 ${type}`);

        try {
            // 停止动画
            if (this.animationManager.isAnimationPlaying()) {
                await this.animationManager.pauseAnimation();
                this.musicManager?.pause();
                this.topBar?.setPlaying(false);
                this.isPlaying = false;
                this.stopFrameUpdateLoop();
            }

            // 执行引擎切换（清空场景并重新初始化）
            await this.animationManager.switchPhysicsEngine(type);

            // 引擎切换成功后刷新 sidePanel 的引擎相关 UI 并持久化，确保 UI 与实际引擎一致
            this.topBar?.getSidePanel()?.applyPhysicsEngineUI(type === PhysicsEngineType.RezePhysics ? 'reze' : 'spr');

            // 刷新导入面板 UI（模型列表 / 动作列表已由 switchPhysicsEngine 清空，重新渲染为空的列表）
            const importPanel = this.navBar?.getPanel('import') as unknown as ImportPanel | undefined;
            importPanel?.getModelSection()?.refreshModelListUI();
            importPanel?.getAnimationSection()?.updateMotionCardState();

            // 重置帧状态（场景已清空，从0开始）
            this.currentFrame = 0;
            eventBus.emit(Events.FRAME_UPDATED, { frame: 0 });

            // 同步物理精度设置（RezePhysics 使用自己的默认值，SPR 同步当前面板值）
            if (type === PhysicsEngineType.MmdWasmInstanceTypeSPR) {
                const sidePanel = this.topBar?.getSidePanel();
                if (sidePanel) {
                    const precision = sidePanel.getPhysicsPrecision();
                    this.handlePhysicsPrecisionChange(precision.maxSubSteps, precision.fixedTimeStep);
                }
            }

            console.log(`物理引擎切换完成: ${type}`);
        } catch (error) {
            console.error('物理引擎切换失败:', error);
        }
    }

    /**
     * 处理纹理降采样开关
     */
    private handleTextureDownsampleToggle(enabled: boolean): void {
        if (!this.modelManager) {
            console.warn('纹理降采样: ModelManager 未初始化');
            return;
        }

        try {
            this.modelManager.setTextureDownsampleEnabled(enabled);
            console.log(`纹理降采样: 已${enabled ? '启用' : '禁用'}`);
            eventBus.emit(Events.TEXTURE_DOWNSAMPLE_TOGGLED, { enabled });
        } catch (error) {
            console.error('纹理降采样: 设置失败:', error);
        }
    }

    /**
     * 处理视锥裁剪开关
     */
    private handleFrustumCullingToggle(enabled: boolean): void {
        if (!this.sceneManager) {
            console.warn('视锥裁剪: SceneManager 未初始化');
            return;
        }
        this.sceneManager.setFrustumCullingEnabled(enabled);
        console.log(`视锥裁剪已${enabled ? '启用' : '禁用'}`);
    }

    /**
     * 处理渲染比例变化
     */
    private handleRenderScaleChange(scale: number): void {
        if (!this.sceneManager) {
            console.warn('渲染比例: SceneManager 未初始化');
            return;
        }
        this.sceneManager.setHardwareScalingLevel(scale);
        console.log(`渲染比例已设置为 ${scale === 0 ? '设备默认' : scale}`);
    }

    /**
     * 处理播放/暂停按钮点击
     */
    private async handlePlayPause(): Promise<void> {
        if (!this.animationManager) return;

        try {
            if (this.animationManager.isAnimationPlaying()) {
                // 暂停动画
                await this.animationManager.pauseAnimation();
                // 暂停音乐
                this.musicManager?.pause();
                this.topBar?.setPlaying(false);
                this.isPlaying = false;
                this.stopFrameUpdateLoop();
            } else {
                // 先 seek 音乐到当前帧对应的时间点
                const frameSeconds = this.currentFrame / 30;
                this.musicManager?.seek(frameSeconds);
                if (this.musicManager?.getCurrentMusic()) {
                    await this.musicManager.play();
                }
                // 再 seek 动画并播放
                await this.animationManager.seekAnimation(this.currentFrame);
                await this.animationManager.playAnimation();
                this.topBar?.setPlaying(true);
                this.isPlaying = true;
                this.startFrameUpdateLoop();
            }
        } catch (error) {
            console.error('播放/暂停动画失败:', error);
        }
    }

    /**
     * 处理停止按钮点击
     */
    private async handleStop(): Promise<void> {
        if (!this.animationManager) return;

        try {
            // 停止动画
            await this.animationManager.stopAnimation();
            // 停止音乐
            this.musicManager?.stop();
            this.topBar?.setPlaying(false);
            this.isPlaying = false;
            this.currentFrame = 0;
            // 触发帧更新事件，同步更新 FrameController 的显示
            eventBus.emit(Events.FRAME_UPDATED, { frame: 0 });
            this.stopFrameUpdateLoop();
        } catch (error) {
            console.error('停止动画失败:', error);
        }
    }

    /**
     * 处理全屏状态变化
     */
    private handleFullscreenChange(isFullscreen: boolean): void {
        if (isFullscreen) {
            // 进入全屏：隐藏顶部栏、底部导航栏
            this.topBarElement.style.display = 'none';
            this.navBarElement.style.display = 'none';

            // 设置视口占满整个屏幕
            this.viewportElement.style.position = 'fixed';
            this.viewportElement.style.top = '0';
            this.viewportElement.style.left = '0';
            this.viewportElement.style.width = '100vw';
            this.viewportElement.style.height = '100vh';
            this.viewportElement.style.zIndex = '9999';

            // 移动端适配：设置安全区域颜色
            this.setMobileStatusBarColor('#000000');
        } else {
            // 退出全屏：恢复UI元素
            this.topBarElement.style.display = '';
            this.navBarElement.style.display = '';

            // 恢复视口样式
            this.viewportElement.style.position = '';
            this.viewportElement.style.top = '';
            this.viewportElement.style.left = '';
            this.viewportElement.style.width = '';
            this.viewportElement.style.height = '';
            this.viewportElement.style.zIndex = '';

            // 恢复移动端状态栏颜色
            this.setMobileStatusBarColor(themeStateManager.isDarkMode() ? '#121212' : '#ffffff');
            this.syncStatusBarStyle(themeStateManager.getTheme());
        }

        // 触发窗口大小变化事件，确保画布正确调整大小
        window.dispatchEvent(new Event('resize'));
    }

    /**
     * 同步状态栏图标颜色
     * 亮色主题：状态栏图标深色 (Light)
     * 暗色主题：状态栏图标浅色 (Dark)
     */
    private async syncStatusBarStyle(themeKey?: string): Promise<void> {
        try {
            const style = themeKey === 'dark' ? Style.Dark : Style.Light;
            await StatusBar.setStyle({ style });
        } catch (error) {
            console.warn('状态栏样式同步失败:', error);
        }
    }

    /**
     * 设置移动端状态栏颜色
     */
    private setMobileStatusBarColor(color: string): void {
        let metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (!metaThemeColor) {
            metaThemeColor = document.createElement('meta');
            metaThemeColor.setAttribute('name', 'theme-color');
            document.head.appendChild(metaThemeColor);
        }
        if (color) {
            metaThemeColor.setAttribute('content', color);
        } else {
            metaThemeColor.setAttribute('content', '#ffffff');
        }
    }

    /** 返回键处理防抖标记 */
    private isHandlingBackButton: boolean = false;

    /**
     * 设置返回键处理（移动端）
     * 全屏时：点击返回键退出全屏
     * 侧边栏打开时：点击返回键关闭侧边栏
     * 其他情况：显示退出应用对话框
     */
    private setupBackButtonHandler(): void {
        console.log('[BackButton] 设置返回按钮处理程序');

        // 使用 Capacitor App 插件监听返回键
        App.addListener('backButton', () => {
            console.log('[BackButton] 收到 Capacitor 返回按钮事件');
            this.handleBackButton();
        });

        // 同时监听 ESC 键（用于 Web 端测试）
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                console.log('[BackButton] 检测到 ESC 键');
                e.preventDefault();
                this.handleBackButton();
            }
        };
        document.addEventListener('keydown', handleKeyDown);

        console.log('[BackButton] 返回按钮处理程序设置完成');
    }

    /**
     * 处理返回键逻辑
     */
    private handleBackButton(): void {
        // 防抖处理：如果正在处理返回键，直接返回
        if (this.isHandlingBackButton) {
            console.log('[BackButton] 已防抖，忽略重复事件');
            return;
        }

        this.isHandlingBackButton = true;
        console.log('[BackButton] 处理返回按钮, exitDialogElement:', !!this.exitDialogElement);

        // 延迟重置防抖标记（延长到500ms确保动画完成）
        setTimeout(() => {
            this.isHandlingBackButton = false;
            console.log('[BackButton] 防抖重置');
        }, 500);

        // 如果退出对话框已显示，关闭对话框
        if (this.exitDialogElement) {
            console.log('[BackButton] 退出对话框正在显示，关闭它');
            this.closeExitDialog();
            return;
        }

        // 检查是否在全屏模式
        if (this.topBar?.isInFullscreen()) {
            console.log('[BackButton] 在全屏中，退出全屏');
            // 全屏模式下，退出全屏
            this.topBar?.exitFullscreen();
            return;
        }

        // 检查侧边栏是否打开（优先处理）
        const sidePanel = this.topBar?.getSidePanel();
        const isSidePanelOpen = sidePanel?.isOpened() ?? false;
        console.log('[BackButton] SidePanel 是否打开:', isSidePanelOpen);
        if (isSidePanelOpen) {
            console.log('[BackButton] 关闭侧边栏');
            sidePanel?.close();
            return;
        }

        // 显示退出应用对话框
        console.log('[BackButton] Showing exit dialog');
        this.showExitDialog();
    }

    /**
     * 创建退出应用对话框（预创建，避免重复创建 DOM）
     */
    private createExitDialog(): void {
        // 创建对话框遮罩
        const overlay = document.createElement('div');
        overlay.className = 'mp-dialog-overlay';
        overlay.style.display = 'none';

        // 创建对话框内容
        const dialog = document.createElement('div');
        dialog.className = 'mp-dialog exit-dialog';
        dialog.innerHTML = `
            <p class="mp-dialog-message exit-dialog-message">确定要退出应用吗？</p>
            <div class="mp-dialog-footer exit-dialog-footer">
                <button class="mp-btn" id="exit-dialog-cancel">取消</button>
                <button class="mp-btn mp-btn--primary" id="exit-dialog-exit">退出</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // 绑定事件
        const cancelBtn = dialog.querySelector('#exit-dialog-cancel');
        const exitBtn = dialog.querySelector('#exit-dialog-exit');

        cancelBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('[BackButton] Cancel button clicked');
            this.closeExitDialog();
        });

        exitBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('[BackButton] Exit button clicked');
            this.closeExitDialog();
            this.exitApp();
        });

        // 点击遮罩关闭对话框
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                console.log('[BackButton] Overlay clicked, closing dialog');
                this.closeExitDialog();
            }
        });

        this.exitDialogElement = overlay;
        this.exitDialogContent = dialog;
    }

    /**
     * 显示退出应用对话框
     */
    private showExitDialog(): void {
        if (!this.exitDialogElement) {
            this.createExitDialog();
        }
        if (this.exitDialogElement) {
            this.exitDialogElement.style.display = 'flex';
        }
    }

    /**
     * 关闭退出应用对话框
     */
    private closeExitDialog(): void {
        if (this.exitDialogElement) {
            this.exitDialogElement.remove();
            this.exitDialogElement = null;
        }
    }

    /**
     * 退出应用
     */
    private async exitApp(): Promise<void> {
        try {
            // 使用 Capacitor App 插件退出
            await App.exitApp();
        } catch (error) {
            console.error('退出应用失败:', error);
            // Web 环境下关闭窗口
            if (window.close) {
                window.close();
            }
        }
    }

    private frameUpdateLoopId: number | null = null;

    /**
     * 启动帧更新循环
     */
    private startFrameUpdateLoop(): void {
        if (this.frameUpdateLoopId !== null) return;

        if (!this.animationManager) return;

        const updateFrame = () => {
            if (!this.animationManager!.isAnimationPlaying()) {
                this.stopFrameUpdateLoop();
                return;
            }

            const currentFrame = this.animationManager!.getCurrentAnimationTime?.() ?? 0;
            this.currentFrame = currentFrame;

            // 触发帧更新事件，通知 FrameController 更新显示
            eventBus.emit(Events.FRAME_UPDATED, { frame: currentFrame });

            // 注意：camera 动画已在 AnimationManager._checkAnimationEnd 中由引擎 renderLoop 驱动
            // 此处不再重复调用 mmdCamera.animate()，避免双重驱动

            this.frameUpdateLoopId = requestAnimationFrame(updateFrame);
        };

        this.frameUpdateLoopId = requestAnimationFrame(updateFrame);
    }

    /**
     * 停止帧更新循环
     */
    private stopFrameUpdateLoop(): void {
        if (this.frameUpdateLoopId !== null) {
            cancelAnimationFrame(this.frameUpdateLoopId);
            this.frameUpdateLoopId = null;
        }
    }

    /**
     * 初始化导航栏
     */
    private initNavBar(): void {
        const frameControlCallbacks: FrameControlCallbacks = {
            onFrameChange: (frame: number) => {
                this.currentFrame = frame;
                // 手动 seek 帧时同步 seek 音乐
                this.musicManager?.seek(frame / 30);
            },
            onPlayingChange: (playing: boolean) => {
                this.isPlaying = playing;
            }
        };
        this.navBar = new NavBar(this, frameControlCallbacks);
        this.navBarElement.appendChild(this.navBar.getElement());
    }

    /**
     * 创建主窗口容器
     * @returns 主窗口容器元素
     */
    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'main-window';
        return container;
    }

    /**
     * 创建顶栏容器（预留空容器）
     * @returns 顶栏容器元素
     */
    private createTopBar(): HTMLElement {
        const topBar = document.createElement('div');
        topBar.className = 'top-bar';
        topBar.id = 'top-bar';
        return topBar;
    }

    /**
     * 创建视口容器
     * @returns 视口容器元素
     */
    private createViewport(): HTMLElement {
        const viewport = document.createElement('div');
        viewport.className = 'viewport';
        viewport.id = 'viewport';
        return viewport;
    }

    /**
     * 创建 Canvas 元素
     * @returns Canvas 元素
     */
    private createCanvas(): HTMLCanvasElement {
        const canvas = document.createElement('canvas');
        canvas.className = 'scene-canvas';
        canvas.id = 'scene-canvas';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.style.touchAction = 'none';
        return canvas;
    }

    /**
     * 创建底部导航栏容器（预留空容器）
     * @returns 导航栏容器元素
     */
    private createNavBar(): HTMLElement {
        const navBar = document.createElement('div');
        navBar.className = 'nav-bar';
        navBar.id = 'nav-bar';
        return navBar;
    }

    /**
     * 初始化场景
     * 异步初始化，避免阻塞 UI 线程
     */
    private async initScene(): Promise<void> {
        if (this.sceneInitialized || this.sceneManager) {
            return;
        }

        try {
            this.sceneManager = new SceneManager();
            await this.sceneManager.initialize(this.canvasElement);
            
            const camera = this.sceneManager.getCamera();
            const scene = this.sceneManager.getScene();
            
            if (camera && scene) {
                camera.attachControl(this.canvasElement, true);
            }
            
            this.sceneInitialized = true;
            
            await this.initManagers();
            this.initRenderManager();

            this.onSceneReady();

            // 应用持久化的渲染设置
            this.applySavedRenderSettings();
        } catch (error) {
            console.error('初始化场景失败:', error);
            this.sceneManager = null;
            this.reportError(error);
        }
    }

    /**
     * 上报初始化错误到错误界面
     */
    private reportError(error: unknown): void {
        if (typeof (window as any).reportInitError === 'function') {
            if (error instanceof Error) {
                (window as any).reportInitError(error);
            } else if (typeof error === 'string') {
                (window as any).reportInitError(new Error(error));
            } else {
                (window as any).reportInitError(new Error('Unknown initialization error'));
            }
        }
    }

    /**
     * 挂载主窗口到DOM
     * @param parentElement 父元素，默认为document.body
     */
    public mount(parentElement: HTMLElement = document.body): void {
        parentElement.appendChild(this.container);
        this.hideLoading();
        
        requestAnimationFrame(() => {
            this.initScene();
        });
    }

    /**
     * 隐藏加载动画
     */
    private hideLoading(): void {
        const loading = document.getElementById('loading');
        if (loading) {
            loading.classList.add('hidden');
            setTimeout(() => {
                loading.style.display = 'none';
            }, 300);
        }
        // 标记应用初始化成功，清除超时检测
        if (typeof (window as any).markAppInitialized === 'function') {
            (window as any).markAppInitialized();
        }
    }

    /**
     * 从DOM卸载主窗口
     */
    public unmount(): void {
        if (this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
    }

    /**
     * 获取顶栏元素
     * @returns 顶栏DOM元素
     */
    public getTopBar(): HTMLElement {
        return this.topBarElement;
    }

    /**
     * 获取视口元素
     * @returns 视口DOM元素
     */
    public getViewport(): HTMLElement {
        return this.viewportElement;
    }

    /**
     * 获取 Canvas 元素
     * @returns Canvas 元素
     */
    public getCanvas(): HTMLCanvasElement {
        return this.canvasElement;
    }

    /**
     * 获取导航栏元素
     * @returns 导航栏DOM元素
     */
    public getNavBar(): HTMLElement {
        return this.navBarElement;
    }

    /**
     * 获取顶栏实例
     * @returns TopBar实例
     */
    public getTopBarInstance(): TopBar | null {
        return this.topBar;
    }

    /**
     * 获取导航栏实例
     * @returns NavBar实例
     */
    public getNavBarInstance(): NavBar | null {
        return this.navBar;
    }

    /**
     * 获取场景管理器实例
     * @returns SceneManager实例
     */
    public getSceneManager(): SceneManager | null {
        return this.sceneManager;
    }

    /**
     * 获取模型管理器实例
     */
    public getModelManager(): ModelManager | null {
        return this.modelManager;
    }

    /**
     * 获取动画管理器实例
     */
    public getAnimationManager(): AnimationManager | null {
        return this.animationManager;
    }

    /**
     * 获取相机管理器实例
     */
    public getCameraManager(): CameraManager | null {
        return this.cameraManager;
    }

    /**
     * 获取音乐管理器实例
     */
    public getMusicManager(): MusicManager | null {
        return this.musicManager;
    }

    /**
     * 获取状态管理器实例
     */
    public getStateManager(): ModelStateManager | null {
        return this.stateManager;
    }

    /**
     * 获取当前帧
     */
    public getCurrentFrame(): number {
        return this.currentFrame;
    }

    /**
     * 设置当前帧
     */
    public setCurrentFrame(frame: number): void {
        this.currentFrame = frame;
    }

    /**
     * 获取播放状态
     */
    public getIsPlaying(): boolean {
        return this.isPlaying;
    }

    /**
     * 获取 ImportPanel 服务接口
     */
    public getImportPanelServices(): ImportPanelServices | null {
        if (!this.modelManager || !this.animationManager || !this.cameraManager || 
            !this.musicManager || !this.stateManager) {
            return null;
        }
        return {
            modelManager: this.modelManager,
            animationManager: this.animationManager,
            cameraManager: this.cameraManager,
            musicManager: this.musicManager,
            stateManager: this.stateManager,
            eventBus: eventBus
        };
    }

    /**
     * 设置坐标格网可见性
     * @param visible 是否可见
     */
    public setGridVisible(visible: boolean): void {
        if (this.sceneManager) {
            this.sceneManager.setGridVisible(visible);
        }
    }

    /**
     * 获取坐标格网可见性
     * @returns 是否可见
     */
    public getGridVisible(): boolean {
        return this.sceneManager?.getGridVisible() ?? true;
    }

    /**
     * 设置场景背景色
     * @param hex 十六进制颜色字符串
     */
    public setBackgroundColor(hex: string): void {
        if (this.sceneManager) {
            this.sceneManager.setBackgroundColor(hex);
        }
    }

    /**
     * 注册场景初始化完成回调
     */
    public onSceneInitialized(callback: () => void): void {
        if (this.sceneInitialized) {
            callback();
        } else {
            this.sceneInitializedCallback = callback;
        }
    }

    /**
     * 场景初始化完成时调用
     */
    private onSceneReady(): void {
        if (this.sceneInitializedCallback) {
            this.sceneInitializedCallback();
            this.sceneInitializedCallback = null;
        }
    }

    /**
     * 应用持久化的渲染设置（从localStorage加载）
     */
    private applySavedRenderSettings(): void {
        if (!this.sceneManager) return;

        try {
            // 应用视锥裁剪
            const savedFrustum = localStorage.getItem('mikuplay_frustum_culling');
            if (savedFrustum !== null) {
                const enabled = savedFrustum === 'true';
                this.sceneManager.setFrustumCullingEnabled(enabled);
                const sidePanel = this.topBar?.getSidePanel();
                if (sidePanel) {
                    sidePanel.setFrustumCullingEnabled(enabled);
                }
            }

            // 应用渲染比例
            const savedScale = localStorage.getItem('mikuplay_render_scale');
            if (savedScale !== null) {
                const scale = parseFloat(savedScale);
                if (scale > 0) {
                    this.sceneManager.setHardwareScalingLevel(scale);
                }
            }
        } catch (error) {
            console.warn('应用持久化渲染设置失败:', error);
        }
    }

    /**
     * 创建插件上下文
     */
    public createPluginContext(pluginId: string): PluginContext {
        const scene = this.sceneManager!.getScene();
        const engine = this.sceneManager!.getEngine();

        return {
            scene,
            engine,
            eventBus,
            storage: new PluginStorage(pluginId),
            assetsDir: '',
            app: {
                getScene: () => scene,
                getEngine: () => engine,
                getAnimationManager: () => this.animationManager,
                getMusicManager: () => this.musicManager,
                getModelManager: () => this.modelManager,
            },
        };
    }

    /**
     * 创建 overlay 容器
     */
    private createOverlayContainer(): HTMLElement {
        const overlay = document.createElement('div');
        overlay.className = 'mp-plugin-overlay';
        overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;';
        this.viewportElement.appendChild(overlay);
        this.overlayContainer = overlay;
        return overlay;
    }

    /**
     * 挂载 overlay 型插件
     */
    public mountPluginOverlays(): void {
        if (!this.overlayContainer) {
            this.createOverlayContainer();
        }
        const overlayPlugins = pluginRegistry.getByMount('overlay');
        for (const entry of overlayPlugins) {
            if (entry.manifest.type === 'ui') {
                const uiData = entry.data as UIPluginExports;
                if (uiData.createPanel) {
                    const context = this.createPluginContext(entry.manifest.id);
                    const element = uiData.createPanel(context);
                    if (element) {
                        element.style.pointerEvents = 'auto';
                        this.overlayContainer!.appendChild(element);
                    }
                }
            }
        }
    }

    /**
     * 注册 UI 型插件 tab 到 NavBar
     */
    public registerPluginTabs(): void {
        if (!this.navBar) return;
        const tabPlugins = pluginRegistry.getByMount('tab');
        for (const entry of tabPlugins) {
            if (entry.manifest.type === 'ui') {
                this.navBar.registerPluginTab(entry, this);
            }
        }
    }

    /**
     * 注销所有非内置插件 tab（pdev 热重载前清理）
     */
    public unregisterPluginTabs(): void {
        if (!this.navBar) return;
        const allPlugins = pluginRegistry.getAll();
        for (const entry of allPlugins) {
            if (!entry.builtIn && entry.manifest.type === 'ui' && (entry.manifest.mount ?? 'tab') === 'tab') {
                this.navBar.unregisterPanel(entry.manifest.id);
            }
        }
    }

    /**
     * 卸载所有非内置 overlay 型插件 DOM（pdev 热重载前清理）
     */
    public unmountPluginOverlays(): void {
        if (this.overlayContainer) {
            this.overlayContainer.innerHTML = '';
        }
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.stopFrameUpdateLoop();

        // 释放所有插件资源（setInterval、指针观察者、ObjectURL 等）
        void pluginRegistry.disposeAll();

        if (this.sceneManager) {
            this.sceneManager.dispose();
            this.sceneManager = null;
        }
        
        this.navBar?.dispose();
        this.topBar?.dispose();
        this.sceneInitialized = false;
    }
}
