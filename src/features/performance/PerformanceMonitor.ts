
/**
 * 性能监测器 - 用于监测FPS
 * 使用 requestAnimationFrame 进行轻量级性能监测
 */
export class PerformanceMonitor {
    private isRunning: boolean = false;
    private rafId: number | null = null;
    private lastTime: number = 0;
    private frameCount: number = 0;
    private fps: number = 0;
    private onUpdateCallback: ((fps: number) => void) | null = null;

    /**
     * 开始性能监测
     * @param onUpdate 数据更新回调
     */
    public start(onUpdate: (fps: number) => void): void {
        if (this.isRunning) return;

        this.isRunning = true;
        this.onUpdateCallback = onUpdate;
        this.lastTime = performance.now();
        this.frameCount = 0;
        this.fps = 0;

        this.tick();
    }

    /**
     * 停止性能监测
     */
    public stop(): void {
        this.isRunning = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.onUpdateCallback = null;
    }

    /**
     * 获取当前FPS
     */
    public getFPS(): number {
        return this.fps;
    }

    /**
     * 检查是否正在运行
     */
    public isActive(): boolean {
        return this.isRunning;
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.stop();
    }

    /**
     * 动画帧回调
     */
    private tick = (): void => {
        if (!this.isRunning) return;

        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastTime;
        this.frameCount++;

        // 每500ms更新一次数据，平衡实时性和性能
        if (deltaTime >= 500) {
            // 计算FPS
            this.fps = Math.round((this.frameCount * 1000) / deltaTime);

            // 触发回调
            this.onUpdateCallback?.(this.fps);

            // 重置计数器
            this.lastTime = currentTime;
            this.frameCount = 0;
        }

        this.rafId = requestAnimationFrame(this.tick);
    };
}
