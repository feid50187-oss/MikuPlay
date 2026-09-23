
import { AnimationManager } from '../mmd/AnimationManager';
import { SceneManager } from '../scene/SceneManager';
import { CameraManager } from '../mmd/CameraManager';
import { screenRecorderManager, RecordingOptions } from '../../plugins/ScreenRecorder';
import { VideoPostProcess } from '../../plugins/VideoPostProcess';
import { RenderSettings } from '../../UIComponents/RenderUI';
import { eventBus, Events } from '../../core';
import { PhysicsManager } from '../mmd/PhysicsManager';
import { PhysicsEngineFactory } from '../mmd/PhysicsEngineFactory';
import { PhysicsEngineType } from '../mmd/PhysicsEngineTypes';
import { videoComposeManager } from '../videoCompose';
import { Capacitor } from '@capacitor/core';

export interface RealtimeRenderCallbacks {
    onRenderStart: () => void;
    onRenderComplete: (outputPath: string) => void;
    onRenderError: (error: string) => void;
    onRenderCancelled: () => void;
}

export class RealtimeRenderManager {
    private animationManager: AnimationManager;
    private sceneManager: SceneManager;
    private cameraManager: CameraManager | null = null;
    private isRendering = false;
    private shouldStop = false;
    private callbacks: RealtimeRenderCallbacks | null = null;
    private uiElements: HTMLElement[] = [];
    private unsubscribeAnimationEnd: (() => void) | null = null;

    // 固定步长慢放模式（渲染帧率上限控制）：
    // 非无限制时，动画时间按"渲染帧数 × 固定步长"推进，与真实时钟解耦；
    // 渲染能力不足时动画整体慢放但不丢帧，用户自行倍速即可得到帧率稳定的视频。
    private _manualStepObserver: any | null = null;
    private _manualStepMs: number = 0;          // 固定步长（ms），= 1000 / renderFps
    private _lastStepTime: number = 0;          // 上次推进动画的时刻（性能计时，节流用）
    private _isManualStepReze: boolean = false; // 当前是否 RezePhysics（手动步进分支不同）
    private _rezeModule: { RezeMmdPhysics: typeof import('../mmd/physics/RezeMmdPhysics').RezeMmdPhysics } | null = null;
    private _currentRenderFps: number | null = null;  // 当前渲染帧率（null=无限制），用于后处理倍速计算

    constructor(animationManager: AnimationManager, sceneManager: SceneManager) {
        this.animationManager = animationManager;
        this.sceneManager = sceneManager;
    }

    public setCameraManager(cameraManager: CameraManager): void {
        this.cameraManager = cameraManager;
    }

    public setCallbacks(callbacks: RealtimeRenderCallbacks): void {
        this.callbacks = callbacks;
    }

    public hasAnimation(): boolean {
        return this.animationManager.hasAnyAnimation();
    }

    public async startRender(settings: RenderSettings): Promise<boolean> {
        if (this.isRendering) {
            console.warn('[RealtimeRenderManager] 渲染已在进行中');
            return false;
        }

        if (!this.hasAnimation()) {
            this.callbacks?.onRenderError('没有MMD动画，无法开始渲染');
            return false;
        }

        const permissionGranted = await screenRecorderManager.requestPermission();
        if (!permissionGranted) {
            this.callbacks?.onRenderError('未获得屏幕录制权限');
            return false;
        }

        this.isRendering = true;
        this.shouldStop = false;

        try {
            this.disableCameraControl();
            this.hideAllUI();

            // 渲染帧率上限控制：非无限制时进入固定步长慢放模式（须在 playAnimation 之前注册步进回调，
            // 保证手动步进先于 AnimationManager 的 _checkAnimationEnd 执行，相机动画读到最新帧号）
            const renderFps = settings.renderFps ?? null;
            this._currentRenderFps = renderFps;  // 保存供后处理倍速计算使用
            if (renderFps !== null && renderFps > 0) {
                await this._enterManualStepMode(renderFps);
            }

            const recordingOptions: RecordingOptions = {
                bitrate: settings.bitrate
            };

            const recordingStarted = await screenRecorderManager.startRecording(recordingOptions);
            if (!recordingStarted) {
                this.cleanup();
                this.callbacks?.onRenderError('无法开始屏幕录制');
                return false;
            }

            this.callbacks?.onRenderStart();

            this.unsubscribeAnimationEnd = eventBus.on(Events.ANIMATION_ENDED, this.handleAnimationEnd);
            await this.animationManager.playAnimation();

            return true;
        } catch (error) {
            console.error('[RealtimeRenderManager] 渲染错误:', error);
            this.cleanup();
            this.callbacks?.onRenderError(error instanceof Error ? error.message : '渲染失败');
            return false;
        }
    }

    /**
     * 进入固定步长慢放模式（渲染帧率上限控制）
     * 动画时间不再跟随引擎真实 deltaTime，改为每渲染一帧推进固定 stepMs；
     * 渲染能力不足时动画慢放但不丢帧，用户自行倍速即可得到帧率稳定的视频。
     * 必须在 playAnimation 之前调用（保证步进回调先于 _checkAnimationEnd 注册）。
     */
    private async _enterManualStepMode(renderFps: number): Promise<void> {
        const scene = this.sceneManager.getScene();
        const mmdRuntime = this.animationManager.getMmdRuntime();
        if (!mmdRuntime) return;

        this._manualStepMs = 1000 / renderFps;
        this._lastStepTime = 0;
        this._isManualStepReze =
            PhysicsEngineFactory.getInstance().currentType === PhysicsEngineType.RezePhysics;

        // 解除引擎 deltaTime 驱动（移除 beforePhysics/afterPhysics 的 observable 回调）
        mmdRuntime.unregister(scene);
        const physicsRuntime = PhysicsManager.getInstance().getPhysicsRuntime();
        if (physicsRuntime) {
            physicsRuntime.unregister();
        }

        if (this._isManualStepReze) {
            this._rezeModule = await import('../mmd/physics/RezeMmdPhysics');
            this._rezeModule.RezeMmdPhysics.setManualStepMode(true);
        }

        // 手动步进：每帧渲染前按固定步长推进动画+物理（注册在 onBeforeRenderObservable，
        // 先于 AnimationManager._checkAnimationEnd 执行，相机动画读到最新帧号）
        this._manualStepObserver = scene.onBeforeRenderObservable.add(() => {
            this._manualStep();
        });

        console.log(`[RealtimeRenderManager] 固定步长慢放模式已启用: ${renderFps} FPS (step=${this._manualStepMs.toFixed(2)}ms)`);
    }

    /**
     * 固定步长步进回调（每渲染帧执行一次）
     * 距上次步进不足 stepMs 时跳过（节流：渲染帧率上限 = renderFps，输出帧率不超过目标）；
     * 达到步进间隔时动画时间只推进固定 1 个 MMD 帧（33.33ms，30fps 基准）——
     * 播放速度 = renderFps/30：renderFps=30 → 1x 正常；renderFps<30 → 慢放（不丢帧）。
     * 设备渲染能力不足时步进间隔自然拉长，动画进一步慢放，画面依然流畅。
     */
    private _manualStep(): void {
        const now = performance.now();
        if (this._lastStepTime > 0 && now - this._lastStepTime < this._manualStepMs) {
            return; // 未到步进时刻（帧率上限节流）：本帧不推进动画（画面保持）
        }
        this._lastStepTime = now;

        const mmdRuntime = this.animationManager.getMmdRuntime();
        if (!mmdRuntime) return;
        const physicsRuntime = PhysicsManager.getInstance().getPhysicsRuntime();

        // 动画推进固定步长：1 个 MMD 帧（30fps 基准 = 33.33ms）。
        // 注意：不能用 _manualStepMs（节流间隔）当步长——那会把 15fps 的 66.67ms
        // 换算成 2 个 MMD 帧/次，动画按 1x 跑完，根本不会慢放。
        const animStepMs = 1000 / 30;

        if (this._isManualStepReze) {
            // 与 OfflineRenderManager 手动步进一致：beforePhysics → stepAll → afterPhysics
            mmdRuntime.beforePhysics(animStepMs);
            this._rezeModule?.RezeMmdPhysics.stepAll(animStepMs / 1000);
            mmdRuntime.afterPhysics();
        } else {
            mmdRuntime.beforePhysics(animStepMs);
            if (physicsRuntime) {
                physicsRuntime.afterAnimations(animStepMs);
            }
            mmdRuntime.afterPhysics();
        }
    }

    /**
     * 退出固定步长慢放模式，恢复引擎 deltaTime 驱动
     */
    private _exitManualStepMode(): void {
        const scene = this.sceneManager.getScene();
        if (this._manualStepObserver) {
            scene.onBeforeRenderObservable.remove(this._manualStepObserver);
            this._manualStepObserver = null;
        }
        if (this._manualStepMs === 0) {
            return;
        }

        const mmdRuntime = this.animationManager.getMmdRuntime();
        if (mmdRuntime) {
            mmdRuntime.register(scene);
        }
        const physicsRuntime = PhysicsManager.getInstance().getPhysicsRuntime();
        if (physicsRuntime) {
            physicsRuntime.register(scene);
        }
        if (this._isManualStepReze && this._rezeModule) {
            this._rezeModule.RezeMmdPhysics.setManualStepMode(false);
        }
        this._rezeModule = null;

        console.log('[RealtimeRenderManager] 固定步长慢放模式已退出');
        this._manualStepMs = 0;
        this._lastStepTime = 0;
        this._isManualStepReze = false;
    }

    /**
     * 后处理产物输出路径：与录制文件同目录，命名「实时渲染MMDDHHMMSS.mp4」。
     * 保留录制结果（MikuPlay录制MMDDHHMMSS.mp4）与处理结果两个文件。
     * @param recordingPath 录制结果路径（由 ScreenRecorderPlugin 生成，如 .../MikuPlay录制0820223030.mp4）
     */
    private _getPostProcessOutputPath(recordingPath: string): string {
        const slashIdx = recordingPath.lastIndexOf('/');
        const dir = slashIdx >= 0 ? recordingPath.substring(0, slashIdx + 1) : '';
        // 提取录制文件名的 MMDDHHMMSS 时间戳（录制命名：MikuPlay录制MMDDHHMMSS.mp4，10 位）
        const match = recordingPath.match(/MikuPlay录制(\d{10})\.mp4$/);
        const timestamp = match
            ? match[1]
            : new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').slice(4, 14);
        return `${dir}实时渲染${timestamp}.mp4`;
    }

    private handleAnimationEnd = async (): Promise<void> => {
        if (!this.isRendering) return;

        const result = await screenRecorderManager.stopRecording();
        this.cleanup();

        if (result.success && result.outputPath) {
            const finalPath = await this._runPostProcess(result.outputPath);
            this.callbacks?.onRenderComplete(finalPath);
        } else {
            this.callbacks?.onRenderError('录制失败');
        }
    };

    /**
     * 录屏后处理：把无声慢放 MP4 与音乐合成为正常速度带音轨视频。
     *
     * 倍速：慢放模式下（renderFps<30）录制视频是慢速的，后处理需倍速到正常速度。
     *   speed = 30 / renderFps（renderFps=15 → speed=2，2 倍速）；
     *   无限制模式或 renderFps≥30 时 speed=1（原速）。
     *   视频轨 PTS 缩放（÷speed），音频本就是正常速度无需倍速。
     *
     * 输出「实时渲染MMDDHHMMSS.mp4」，保留录制结果（MikuPlay录制MMDDHHMMSS.mp4）。
     * 无音乐或非原生平台时跳过，直接返回录制路径。
     * 后处理失败时打印详细原因（含插件可用性诊断），仍保留录制结果。
     */
    private async _runPostProcess(recordingPath: string): Promise<string> {
        const audioPath = videoComposeManager.getMusicFilePath();
        if (!Capacitor.isNativePlatform()) {
            console.warn('[RealtimeRenderManager] 非原生平台，跳过后处理（实时渲染仅原生可用）');
            return recordingPath;
        }
        if (!audioPath) {
            console.warn('[RealtimeRenderManager] 未导入音乐（getMusicFilePath 为空），跳过后处理，保留录制结果');
            return recordingPath;
        }

        // 倍速因子：慢放模式下录制视频帧率 < 30，需倍速到正常速度
        // renderFps=null（无限制）或 ≥30 时 speed=1（原速），<30 时 speed=30/renderFps
        const speed = (this._currentRenderFps !== null
            && this._currentRenderFps > 0
            && this._currentRenderFps < 30)
            ? 30 / this._currentRenderFps
            : 1;

        const outputPath = this._getPostProcessOutputPath(recordingPath);
        console.log('[RealtimeRenderManager] 开始后处理:', { recordingPath, audioPath, outputPath, speed });
        try {
            // 插件可用性诊断：Capacitor 插件未注册时调用会 reject，这里显式捕获并打印
            const result = await VideoPostProcess.process({
                srcPath: recordingPath,
                audioPath,
                outputPath,
                speed
            });
            if (result.success && result.outputPath) {
                console.log('[RealtimeRenderManager] 后处理完成:', result.outputPath);
                return result.outputPath;
            }
            console.warn('[RealtimeRenderManager] 后处理失败:', result.error);
        } catch (error) {
            // 最常见原因：Android APK 未重新构建，VideoPostProcessPlugin 不在包内
            console.error('[RealtimeRenderManager] 后处理异常，保留录制结果:', error,
                '\n→ 若为 "not implemented/plugin 未注册"，请重新构建 Android APK（npm run build:android）');
        }
        return recordingPath;
    }

    public async stopRender(): Promise<void> {
        if (!this.isRendering) return;

        this.shouldStop = true;
        if (this.unsubscribeAnimationEnd) {
            this.unsubscribeAnimationEnd();
            this.unsubscribeAnimationEnd = null;
        }

        await this.animationManager.pauseAnimation();
        const result = await screenRecorderManager.stopRecording();
        this.cleanup();

        if (this.shouldStop) {
            this.callbacks?.onRenderCancelled();
        } else if (result.success && result.outputPath) {
            this.callbacks?.onRenderComplete(result.outputPath);
        } else {
            this.callbacks?.onRenderError('录制失败');
        }
    }

    private hideAllUI(): void {
        const uiSelectors = [
            '.side-panel',
            '.render-ui-panel',
            '.render-ui-overlay',
            '.toast-container',
            '[class*="ui-"]',
            '[class*="UI-"]'
        ];

        this.uiElements = [];
        for (const selector of uiSelectors) {
            const elements = document.querySelectorAll(selector);
            elements.forEach((el) => {
                const htmlEl = el as HTMLElement;
                if (htmlEl.style.display !== 'none') {
                    this.uiElements.push(htmlEl);
                    htmlEl.style.visibility = 'hidden';
                    htmlEl.style.opacity = '0';
                }
            });
        }

        const canvas = document.querySelector('canvas');
        if (canvas) {
            (canvas as HTMLElement).style.zIndex = '1';
        }
    }

    private restoreUI(): void {
        for (const el of this.uiElements) {
            el.style.visibility = '';
            el.style.opacity = '';
        }
        this.uiElements = [];
    }

    private cleanup(): void {
        this.isRendering = false;
        this._exitManualStepMode();
        this.restoreCameraControl();
        this.restoreUI();

        if (this.unsubscribeAnimationEnd) {
            this.unsubscribeAnimationEnd();
            this.unsubscribeAnimationEnd = null;
        }

        if (screenRecorderManager.getIsRecording()) {
            screenRecorderManager.stopRecording().catch(console.error);
        }
    }

    private disableCameraControl(): void {
        if (this.cameraManager) {
            this.cameraManager.disableManualControl();
            console.log('[RealtimeRenderManager] 录制期间已禁用相机控制');
        }
    }

    private restoreCameraControl(): void {
        if (this.cameraManager) {
            this.cameraManager.enableManualControl();
            console.log('[RealtimeRenderManager] 相机控制已恢复');
        }
    }

    public getIsRendering(): boolean {
        return this.isRendering;
    }
}
