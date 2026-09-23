
import { RenderUI, RenderSettings } from '../../UIComponents/RenderUI';
import { RealtimeRenderManager } from './RealtimeRenderManager';
import { OfflineRenderManager } from './OfflineRenderManager';
import { RenderProgressDialog } from '../../UIComponents/RenderProgressDialog';
import { AnimationManager } from '../mmd/AnimationManager';
import { SceneManager } from '../scene/SceneManager';
import { CameraManager } from '../mmd/CameraManager';
import { toast } from '../../UIComponents/shared/Toast';
import { OfflineRender } from '../../plugins/OfflineRender';

export class RenderManager {
    private renderUI: RenderUI;
    private realtimeRenderManager: RealtimeRenderManager | null = null;
    private offlineRenderManager: OfflineRenderManager | null = null;
    private renderProgressDialog: RenderProgressDialog | null = null;
    private cameraManager: CameraManager | null = null;
    private animationManager: AnimationManager | null = null;
    private onStartRenderCallback: ((settings: RenderSettings) => void) | null = null;
    private onRenderCompleteCallback: ((outputPath: string) => void) | null = null;
    private onRenderErrorCallback: ((error: string) => void) | null = null;

    constructor() {
        this.renderUI = new RenderUI();
        this.renderProgressDialog = new RenderProgressDialog();
        this.renderUI.onStartRender((settings: RenderSettings) => {
            this.handleStartRender(settings);
        });
    }



    /**
     * 初始化实时渲染管理器
     */
    public initialize(animationManager: AnimationManager, sceneManager: SceneManager, cameraManager: CameraManager): void {
        this.cameraManager = cameraManager;
        this.animationManager = animationManager;
        this.realtimeRenderManager = new RealtimeRenderManager(animationManager, sceneManager);
        this.realtimeRenderManager.setCameraManager(cameraManager);

        this.offlineRenderManager = new OfflineRenderManager(animationManager, sceneManager);
        this.offlineRenderManager.setCameraManager(cameraManager);

        // 监听 native 层的 renderError 事件（音频校验失败等非致命错误）
        // 使用 Toast 显示但不打断渲染流程
        OfflineRender.addListener('renderError', (data: { error: string }) => {
            if (data?.error) {
                toast.error(data.error, 4000);
            }
        });

        // 监听 native 层的 encodingProgress 事件（VP9 合成进度）
        OfflineRender.addListener('encodingProgress', (data: { currentFrame: number; totalFrames: number }) => {
            if (data?.currentFrame !== undefined && data?.totalFrames !== undefined) {
                this.renderProgressDialog?.updateProgress(data.currentFrame, data.totalFrames);
            }
        });
        
        this.realtimeRenderManager.setCallbacks({
            onRenderStart: () => {
                console.log('[RenderManager] Realtime render started');
            },
            onRenderComplete: (outputPath) => {
                console.log('[RenderManager] Render completed:', outputPath);
                this.showRenderResultToast(true, outputPath);
                this.onRenderCompleteCallback?.(outputPath);
                this.renderUI.close().catch(console.error);
            },
            onRenderError: (error) => {
                console.error('[RenderManager] Render error:', error);
                this.showRenderResultToast(false, error);
                this.onRenderErrorCallback?.(error);
            },
            onRenderCancelled: () => {
                console.log('[RenderManager] Render cancelled');
                this.animationManager?.stopAnimation();
            }
        });

        this.offlineRenderManager.setCallbacks({
            onRenderStart: () => {
                console.log('[RenderManager] Offline render started');
                this.renderProgressDialog?.show();
                this.renderProgressDialog?.setTitle('离线渲染中...');
            },
            onRenderProgress: (currentFrame, totalFrames) => {
                // 预热阶段 currentFrame 为负值，跳过百分比计算
                if (currentFrame >= 0 && totalFrames > 0) {
                    const progress = ((currentFrame / totalFrames) * 100).toFixed(1);
                    console.log(`[RenderManager] Offline render progress: ${progress}% (${currentFrame}/${totalFrames})`);
                } else {
                    console.log(`[RenderManager] Warmup progress: ${-currentFrame}/${totalFrames}`);
                }
                this.renderProgressDialog?.updateProgress(currentFrame, totalFrames);
            },
            onRenderWriting: () => {
                this.renderProgressDialog?.setWritingMode();
            },
            onEncodingProgress: (currentFrame, totalFrames) => {
                // 透明模式：切换到编码模式，进度由 native 端 encodingProgress 事件驱动
                this.renderProgressDialog?.setEncodingMode();
                this.renderProgressDialog?.updateProgress(currentFrame, totalFrames);
            },
            onRenderComplete: (outputPath) => {
                console.log('[RenderManager] Offline render completed:', outputPath);
                this.renderProgressDialog?.hide();
                this.showRenderResultToast(true, outputPath);
                this.onRenderCompleteCallback?.(outputPath);
                this.animationManager?.stopAnimation();
                this.renderUI.close().catch(console.error);
            },
            onRenderError: (error) => {
                console.error('[RenderManager] Offline render error:', error);
                this.renderProgressDialog?.hide();
                this.showRenderResultToast(false, error);
                this.onRenderErrorCallback?.(error);
            },
            onRenderCancelled: () => {
                console.log('[RenderManager] Render cancelled');
                this.animationManager?.stopAnimation();
                this.renderProgressDialog?.hide();
            }
        });

        this.renderProgressDialog?.setCallbacks({
            onCancel: () => {
                this.handleStopRender();
            }
        });
    }

    public onStartRender(callback: (settings: RenderSettings) => void): void {
        this.onStartRenderCallback = callback;
    }

    public onRenderComplete(callback: (outputPath: string) => void): void {
        this.onRenderCompleteCallback = callback;
    }

    public onRenderError(callback: (error: string) => void): void {
        this.onRenderErrorCallback = callback;
    }

    private async handleStartRender(settings: RenderSettings): Promise<void> {
        if (settings.renderMode === 'realtime') {
            if (!this.realtimeRenderManager) {
                this.showRenderResultToast(false, '渲染管理器未初始化');
                return;
            }

            const started = await this.realtimeRenderManager.startRender(settings);
            if (!started) {
                return;
            }
        } else {
            if (!this.offlineRenderManager) {
                this.showRenderResultToast(false, '离线渲染管理器未初始化');
                return;
            }

            const started = await this.offlineRenderManager.startRender(settings);
            if (!started) {
                return;
            }

            if (this.offlineRenderManager.isYuvFallbackActive()) {
                this.renderProgressDialog?.showWarning('GPU 颜色转换不可用，使用 CPU 回退，渲染速度较慢');
            }
        }

        this.onStartRenderCallback?.(settings);
    }

    private async handleStopRender(): Promise<void> {
        if (this.realtimeRenderManager?.getIsRendering()) {
            await this.realtimeRenderManager.stopRender();
        }
        if (this.offlineRenderManager?.getIsRendering()) {
            await this.offlineRenderManager.stopRender();
        }
    }

    /**
     * 显示渲染结果Toast
     */
    private showRenderResultToast(success: boolean, message: string): void {
        // 帧输出模式使用"导出完成/导出失败"
        const isFrameOutput = message.endsWith('.png');
        const title = success
            ? (isFrameOutput ? '导出完成' : '录制完成')
            : (isFrameOutput ? '导出失败' : '录制失败');
        toast.show(`${title}: ${message}`, success ? 'success' : 'error', 3000);
    }

    public async open(): Promise<void> {
        // 打开前同步动画最大帧数，帧范围输入框默认填入 0 和末尾帧
        if (this.animationManager) {
            this.renderUI.setMaxFrames(this.animationManager.getMaxAnimationFrames());
        }
        await this.renderUI.open();
    }

    public async close(): Promise<void> {
        await this.renderUI.close();
    }

    public async toggle(): Promise<void> {
        if (this.renderUI.isOpened()) {
            await this.close();
        } else {
            await this.open();
        }
    }

    public isOpened(): boolean {
        return this.renderUI.isOpened();
    }

    public dispose(): void {
        this.renderUI.dispose();
        this.renderProgressDialog?.dispose();
        this.renderProgressDialog = null;
    }
}
