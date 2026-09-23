
import {
    Engine,
    Scene,
    Color4,
    Vector3
} from '@babylonjs/core';
import type { Camera } from '@babylonjs/core';
import type {
    ISceneManager,
    IGridManager,
    ILightManager,
    SceneConfig,
    LightConfig,
    SceneEventType,
    SceneEventCallback
} from './types';
import { GridManager } from './GridManager';
import { LightManager } from './LightManager';
import { ParticleManager } from '../particle/ParticleManager';
import type { IParticleManager } from '../particle/types';

/**
 * 场景管理器
 * 负责场景的初始化、渲染和资源管理
 */
export class SceneManager implements ISceneManager {
    /** WeakMap存储Scene到LightManager的映射，避免污染Scene对象的隐藏类 */
    private static readonly _lightManagerMap = new WeakMap<Scene, ILightManager>();

    /** 获取指定场景的LightManager */
    public static getLightManager(scene: Scene): ILightManager | undefined {
        return SceneManager._lightManagerMap.get(scene);
    }

    /** Babylon 引擎实例 */
    private engine: Engine | null = null;

    /** Babylon 场景实例 */
    private scene: Scene | null = null;

    /** 相机实例 */
    private camera: Camera | null = null;

    /** 坐标格网管理器 */
    private gridManager: IGridManager | null = null;

    /** 光照管理器 */
    private lightManager: ILightManager | null = null;

    /** 粒子管理器 */
    private particleManager: IParticleManager | null = null;

    /** 场景配置 */
    private config: SceneConfig;

    /** 事件监听器映射 */
    private eventListeners: Map<SceneEventType, Set<SceneEventCallback>> = new Map();

    /** 渲染循环ID */
    private renderLoopId: number | null = null;

    /** 是否已初始化 */
    private initialized: boolean = false;

    /** 是否暂停屏幕渲染（用于离线渲染） */
    private screenRenderPaused: boolean = false;

    /** 是否启用视锥体裁剪（低端设备优化） */
    private _frustumCullingEnabled: boolean = false;

    /** 引擎创建时的初始硬件缩放比例（adaptToDeviceRatio 自动计算的值） */
    private _initialHardwareScalingLevel: number = 1.0;

    /**
     * 构造函数
     */
    constructor() {
        this.config = {
            backgroundColor: 'E0E0E0',
            gridVisible: true
        };
    }

    /**
     * 初始化场景
     * @param canvas Canvas 元素
     */
    public async initialize(canvas: HTMLCanvasElement): Promise<void> {
        if (this.initialized) {
            console.warn('SceneManager 已初始化');
            return;
        }

        try {
            await this.initializeEngine(canvas);
            await this.initializeScene();
            await this.initializeCamera();
            await this.initializeManagers();

            // 注意：MmdCamera 本身没有 attachControl 方法
            // 相机控制由 CameraManager 中的 MmdCameraInputManager 管理

            this.setupResizeHandler(canvas);
            this.startRenderLoop();

            this.initialized = true;
        } catch (error) {
            console.error('初始化 SceneManager 失败:', error);
            this.dispose();
            throw error;
        }
    }

    /**
     * 初始化 Babylon 引擎
     * @param canvas Canvas 元素
     */
    private async initializeEngine(canvas: HTMLCanvasElement): Promise<void> {
        this.canvas = canvas;
        this.engine = new Engine(canvas, false, {
            preserveDrawingBuffer: false,
            antialias: true,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: false,
            disableWebGL2Support: false
        }, true);
        // 保存引擎自动计算的初始缩放比例（adaptToDeviceRatio 根据 devicePixelRatio 计算的值）
        this._initialHardwareScalingLevel = this.engine.getHardwareScalingLevel();
    }

    /**
     * 初始化场景
     */
    private async initializeScene(): Promise<void> {
        if (!this.engine) {
            throw new Error('Engine not initialized');
        }

        this.scene = new Scene(this.engine);
        this.scene.onNewMeshAddedObservable.add((mesh) => {
            mesh.alwaysSelectAsActiveMesh = !this._frustumCullingEnabled;
        });

        const bgColor = this.hexToColor4(this.config.backgroundColor);
        this.scene.clearColor = bgColor;
    }

    /**
     * 初始化相机
     */
    private async initializeCamera(): Promise<void> {
        if (!this.scene) {
            throw new Error('Scene not initialized');
        }

        const { MmdCamera } = await import('babylon-mmd/esm/Runtime/mmdCamera');

        this.camera = new MmdCamera(
            'mainCamera',
            Vector3.Zero(),
            this.scene,
            false
        );

        (this.camera as any).rotation.x = -0.22;
        (this.camera as any).updatePosition();

        this.scene.activeCamera = this.camera;
    }

    /**
     * 初始化管理器
     */
    private async initializeManagers(): Promise<void> {
        if (!this.scene) {
            throw new Error('Scene not initialized');
        }

        this.gridManager = new GridManager(this.scene);
        this.gridManager.setVisible(this.config.gridVisible);

        this.lightManager = new LightManager(this.scene);

        // 使用WeakMap存储lightManager，避免污染Scene对象的隐藏类
        SceneManager._lightManagerMap.set(this.scene, this.lightManager);

        this.particleManager = new ParticleManager(this.scene);
    }

    /**
     * 设置窗口大小变化处理器
     * @param canvas Canvas 元素
     */
    private setupResizeHandler(canvas: HTMLCanvasElement): void {
        const resizeObserver = new ResizeObserver(() => {
            if (this.engine) {
                this.engine.resize();
            }
        });

        resizeObserver.observe(canvas);
    }

    /**
     * 启动渲染循环
     */
    private startRenderLoop(): void {
        if (!this.engine || !this.scene) {
            return;
        }

        this.engine.runRenderLoop(() => {
            if (this.scene && !this.screenRenderPaused) {
                this.scene.render();
            }
        });
    }

    /**
     * 暂停屏幕渲染（用于离线渲染）
     */
    public pauseScreenRender(): void {
        this.screenRenderPaused = true;
        console.log('[SceneManager] 屏幕渲染已暂停');
    }

    /**
     * 恢复屏幕渲染
     */
    public resumeScreenRender(): void {
        this.screenRenderPaused = false;
        console.log('[SceneManager] 屏幕渲染已恢复');
    }

    /**
     * 获取屏幕渲染是否暂停
     */
    public isScreenRenderPaused(): boolean {
        return this.screenRenderPaused;
    }

    /**
     * 设置视锥体裁剪是否启用（运行时实时切换）
     * 禁用时：所有网格总是渲染（当前默认行为）
     * 启用时：Babylon自动裁剪视口外网格，节省GPU开销
     * @param enabled 是否启用视锥体裁剪
     */
    public setFrustumCullingEnabled(enabled: boolean): void {
        this._frustumCullingEnabled = enabled;
        if (!this.scene) return;
        this.scene.meshes.forEach(mesh => {
            mesh.alwaysSelectAsActiveMesh = !enabled;
        });
        console.log(`[SceneManager] 视锥体裁剪已${enabled ? '启用' : '禁用'}`);
    }

    /**
     * 获取当前视锥体裁剪状态
     */
    public isFrustumCullingEnabled(): boolean {
        return this._frustumCullingEnabled;
    }

    /**
     * 设置渲染缩放比例（运行时实时切换）
     * 通过 Babylon.js 引擎的 hardwareScalingLevel 实现
     * 值越大渲染分辨率越低（性能越好）
     * level=1.0 → 全分辨率，level=2.0 → 50%分辨率
     * @param level 缩放比例（必须 > 0）
     */
    public setHardwareScalingLevel(level: number): void {
        if (!this.engine) return;
        if (level < 0) {
            console.warn(`[SceneManager] 无效的渲染比例: ${level}，使用 1.0`);
            level = 1.0;
        }
        // level === 0 表示恢复设备默认（引擎创建时 adaptToDeviceRatio 计算的值）
        const appliedLevel = level === 0 ? this._initialHardwareScalingLevel : level;
        this.engine.setHardwareScalingLevel(appliedLevel);
        console.log(`[SceneManager] 渲染比例已设置为 ${appliedLevel}${level === 0 ? '（设备默认）' : ''}`);
    }

    /**
     * 十六进制颜色转 Color4
     * @param hex 十六进制颜色字符串
     * @returns Color4 颜色对象
     */
    private hexToColor4(hex: string): Color4 {
        const cleanHex = hex.replace('#', '');
        const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
        const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
        const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
        return new Color4(r, g, b, 1);
    }

    /**
     * 设置背景色
     * @param hex 十六进制颜色字符串
     */
    public setBackgroundColor(hex: string): void {
        this.config.backgroundColor = hex;
        if (this.scene) {
            this.scene.clearColor = this.hexToColor4(hex);
        }
        this.emit('backgroundColorChanged', hex);
    }

    /**
     * 设置透明背景
     * 将场景清除色 alpha 设为 0，使背景透明。
     * 模型本身的不透明/半透明/透明材质行为不受影响。
     * @param enabled 是否启用透明背景
     */
    public setTransparentBackground(enabled: boolean): void {
        if (!this.scene) return;
        if (enabled) {
            this.scene.clearColor = new Color4(0, 0, 0, 0);
            console.log('[SceneManager] 透明背景已启用');
        } else {
            this.scene.clearColor = this.hexToColor4(this.config.backgroundColor);
            console.log('[SceneManager] 透明背景已禁用');
        }
    }

    /**
     * 设置坐标格网可见性
     * @param visible 是否可见
     */
    public setGridVisible(visible: boolean): void {
        this.config.gridVisible = visible;
        if (this.gridManager) {
            this.gridManager.setVisible(visible);
        }
        this.emit('gridVisibilityChanged', visible);
    }

    /**
     * 获取坐标格网可见性
     * @returns 是否可见
     */
    public getGridVisible(): boolean {
        return this.config.gridVisible;
    }

    /**
     * 获取光照管理器
     * @returns 光照管理器实例
     */
    public getLightManager(): ILightManager | null {
        return this.lightManager;
    }

    /**
     * 获取粒子管理器
     * @returns 粒子管理器实例
     */
    public getParticleManager(): IParticleManager | null {
        return this.particleManager;
    }

    /**
     * 获取坐标格网管理器
     * @returns 坐标格网管理器实例
     */
    public getGridManager(): IGridManager | null {
        return this.gridManager;
    }

    /**
     * 获取场景配置
     * @returns 场景配置
     */
    public getConfig(): SceneConfig {
        return { ...this.config };
    }

    /**
     * 获取光照配置
     * @returns 光照配置
     */
    public getLightConfig(): LightConfig | null {
        return this.lightManager?.getConfig() ?? null;
    }

    /**
     * 获取 Babylon 场景实例
     * @returns 场景实例
     */
    public getScene(): Scene {
        if (!this.scene) {
            throw new Error('Scene not initialized');
        }
        return this.scene;
    }

    /**
     * 获取 Babylon 引擎实例
     * @returns 引擎实例
     */
    public getEngine(): Engine {
        if (!this.engine) {
            throw new Error('Engine not initialized');
        }
        return this.engine;
    }

    /**
     * 获取相机实例
     * @returns 相机实例
     */
    public getCamera(): Camera {
        if (!this.camera) {
            throw new Error('Camera not initialized');
        }
        return this.camera;
    }

    /**
     * 禁用相机控制
     */
    public disableCameraControl(): void {
        if (this.camera) {
            this.camera.detachControl();
        }
    }

    /**
     * 启用相机控制
     */
    public enableCameraControl(): void {
        if (this.camera && this.canvas) {
            this.camera.attachControl(this.canvas, true);
        }
    }

    /** Canvas 元素引用 */
    private canvas: HTMLCanvasElement | null = null;

    /**
     * 添加事件监听
     * @param event 事件类型
     * @param callback 回调函数
     */
    public on(event: SceneEventType, callback: SceneEventCallback): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(callback);
    }

    /**
     * 移除事件监听
     * @param event 事件类型
     * @param callback 回调函数
     */
    public off(event: SceneEventType, callback: SceneEventCallback): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.delete(callback);
        }
    }

    /**
     * 触发事件
     * @param event 事件类型
     * @param data 事件数据
     */
    private emit(event: SceneEventType, data: any): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`事件监听器错误 ${event}:`, error);
                }
            });
        }
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        if (this.engine) {
            this.engine.stopRenderLoop();
        }

        if (this.gridManager) {
            this.gridManager.dispose();
            this.gridManager = null;
        }

        if (this.lightManager) {
            this.lightManager.dispose();
            this.lightManager = null;
        }

        if (this.particleManager) {
            this.particleManager.dispose();
            this.particleManager = null;
        }

        if (this.camera) {
            this.camera.dispose();
            this.camera = null;
        }

        if (this.scene) {
            this.scene.dispose();
            this.scene = null;
        }

        if (this.engine) {
            this.engine.dispose();
            this.engine = null;
        }

        this.eventListeners.clear();
        this.initialized = false;
    }
}
