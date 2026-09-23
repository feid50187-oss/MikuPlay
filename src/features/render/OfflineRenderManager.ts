
import { AnimationManager } from '../mmd/AnimationManager';
import { PhysicsManager } from '../mmd/PhysicsManager';
import { PhysicsEngineType } from '../mmd/PhysicsEngineTypes';
import { PhysicsEngineFactory } from '../mmd/PhysicsEngineFactory';
import { SceneManager } from '../scene/SceneManager';
import { OfflineRender } from '../../plugins/OfflineRender';
import { RenderSettings } from '../../UIComponents/RenderUI';
import { CameraManager } from '../mmd/CameraManager';
import { Capacitor } from '@capacitor/core';
import { RenderTargetTexture, Camera } from '@babylonjs/core';
import { videoComposeManager } from '../videoCompose';
import { YUVConverter } from './YUVConverter';
import { showConfirmDialog } from '../../UIComponents/shared/ConfirmDialog';

export interface OfflineRenderCallbacks {
    onRenderStart: () => void;
    onRenderProgress: (currentFrame: number, totalFrames: number) => void;
    onRenderWriting: () => void;
    onEncodingProgress: (currentFrame: number, totalFrames: number) => void;
    onRenderComplete: (outputPath: string) => void;
    onRenderError: (error: string) => void;
    onRenderCancelled: () => void;
}

/**
 * 渲染分辨率像素上限（宽×高乘积），须与服务端 FrameServer.kMaxRenderPixels 一致。
 * 超过即拒绝渲染：单帧像素超限时 NV12 帧会超过 uWS maxPayloadLength，
 * 触发 1006 "Received too big message" 关闭连接。
 */
const MAX_RENDER_PIXELS = 4096 * 4096;

/**
 * 单帧 WebSocket 消息上限（字节），须与服务端 uWS maxPayloadLength 一致。
 * 取 RGBA（4 bytes/px）和 NV12（1.5 bytes/px）中的较大者，确保两种管线都不会超限。
 */
const MAX_FRAME_PAYLOAD_BYTES = Math.ceil(MAX_RENDER_PIXELS * 4) + 4;

/**
 * 帧缓冲环形池：预分配 N 个 ArrayBuffer，循环使用
 * 池中每个 buffer 布局: [4 字节帧索引][帧数据]
 * 4 字节头由 sendBatch 写入，buffer 池本身不感知帧内容
 */
class FrameBufferPool {
    private readonly buffers: Uint8Array[];
    private readonly headerView: DataView[];
    private inUse: Set<Uint8Array> = new Set();
    private readonly _frameByteLength: number;
    private readonly _totalByteLength: number;

    constructor(frameByteLength: number, poolSize: number) {
        this._frameByteLength = frameByteLength;
        this._totalByteLength = 4 + frameByteLength;
        this.buffers = new Array(poolSize);
        this.headerView = new Array(poolSize);
        for (let i = 0; i < poolSize; i++) {
            const ab = new ArrayBuffer(this._totalByteLength);
            this.buffers[i] = new Uint8Array(ab);
            this.headerView[i] = new DataView(ab, 0, 4);
        }
    }

    /** 获取一个空闲 buffer，没有时同步等待（实际池容量足够覆盖 batch+飞行） */
    acquire(): { buffer: Uint8Array; header: DataView } {
        for (let i = 0; i < this.buffers.length; i++) {
            const buf = this.buffers[i];
            if (!this.inUse.has(buf)) {
                this.inUse.add(buf);
                return { buffer: buf, header: this.headerView[i] };
            }
        }
        throw new Error('FrameBufferPool 容量耗尽，请检查 sendBatch 释放逻辑');
    }

    release(buffer: Uint8Array): void {
        this.inUse.delete(buffer);
    }

    /** 获取池容量（仅用于诊断） */
    get inUseCount(): number { return this.inUse.size; }
    get size(): number { return this.buffers.length; }
    get frameByteLength(): number { return this._frameByteLength; }
}

/**
 * WebSocket帧传输客户端
 */
class FrameWebSocketClient {
    private ws: WebSocket | null = null;
    private port: number;
    private pendingRequests: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();
    private requestId = 0;
    private isConnected = false;
    private connectPromise: Promise<void> | null = null;

    /**
     * 信用窗口（= createSession 下发的 queueSize）。
     * 客户端保证 sentHigh - ackHigh < window，native 队列因此永不溢出、永不拒帧。
     */
    private readonly windowSize: number;
    /** 已发送的最高帧号（帧按序发送，单调递增） */
    private sentHigh = -1;
    /** native 已确认消费（编码器接收）的最高帧号，累积 ACK */
    private ackHigh = -1;

    constructor(port: number, windowSize: number) {
        this.port = port;
        this.windowSize = windowSize;
    }

    /**
     * 等待 native 确认所有帧已被编码器消费（finalize 前置条件）。
     * 连接断开时抛错，避免永久等待。
     */
    public async waitAllAcked(totalFrames: number): Promise<void> {
        while (this.ackHigh < totalFrames - 1) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket连接已断开，等待帧确认失败');
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    /**
     * 连接WebSocket服务器
     */
    public async connect(): Promise<void> {
        if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.connectPromise = new Promise((resolve, reject) => {
            const url = `ws://localhost:${this.port}`;  //8765端口
            this.ws = new WebSocket(url);
            this.ws.binaryType = 'arraybuffer';

            this.ws.onopen = () => {
                this.isConnected = true;
                this.connectPromise = null;
                console.log('[FrameWebSocketClient] 已连接到服务器:', url);
                resolve();
            };

            this.ws.onclose = (event) => {
                this.isConnected = false;
                this.connectPromise = null;
                // 拒绝所有挂起请求，避免 finalize 等命令永久等待
                for (const [, pending] of this.pendingRequests) {
                    pending.reject(new Error('WebSocket连接关闭'));
                }
                this.pendingRequests.clear();
                console.log('[FrameWebSocketClient] 连接关闭:', event.code, event.reason);
            };

            this.ws.onerror = (error) => {
                this.isConnected = false;
                this.connectPromise = null;
                console.error('[FrameWebSocketClient] 连接错误:', error);
                reject(new Error('WebSocket连接失败'));
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
        });

        return this.connectPromise;
    }

    /**
     * 处理接收到的消息
     */
    private handleMessage(data: ArrayBuffer | string): void {
        if (typeof data === 'string') {
            try {
                const msg = JSON.parse(data);
                const type = msg.type;

                // 处理累积 ACK：native 已消费 ≤index 的所有帧，释放对应信用
                if (type === 'ack') {
                    const index = Number(msg.index);
                    if (!Number.isNaN(index) && index > this.ackHigh) {
                        this.ackHigh = index;
                    }
                    return;
                }

                // 处理错误消息
                if (type === 'error') {
                    console.error('[FrameWebSocketClient] 服务端错误:', msg.message);
                    return;
                }

                // 处理带requestId的响应
                const rid = String(msg.requestId);
                if (rid && this.pendingRequests.has(rid)) {
                    const pending = this.pendingRequests.get(rid)!;
                    this.pendingRequests.delete(rid);
                    if (msg.success === false && msg.error) {
                        pending.reject(new Error(msg.error));
                    } else {
                        pending.resolve(msg);
                    }
                }
            } catch (e) {
                console.error('[FrameWebSocketClient] 解析消息失败:', e);
            }
        }
    }

    /**
     * 发送控制命令并等待响应
     */
    public async sendCommand(type: string, params?: any): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket未连接');
        }

        const requestId = ++this.requestId;
        const message = {
            type,
            requestId,
            ...params
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId.toString(), { resolve, reject });
            this.ws!.send(JSON.stringify(message));

            // 超时处理（暂时禁用，编码较慢时会导致误判）
            // setTimeout(() => {
            //     if (this.pendingRequests.has(requestId.toString())) {
            //         this.pendingRequests.delete(requestId.toString());
            //         reject(new Error('请求超时'));
            //     }
            // }, 30000);
        });
    }

    /**
     * 发送批量帧数据（二进制）- fire-and-forget模式，不等待响应
     * frame.data 已预留 4 字节帧索引头（由 readFrame 分配），直接写入并发送，零额外分配
     * @param frameBufferPool 帧缓冲池，发送后释放 buffer
     */
    public async sendBatch(
        frames: { index: number; data: Uint8Array }[],
        width: number,
        height: number,
        frameBufferPool?: FrameBufferPool
    ): Promise<any> {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket未连接');
        }

        // 根据实际帧数据大小计算（RGBA=4 bytes/px, NV12=1.5 bytes/px）
        const frameBytes = frames.length > 0
            ? frames[0].data.byteLength
            : width * height * 1.5 + 4;
        // 根据分辨率动态计算 Chromium 缓冲队列上限
        // 目标 ~18MB，最小 2 帧防止小分辨率积压过多，最大 10 帧防止大分辨率 OOM
        const MAX_CHROME_BUFFER_MB = 18;
        const maxChromeFrames = Math.max(2, Math.min(10,
            Math.floor(MAX_CHROME_BUFFER_MB * 1024 * 1024 / frameBytes)));
        const MAX_BUFFERED_BYTES = maxChromeFrames * frameBytes;

        for (const frame of frames) {
            // 连接状态检查：uWS 1006 关闭后 readyState 即变为 CLOSED。
            // 必须在尝试发送前检测，避免连接断开后仍逐帧"保存"并静默失败
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket连接已断开，渲染中止');
            }

            // 帧尺寸校验：超过服务端 maxPayloadLength 会触发 uWS 1006 关闭连接，
            // 在发送前拒绝并给出明确错误
            if (frame.data.byteLength > MAX_FRAME_PAYLOAD_BYTES) {
                const mb = (frame.data.byteLength / 1024 / 1024).toFixed(1);
                throw new Error(
                    `单帧尺寸过大（${mb}MB），超过 4096×4096 像素上限，请降低分辨率`
                );
            }

            // 帧数据前 4 字节已由 readFrame 预留在 buffer 中，直接写入大端序帧索引
            const data = frame.data;
            data[0] = (frame.index >> 24) & 0xFF;
            data[1] = (frame.index >> 16) & 0xFF;
            data[2] = (frame.index >> 8) & 0xFF;
            data[3] = frame.index & 0xFF;

            // 信用窗口背压：native 未确认消费的帧数达到窗口上限时停止发送。
            // 这是 native 队列"永不溢出、永不拒帧"的发送侧硬保证。
            while (this.sentHigh - this.ackHigh >= this.windowSize) {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    throw new Error('WebSocket连接已断开，渲染中止');
                }
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            // 背压等待：如果 Chromium 发送队列积压过多，主动阻塞
            while (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
                await new Promise(resolve => setTimeout(resolve, 30));
            }

            try {
                this.ws.send(new Uint8Array(data.buffer));
                this.sentHigh = Math.max(this.sentHigh, frame.index);
            } finally {
                if (frameBufferPool) {
                    frameBufferPool.release(data);
                }
            }
        }

        return { queued: frames.length };
    }

    /**
     * 关闭连接
     */
    public close(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.pendingRequests.clear();
    }

    /**
     * 检查是否已连接
     */
    public getIsConnected(): boolean {
        return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
    }
}

export class OfflineRenderManager {
    private animationManager: AnimationManager;
    private sceneManager: SceneManager;
    private cameraManager: CameraManager | null = null;
    private _prevClearColor: { r: number; g: number; b: number; a: number } | null = null;
    private isRendering = false;
    private shouldStop = false;
    private callbacks: OfflineRenderCallbacks | null = null;
    private targetFrameRate = 30;
    private totalFrames = 0;
    private currentFrame = 0;
    private uiElements: HTMLElement[] = [];
    private serverPort = 8765;
    private renderTarget: RenderTargetTexture | null = null;
    private offscreenCamera: Camera | null = null;
    private originalCameraAspectRatios: Map<Camera, number> = new Map();
    private originalCanvasSize: { width: number; height: number } | null = null;

    private batchSize = 5;
    private frameBuffer: { index: number; data: Uint8Array }[] = [];

    private yuvConverter: YUVConverter | null = null;
    private wsClient: FrameWebSocketClient | null = null;
    private frameBufferPool: FrameBufferPool | null = null;
    private _yuvFallbackActive = false;
    private _transparentOutput = false;
    private _frameOutputMode = false;
    /** 帧范围起始（MMD 帧基准 30fps，含）；物理仍从 0 帧预热步进 */
    private _rangeStartFrame = 0;

    /**
     * 根据帧大小动态计算 native 环形缓冲队列长度（基于内存预算）
     * 与 Chrome 队列和 FrameBufferPool 协同控制总管道内存
     */
    private calculateQueueSize(width: number, height: number): number {
        let bytesPerPixel: number;
        if (this._frameOutputMode) {
            bytesPerPixel = 4; // RGBA
        } else if (this._transparentOutput) {
            bytesPerPixel = 2.5; // NV12A
        } else {
            bytesPerPixel = 1.5; // NV12
        }
        const frameBytes = Math.ceil(width * height * bytesPerPixel) + 4;
        const targetQueueMemoryBytes = 18 * 1024 * 1024;
        return Math.max(2, Math.min(10,
            Math.floor(targetQueueMemoryBytes / frameBytes)));
    }

    /**
     * 根据分辨率动态计算帧缓冲池容量（基于内存预算而非批量大小）
     * 目标 21MB，最小 3 帧防止频繁阻塞，最大 10 帧防止 4K OOM
     */
    private calculatePoolSize(width: number, height: number): number {
        let bytesPerPixel: number;
        if (this._frameOutputMode) {
            bytesPerPixel = 4; // RGBA
        } else if (this._transparentOutput) {
            bytesPerPixel = 2.5; // NV12A
        } else {
            bytesPerPixel = 1.5; // NV12
        }
        const frameBytes = Math.ceil(width * height * bytesPerPixel) + 4;
        const targetPoolMemoryBytes = 21 * 1024 * 1024;
        return Math.max(3, Math.min(10,
            Math.floor(targetPoolMemoryBytes / frameBytes)));
    }

    /**
     * 根据分辨率自动计算批量大小
     */
    private calculateBatchSize(width: number, height: number): number {
        const pixelCount = width * height;
        let bytesPerPixel: number;
        if (this._frameOutputMode) {
            bytesPerPixel = 4; // RGBA
        } else if (this._transparentOutput) {
            bytesPerPixel = 2.5; // NV12A
        } else {
            bytesPerPixel = 1.5; // NV12
        }
        const frameSizeMB = (pixelCount * bytesPerPixel) / (1024 * 1024);

        // 目标：每批数据不超过 6MB，降低峰值内存压力
        const maxBatchMB = 6;
        const batchSize = Math.max(1, Math.floor(maxBatchMB / frameSizeMB));

        return Math.min(batchSize, 3); // 上限 3 帧
    }

    constructor(animationManager: AnimationManager, sceneManager: SceneManager) {
        this.animationManager = animationManager;
        this.sceneManager = sceneManager;
    }

    public setCameraManager(cameraManager: CameraManager): void {
        this.cameraManager = cameraManager;
    }

    public setCallbacks(callbacks: OfflineRenderCallbacks): void {
        this.callbacks = callbacks;
    }

    public hasAnimation(): boolean {
        const hasAnim = this.animationManager.hasAnyAnimation();
        console.log('[OfflineRenderManager] hasAnimation check:', hasAnim);
        return hasAnim;
    }

    public getMaxAnimationFrames(): number {
        return this.animationManager.getMaxAnimationFrames();
    }

    private setupCamera(): void {
        // 无需切换相机，MmdCamera 已是唯一相机
        // 离线渲染在后台进行，不需要处理用户交互
    }

    /**
     * 获取离线渲染使用的相机
     * - 跟随相机启用时返回 FollowCamera（scene.activeCamera），使离线渲染跟随模型的视角
     * - 否则返回 MmdCamera（主相机）
     */
    private getRenderCamera(): Camera | null {
        const activeCamera = this.sceneManager?.getScene()?.activeCamera;
        if (activeCamera) {
            return activeCamera;
        }
        return this.cameraManager?.getMainCamera() ?? null;
    }

    private setupCameraAspectRatio(width: number, height: number): void {
        const camera = this.getRenderCamera();
        if (!camera) return;

        const aspectRatio = width / height;
        
        this.originalCameraAspectRatios.set(camera, (camera as any).aspectRatio ?? 1);
        
        (camera as any).aspectRatio = aspectRatio;
        
        camera.getProjectionMatrix(true);
        
    }

    //用于恢复相机原始宽高比
    private restoreCameraAspectRatio(): void {
        const camera = this.getRenderCamera();
        if (!camera) return;

        const originalRatio = this.originalCameraAspectRatios.get(camera);
        if (originalRatio !== undefined) {
            (camera as any).aspectRatio = originalRatio;
            camera.getProjectionMatrix(true);
        }
        
        this.originalCameraAspectRatios.clear();
    }

    //开始渲染
    public async startRender(settings: RenderSettings): Promise<boolean> {
        if (this.isRendering) {
            console.warn('[OfflineRenderManager] Render already in progress');
            return false;
        }

        // 渲染前自动保存工程
        try {
            const { autoSaveService } = await import('../project/AutoSaveService');
            await autoSaveService.saveBeforeRender();
        } catch (e) {
            console.warn('[OfflineRenderManager] 渲染前自动保存失败:', e);
        }

        // 帧输出模式：允许无动画时渲染静态模型，不拦截
        const isFrameOutput = settings.renderMode === 'frame';
        if (!this.hasAnimation() && !isFrameOutput) {
            this.callbacks?.onRenderError('没有MMD动画，无法开始渲染');
            return false;
        }

        if (!Capacitor.isNativePlatform()) {
            this.callbacks?.onRenderError('离线渲染仅支持原生平台');
            return false;
        }

        // 解析渲染帧范围（仅离线渲染模式；MMD 帧基准 30fps，起止均含）
        const maxAnimationFrames = this.getMaxAnimationFrames();
        let rangeStart = 0;
        let rangeEnd = maxAnimationFrames;
        if (settings.renderMode === 'offline' && settings.frameRange) {
            rangeStart = Math.floor(settings.frameRange.start ?? 0);
            rangeEnd = Math.floor(settings.frameRange.end ?? maxAnimationFrames);
            if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) ||
                rangeStart < 0 || rangeEnd < rangeStart || rangeEnd > maxAnimationFrames) {
                this.callbacks?.onRenderError(
                    `帧范围无效：${rangeStart} ~ ${rangeEnd}（有效范围 0 ~ ${maxAnimationFrames}）`
                );
                return false;
            }
        }
        this._rangeStartFrame = rangeStart;

        // 离线渲染 + 透明背景：弹窗警告磁盘空间消耗
        const isOfflineTransparent = settings.renderMode === 'offline' && settings.transparentOutput;
        if (isOfflineTransparent) {
            const width = settings.resolution.width || 1920;
            const height = settings.resolution.height || 1080;
            const mmdFrameRate = 30;
            const totalFrames = Math.floor((rangeEnd - rangeStart) * ((settings.frameRate || 30) / mmdFrameRate)) + 1;
            const totalDiskMB = Math.ceil(width * height * 2.5 * totalFrames / (1024 * 1024));

            const confirmed = await showConfirmDialog({
                title: '磁盘空间提醒',
                message: `透明背景渲染将产生中间文件，预计消耗约 ${totalDiskMB} MB 磁盘空间（完成后自动清理）。请确认空间充足后继续。`,
                confirmText: '开始渲染',
                cancelText: '取消'
            });

            if (!confirmed) {
                console.log('[OfflineRenderManager] 用户取消透明背景离线渲染');
                return false;
            }
        }

        this.isRendering = true; // 标记为正在渲染
        this.shouldStop = false;
        this.targetFrameRate = settings.frameRate;
        this.frameBuffer = [];

        const width = settings.resolution.width || 1920;
        const height = settings.resolution.height || 1080;

        // 分辨率上限校验：单帧像素（宽×高）超过 4096×4096 时，帧数据会超过
        // 服务端 maxPayloadLength，触发 uWS 1006 "Received too big message" 关闭连接。
        // 透明输出模式使用 RGBA（4 bytes/px），数据量更大。
        // 必须在开始渲染前拒绝，避免渲染到一半连接断开、前端却无错误提示。
        if (width * height > MAX_RENDER_PIXELS) {
            const bytesPerPixel = (settings.transparentOutput || settings.renderMode === 'frame') ? 4 : 1.5;
            const framePayloadBytes = Math.ceil(width * height * bytesPerPixel) + 4;
            console.error(`[OfflineRenderManager] 分辨率超限: ${width}x${height} 像素=${width * height} > ${MAX_RENDER_PIXELS}`);
            this.isRendering = false;
            this.callbacks?.onRenderError(
                `分辨率过高：${width}×${height}（单帧约 ${(framePayloadBytes / 1024 / 1024).toFixed(1)}MB）` +
                `超过 4096×4096 像素上限，请降低分辨率`
            );
            return false;
        }

        // 自适应batchSize
        this.batchSize = this.calculateBatchSize(width, height);

        // 透明输出模式：使用"NV12 实时 MediaCodec + Alpha 磁盘保存 + libvpx VP9 后合成"方案，
        // 不依赖 MediaCodec Alpha 编码能力，因此跳过 MediaCodec Alpha 检查。
        this._transparentOutput = settings.transparentOutput ?? false;
        this._frameOutputMode = settings.renderMode === 'frame';

        if (this._frameOutputMode) {
            console.log('[OfflineRenderManager] 帧输出模式: 单帧 RGBA → PNG 管线');
            // 帧输出模式下透明背景开关：启用时场景以 alpha=0 清除，使 PNG 真正带透明通道
            if (this._transparentOutput) {
                const scene = this.sceneManager.getScene();
                const c = scene.clearColor;
                this._prevClearColor = { r: c.r, g: c.g, b: c.b, a: c.a };
                this.sceneManager.setTransparentBackground(true);
            }
        } else if (this._transparentOutput) {
            console.log('[OfflineRenderManager] 透明输出模式: NV12A 管线 (NV12 实时编码 + Alpha 后合成 libvpx VP9)');
            // 保存当前 clearColor，并让 scene 以 alpha=0 清除，使背景像素真透明
            const scene = this.sceneManager.getScene();
            const c = scene.clearColor;
            this._prevClearColor = { r: c.r, g: c.g, b: c.b, a: c.a };
            this.sceneManager.setTransparentBackground(true);
        }

        // 自动计算队列长度
        const queueSize = this.calculateQueueSize(width, height);

        try {
            const serverResult = await OfflineRender.startServer({
                workerCount: settings.workerCount ?? 1,
                queueSize: queueSize
            });
            if (!serverResult.success || !serverResult.port) {
                throw new Error('无法启动WebSocket服务器');
            }
            this.serverPort = serverResult.port;

            // 创建WebSocket客户端并连接（queueSize 同时作为客户端信用窗口大小）
            this.wsClient = new FrameWebSocketClient(this.serverPort, queueSize);
            await this.wsClient.connect();

            console.log('[OfflineRenderManager] WebSocket服务器已启动，端口:', this.serverPort,
                '工作线程:', settings.workerCount ?? 1,
                '队列长度:', queueSize, '(自动)',
                '逐帧发送模式');

            if (this._frameOutputMode) {
                this.totalFrames = 1;
                this._rangeStartFrame = 0;
            } else {
                const mmdFrameRate = 30;
                // 帧范围：第 j 个输出帧对应 MMD 帧时间 rangeStart + (j / targetFrameRate) * 30
                // 起止均含：rangeStart=0/rangeEnd=末尾 时比旧行为恰好多渲染末尾 1 帧
                this.totalFrames = Math.floor((rangeEnd - this._rangeStartFrame) * (this.targetFrameRate / mmdFrameRate)) + 1;
            }
            this.currentFrame = 0;

            const scene = this.sceneManager.getScene();
            const engine = scene.getEngine();
            const canvas = engine.getRenderingCanvas();
            if (canvas) {
                this.originalCanvasSize = {
                    width: canvas.width,
                    height: canvas.height
                };
            }

            this.sceneManager.pauseScreenRender();
            this.setupCamera();
            this.setupOffscreenRender(settings);
            this.hideAllUI();

            this.callbacks?.onRenderStart();

            if (this._frameOutputMode) {
                await this.renderFrameOutput(settings);
            } else {
                await this.renderLoop(settings);
            }

            return true;
        } catch (error) {
            console.error('[OfflineRenderManager] Render error:', error);
            await this.stopWebSocketServer();
            this.cleanup();
            this.callbacks?.onRenderError(error instanceof Error ? error.message : '渲染失败');
            return false;
        }
    }

    public async stopRender(): Promise<void> {
        this.shouldStop = true;
    }

    //设置离屏渲染
    private setupOffscreenRender(settings: RenderSettings): void {
        const scene = this.sceneManager.getScene();
        const width = settings.resolution.width || 1920;
        const height = settings.resolution.height || 1080;

        // 先确定离屏渲染相机：跟随相机启用时使用 FollowCamera，否则使用 MmdCamera。
        // 须在 setupCameraAspectRatio 之前设置，使宽高比应用到正确的相机。
        this.offscreenCamera = this.getRenderCamera();

        this.setupCameraAspectRatio(width, height);

        this.renderTarget = new RenderTargetTexture(
            "offlineRenderTarget",
            { width, height },
            scene,
            {
                generateMipMaps: false, // 禁用Mipmap生成
                doNotChangeAspectRatio: false,  // 不改变宽高比
                // TEXTURETYPE_UNSIGNED_BYTE(0) + TEXTUREFORMAT_RGBA(5)
                // 显式要求 RGBA8 带 Alpha 位，保证 clearColor.a=0 真正生效
                type: 0,
                format: 5,
                isCube: false,  // 非立方体贴图
                samplingMode: 0, // 最近邻采样
                generateDepthBuffer: true, // 生成深度缓冲区
                isMulti: false, // 不使用多采样
                delayAllocation: false, // 不延迟分配内存
                samples: 0, // 不使用多采样
                noColorAttachment: false, // 不使用颜色附件
                useSRGBBuffer: false // 不使用SRGB缓冲区
            }
        );

        // 使用已确定的离屏渲染相机（跟随相机或 MmdCamera）
        if (this.offscreenCamera) {
            this.renderTarget.activeCamera = this.offscreenCamera;
        }

        // 添加场景中的所有网格到离屏渲染目标（未来也许可以优化）
        scene.meshes.forEach(mesh => {
            this.renderTarget?.renderList?.push(mesh);
        });

        // 设置离屏渲染相机的输出渲染目标为离屏渲染目标
        if (this.offscreenCamera) {
            this.offscreenCamera.outputRenderTarget = this.renderTarget;
        }

        // 初始化 YUV 转换器（帧输出模式跳过，直接读取 RGBA）
        const engine = scene.getEngine() as any;
        const gl = engine._gl as WebGL2RenderingContext;
        this._yuvFallbackActive = false;

        if (this._frameOutputMode) {
            // 帧输出模式：不使用 YUVConverter，直接读取 RGBA
            console.log('[OfflineRenderManager] 帧输出模式：跳过 YUV 转换器，使用 RGBA 直接读取');
        } else if (gl) {
            try {
                this.yuvConverter = new YUVConverter(gl);
                this.yuvConverter.setup(width, height, /* withAlpha */ this._transparentOutput);
                console.log('[OfflineRenderManager] YUV 转换器已初始化, 输出纹理:', width / 4 | 0, 'x', height * 1.5 | 0,
                    this._transparentOutput ? ', 附加 Alpha 平面 (NV12A 管线)' : ' (NV12 管线)');
            } catch (e) {
                console.warn('[OfflineRenderManager] YUV 转换器初始化失败:', e);
                this.yuvConverter = null;
                this._yuvFallbackActive = true;
            }
        }

        // 初始化帧缓冲池（基于内存预算动态计算容量）
        let frameByteLength: number;
        if (this._frameOutputMode) {
            frameByteLength = width * height * 4; // RGBA = 4 bytes/px
        } else if (this._transparentOutput) {
            const yuvSize = Math.ceil(width * height * 1.5);
            const alphaSize = width * height;
            frameByteLength = yuvSize + alphaSize; // NV12A
        } else {
            frameByteLength = Math.ceil(width * height * 1.5); // NV12
        }
        const poolSize = this.calculatePoolSize(width, height);
        this.frameBufferPool = new FrameBufferPool(frameByteLength, poolSize);
        console.log('[OfflineRenderManager] FrameBufferPool 已初始化, 容量:', this.frameBufferPool.size,
            '单帧:', (this.frameBufferPool.frameByteLength / 1024 / 1024).toFixed(2), 'MB',
            this._frameOutputMode ? '(RGBA)' : this._transparentOutput ? '(NV12A)' : '(NV12)');

        console.log('[OfflineRenderManager] 离屏渲染目标已创建:', width, 'x', height);
    }

    private refreshOffscreenRender(settings: RenderSettings): void {
        const scene = this.sceneManager.getScene();
        const width = settings.resolution.width || 1920;
        const height = settings.resolution.height || 1080;

        if (this.renderTarget) {
            this.renderTarget.resize({ width, height });
        }

        this.setupCameraAspectRatio(width, height);

        if (this.offscreenCamera) {
            this.offscreenCamera.viewport.width = 1;
            this.offscreenCamera.viewport.height = 1;
            this.offscreenCamera.getProjectionMatrix(true);
        }

        const engine = scene.getEngine();
        const canvas = engine.getRenderingCanvas();
        if (canvas) {
            canvas.width = width;
            canvas.height = height;
            engine.resize();
        }

        console.log('[OfflineRenderManager] 离屏画布已刷新:', width, 'x', height);
    }

    /**
     * 检查当前是否使用 RezePhysics 引擎
     */
    private _isRezePhysics(): boolean {
        return PhysicsEngineFactory.getInstance().currentType === PhysicsEngineType.RezePhysics;
    }

    // 离屏渲染循环
    // 每帧刷新离屏渲染目标，然后渲染离屏渲染相机
    private async renderLoop(settings: RenderSettings): Promise<void> {
        this.refreshOffscreenRender(settings);

        const scene = this.sceneManager.getScene();
        const mmdRuntime = this.animationManager.getMmdRuntime();
        const physicsRuntime = PhysicsManager.getInstance().getPhysicsRuntime();

        if (!mmdRuntime) {
            throw new Error('MMD运行时未初始化');
        }

        // 检查是否使用 RezePhysics
        const isReze = this._isRezePhysics();

        mmdRuntime.unregister(scene);
        if (physicsRuntime) {
            physicsRuntime.unregister();
        }

        // RezePhysics 模式：进入手动步进模式，暂停 onBeforeRenderObservable 驱动
        if (isReze) {
            const { RezeMmdPhysics } = await import('../mmd/physics/RezeMmdPhysics');
            RezeMmdPhysics.setManualStepMode(true);
        }

        const width = settings.resolution.width || 1920;
        const height = settings.resolution.height || 1080;

        // 获取输出路径和音频路径
        const outputPath = await this.getOutputPath();
        const audioPath = this.getAudioPath();

        const mmdFrameRate = 30;

        // 1. 初始化渲染会话并启动MediaCodec（携带视频参数）
        await this.initRenderSession({
            width,
            height,
            frameRate: this.targetFrameRate,
            bitrate: settings.bitrate,
            frameCount: this.totalFrames,
            outputPath,
            audioPath,
            // 帧范围渲染：音频从视频起始时刻开始混流（native 跳过前缀 PCM，保持音画同步）
            audioStartUs: Math.floor(this._rangeStartFrame / mmdFrameRate * 1000000),
            forceColorFormat: settings.forceColorFix ? 'i420' : 'auto',
            pixelFormat: this._transparentOutput ? 'nv12a' : 'nv12',
            skipAudio: this._transparentOutput // 透明模式：MediaCodec 编码无声视频，后续由 libvpx 后合成输出
        });

        console.log('[OfflineRenderManager] 开始离屏渲染循环, 总帧数:', this.totalFrames,
            '帧率:', this.targetFrameRate, '帧范围:', this._rangeStartFrame, '~',
            this._rangeStartFrame + (this.totalFrames - 1) * (mmdFrameRate / this.targetFrameRate),
            '输出:', outputPath);

        //计算固定时间步长
        const fixedDeltaMs = 1000 / mmdFrameRate;

        // 渲染单帧：物理步进已将模型推进至正确的帧时间，无需重求值动画
        const renderFrame = (renderTime: number): void => {
            // 在渲染前清除渲染目标，避免有插值渲染时的拖影问题
            if (this.renderTarget) {
                const engine = scene.getEngine();
                const internalTexture = this.renderTarget.renderTarget;

                if (internalTexture) {
                    // 绑定渲染目标并清除
                    engine.bindFramebuffer(internalTexture, 0, undefined, undefined, true);
                    engine.clear(scene.clearColor, true, true, false);
                }
            }

            if (this.cameraManager) {
                this.cameraManager.updateAnimationForRender(renderTime);
            }

            // 不强制 computeWorldMatrix：由 Babylon.js 脏标记系统按需自动计算
            // （MMD runtime 已在 beforePhysics 中更新骨骼矩阵，scene.render 会自动级联）

            // 手动以固定时间步长更新粒子系统，与物理/MMD动画保持一致
            const fixedParticleDeltaTime = 1000 / 30; // mmdFrameRate = 30
            const particleAnimationRatio = fixedParticleDeltaTime * (60.0 / 1000.0);

            scene.particleSystems.forEach(ps => {
                if (ps.isStarted() && !(ps as any).isAnimationStopped) {
                    (scene as any)._animationRatio = particleAnimationRatio;
                    ps.animate();
                }
            });

            // 传入 ignoreAnimations = true，阻止 scene.render() 再次执行粒子动画
            scene.render(true, true);
        };

        // 提前导入 RezeMmdPhysics（预热和渲染循环共用）
        const RezePhysicsModule = isReze ? await import('../mmd/physics/RezeMmdPhysics') : null;

        // 物理预热优化：seek 到起始帧前 60 帧（不足则从 0 开始），重置物理后步进预热。
        // MMD Runtime 的 autoPhysicsInitialization 在 seek 跨距 > 60 帧时会自动标记
        // 所有模型为物理重置状态，配合 initializeAllMmdModelsPhysics 确保物理从头开始。
        // 60 帧（30fps 下 2 秒）足够布料/头发物理稳定，避免全量 0~5000+ 帧的长等待。
        const WARMUP_FRAMES = 60;
        const warmupFrames = Math.min(WARMUP_FRAMES, this._rangeStartFrame);
        const seekTarget = Math.max(0, this._rangeStartFrame - warmupFrames);

        mmdRuntime.seekAnimation(seekTarget, true);
        mmdRuntime.initializeAllMmdModelsPhysics(true);

        if (mmdRuntime.isAnimationPlaying === false) {
            (mmdRuntime as any)._animationPaused = false;
        }

        // 执行物理预热：步进 warmupFrames 帧
        // 使用 1.0 MMD 帧步长（30fps），与物理引擎原生步长一致
        const warmupStepMs = 1.0 * fixedDeltaMs;

        // 预热进度回调（复用 onRenderProgress，用负值 currentFrame 标识预热阶段）
        const reportWarmupProgress = (w: number) => {
            this.callbacks?.onRenderProgress(-w, warmupFrames);
        };

        for (let w = 0; w < warmupFrames; w++) {
            if (this.shouldStop) {
                // 取消时同样需要清理
                if (RezePhysicsModule) {
                    RezePhysicsModule.RezeMmdPhysics.setManualStepMode(false);
                }
                mmdRuntime.register(scene);
                if (physicsRuntime) {
                    physicsRuntime.register(scene);
                }
                this.frameBuffer = [];
                await this.stopWebSocketServer();
                this.cleanup();
                this.callbacks?.onRenderCancelled();
                return;
            }

            if (isReze) {
                mmdRuntime.beforePhysics(warmupStepMs);
                RezePhysicsModule!.RezeMmdPhysics.stepAll(warmupStepMs / 1000);
                mmdRuntime.afterPhysics();
            } else {
                mmdRuntime.beforePhysics(warmupStepMs);
                if (physicsRuntime) {
                    physicsRuntime.afterAnimations(warmupStepMs);
                }
                mmdRuntime.afterPhysics();
            }

            if (w % 10 === 0 || w === warmupFrames - 1) {
                reportWarmupProgress(w + 1);
            }
        }

        console.log('[OfflineRenderManager] 物理预热完成:', warmupFrames, '帧, seekTarget:', seekTarget);

        // 预热完成后，currentMmdFrameTime 应约等于 seekTarget + warmupFrames = rangeStartFrame
        let previousMmdFrameTime = seekTarget + warmupFrames;
        let currentMmdFrameTime = mmdRuntime.currentFrameTime;

        //手动渲染循环，逐帧更新MMD动画和物理模拟
        for (let i = 0; i < this.totalFrames; i++) {
            if (this.shouldStop) {
                // 恢复物理引擎的正常运行模式
                if (RezePhysicsModule) {
                    RezePhysicsModule.RezeMmdPhysics.setManualStepMode(false);
                }
                mmdRuntime.register(scene);
                if (physicsRuntime) {
                    physicsRuntime.register(scene);
                }
                // 取消时清空帧缓冲，跳过发送和清理往返
                this.frameBuffer = [];
                await this.stopWebSocketServer();
                this.cleanup();
                this.callbacks?.onRenderCancelled();
                return;
            }

            // 流控由发送侧的信用窗口负责（sendBatch 内 sentHigh - ackHigh >= window 时自动阻塞），
            // 渲染循环无需感知 native 队列状态，直接逐帧推进即可。

            // 帧范围渲染：第 i 个输出帧对应 MMD 帧时间 rangeStart + (i / targetFrameRate) * 30。
            // 起始帧之前不渲染，但下方物理步进仍从 0 帧逐帧预热（裙摆/头发物理需从头累积），
            // 与全片渲染的物理结果完全一致，跳过区间仅省去渲染/读屏/发送开销。
            const targetMmdFrameTime = this._rangeStartFrame + (i / this.targetFrameRate) * mmdFrameRate;

            // 变步长物理推进：按目标帧率需求逐步推进至 targetMmdFrameTime
            // 30FPS → 每步 1.0 MMD 帧 (33.333ms)，与原始行为一致
            // 60FPS → 每步 0.5 MMD 帧 (16.667ms)，动画和物理均在子帧位置求值
            // 这样模型自然处于正确的插值位置，无需在 renderFrame 中重求值动画
            while (currentMmdFrameTime < targetMmdFrameTime) {
                // 单步最大不超过 1 个 MMD 帧，防止非标准帧率下步长过大影响物理稳定性
                const stepFrameTime = Math.min(targetMmdFrameTime - currentMmdFrameTime, 1.0);
                const stepMs = stepFrameTime * fixedDeltaMs;

                if (isReze) {
                    // RezePhysics：单次步进，引擎内部固定 1/60s 子步会自动处理累积时间
                    // 60FPS 时 stepMs ≈ 16.667ms → 1 个固定子步
                    // 30FPS 时 stepMs ≈ 33.333ms → 2 个固定子步
                    mmdRuntime.beforePhysics(stepMs);
                    RezePhysicsModule!.RezeMmdPhysics.stepAll(stepMs / 1000);
                    mmdRuntime.afterPhysics();
                } else {
                    // SPR (Bullet)：直接以 stepMs 作为物理步长
                    // 60FPS 时 16.667ms 步长匹配预览的 60Hz 行为
                    mmdRuntime.beforePhysics(stepMs);
                    if (physicsRuntime) {
                        physicsRuntime.afterAnimations(stepMs);
                    }
                    mmdRuntime.afterPhysics();
                }
                previousMmdFrameTime = currentMmdFrameTime;
                currentMmdFrameTime = mmdRuntime.currentFrameTime;
            }

            let renderTime: number;
            if (currentMmdFrameTime > previousMmdFrameTime && targetMmdFrameTime < currentMmdFrameTime) {
                const t = (targetMmdFrameTime - previousMmdFrameTime) / (currentMmdFrameTime - previousMmdFrameTime);
                renderTime = previousMmdFrameTime + (currentMmdFrameTime - previousMmdFrameTime) * t;
            } else {
                renderTime = currentMmdFrameTime;
            }

            renderFrame(renderTime);

            // YUV 转换 + 同步 readPixels
            const frameData = this.readFrame(width, height);
            this.frameBuffer.push({ index: i, data: frameData });

            if (this.frameBuffer.length >= this.batchSize) {
                await this.flushBatch(width, height);
            }

            this.currentFrame = i + 1;
            this.callbacks?.onRenderProgress(this.currentFrame, this.totalFrames);

            if (i % 10 === 0 || i === this.totalFrames - 1) {
                console.log(`[OfflineRenderManager] 进度: ${this.currentFrame}/${this.totalFrames}, 目标MMD帧: ${targetMmdFrameTime.toFixed(2)}, 插值渲染: ${renderTime.toFixed(2)}, 格式: ${this._transparentOutput ? 'NV12A' : 'NV12'}`);
            }

            // 使用 setTimeout(0) 让出主线程，但保持 GPU 忙碌
            //await new Promise(resolve => setTimeout(resolve, 0));
        }

        // 确保所有帧都被刷新
        await this.flushBatch(width, height);

        // 等待 native 确认所有帧已被编码器消费，再发送 finalize。
        // 保证 native 侧 FIFO 已空，finalize 的 EOF 排空语义下不会截断尾端帧。
        await this.wsClient!.waitAllAcked(this.totalFrames);

        // 通知 UI 切换状态
        if (this._transparentOutput) {
            // 透明模式：后续为 VP9 合成阶段，显示"编码中"并准备接收进度
            this.callbacks?.onEncodingProgress(0, this.totalFrames);
        } else {
            // 普通模式：MediaCodec 正在写入文件
            this.callbacks?.onRenderWriting();
        }

        // 2. 发送finalize，等待编码完成
        const finalizeResult = await this.finalizeRender();

        // 恢复物理引擎的正常运行模式
        if (RezePhysicsModule) {
            RezePhysicsModule.RezeMmdPhysics.setManualStepMode(false);
        }

        mmdRuntime.register(scene);
        if (physicsRuntime) {
            physicsRuntime.register(scene);
        }

        // 渲染完成后恢复动画到第0帧（与实时渲染的 AnimationManager._handleAnimationEnd 逻辑一致）
        mmdRuntime.seekAnimation(0, true);
        this.cameraManager?.stopAnimation();

        // 3. 清理
        await this.cleanupServer();
        await this.stopWebSocketServer();
        this.cleanup();

        if (this.shouldStop) {
            this.callbacks?.onRenderCancelled();
        } else {
            this.callbacks?.onRenderComplete(finalizeResult.outputPath);
        }
    }

    /**
     * 帧输出模式：单帧渲染 + RGBA 输出
     * 1. 有动画：seekAnimation 到主画布中的当前帧，重置物理，渲染当前帧
     * 2. 无动画：跳过 seekAnimation 和物理重置，直接渲染静态模型
     * 3. 读取 RGBA 数据并发送到 Native 端（PNG 编码）
     */
    private async renderFrameOutput(settings: RenderSettings): Promise<void> {
        this.refreshOffscreenRender(settings);

        const scene = this.sceneManager.getScene();
        const mmdRuntime = this.animationManager.getMmdRuntime();
        const physicsRuntime = PhysicsManager.getInstance().getPhysicsRuntime();

        if (!mmdRuntime) {
            throw new Error('MMD运行时未初始化');
        }

        const isReze = this._isRezePhysics();
        const hasAnim = this.hasAnimation();

        mmdRuntime.unregister(scene);
        if (physicsRuntime) {
            physicsRuntime.unregister();
        }

        // RezePhysics 模式：进入手动步进模式
        if (isReze) {
            const RezePhysicsModule = await import('../mmd/physics/RezeMmdPhysics');
            RezePhysicsModule.RezeMmdPhysics.setManualStepMode(true);
        }

        const width = settings.resolution.width || 1920;
        const height = settings.resolution.height || 1080;

        // 获取输出路径
        const outputPath = await this.getOutputPath();

        // 初始化渲染会话（帧输出模式：RGBA 数据 → PNG 编码）
        await this.initRenderSession({
            width,
            height,
            frameRate: 1,
            bitrate: 0,
            frameCount: 1,
            outputPath,
            forceColorFormat: 'auto',
            pixelFormat: 'rgba',
            skipAudio: true
        });

        console.log('[OfflineRenderManager] 帧输出模式: 准备渲染当前帧, 有动画:', hasAnim);

        let currentFrameTime = 0;

        if (hasAnim) {
            // 有动画：seekAnimation 到主画布中的当前帧
            currentFrameTime = this.animationManager.getCurrentAnimationTime();
            console.log('[OfflineRenderManager] 当前动画帧时间:', currentFrameTime);

            mmdRuntime.seekAnimation(currentFrameTime, true);
            mmdRuntime.initializeAllMmdModelsPhysics(true);

            // 重置物理到当前帧状态
            if (isReze) {
                const RezePhysicsModule = await import('../mmd/physics/RezeMmdPhysics');
                RezePhysicsModule.RezeMmdPhysics.stepAll(0);
            } else if (physicsRuntime) {
                physicsRuntime.afterAnimations(0);
            }
        } else {
            console.log('[OfflineRenderManager] 无动画，跳过 seekAnimation 和物理重置，渲染静态模型');
        }

        // 渲染当前帧
        if (this.renderTarget) {
            const engine = scene.getEngine();
            const internalTexture = this.renderTarget.renderTarget;
            if (internalTexture) {
                engine.bindFramebuffer(internalTexture, 0, undefined, undefined, true);
                engine.clear(scene.clearColor, true, true, false);
            }
        }

        if (this.cameraManager && hasAnim) {
            this.cameraManager.updateAnimationForRender(currentFrameTime);
        }

        if (hasAnim) {
            scene.particleSystems.forEach(ps => {
                if (ps.isStarted() && !(ps as any).isAnimationStopped) {
                    (scene as any)._animationRatio = 1.0;
                    ps.animate();
                }
            });
        }

        scene.render(true, true);

        // 读取 RGBA 帧数据
        const frameData = this.readFrameRGBA(width, height);

        // 发送帧到 Native
        this.frameBuffer = [{ index: 0, data: frameData }];
        await this.flushBatch(width, height);
        await this.wsClient!.waitAllAcked(1);

        // 通知 UI 切换状态
        this.callbacks?.onRenderWriting();

        // 发送 finalize，等待 PNG 编码完成
        const finalizeResult = await this.finalizeRender();

        // 恢复物理引擎
        if (isReze) {
            const RezePhysicsModule = await import('../mmd/physics/RezeMmdPhysics');
            RezePhysicsModule.RezeMmdPhysics.setManualStepMode(false);
        }

        mmdRuntime.register(scene);
        if (physicsRuntime) {
            physicsRuntime.register(scene);
        }

        // 渲染完成后恢复动画到第0帧（仅在有动画时）
        if (hasAnim) {
            mmdRuntime.seekAnimation(0, true);
            this.cameraManager?.stopAnimation();
        }

        // 清理
        await this.cleanupServer();
        await this.stopWebSocketServer();
        this.cleanup();

        if (this.shouldStop) {
            this.callbacks?.onRenderCancelled();
        } else {
            this.callbacks?.onRenderComplete(finalizeResult.outputPath);
        }
    }

    /**
     * 读取 RGBA 帧数据（帧输出模式使用）
     * 直接从离屏渲染目标读取 RGBA 像素，写入帧缓冲池
     */
    private readFrameRGBA(width: number, height: number): Uint8Array {
        if (!this.frameBufferPool) {
            throw new Error('FrameBufferPool 未初始化');
        }
        if (!this.renderTarget) {
            throw new Error('渲染目标未初始化');
        }

        const scene = this.sceneManager.getScene();
        const engine = scene.getEngine() as any;
        const gl = engine._gl as WebGL2RenderingContext;
        if (!gl) throw new Error('WebGL 上下文未找到');

        const { buffer } = this.frameBufferPool.acquire();
        const framebuffer = (this.renderTarget.renderTarget as any)?._framebuffer;
        if (framebuffer) gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        const dataView = new Uint8Array(buffer.buffer, 4, buffer.length - 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, dataView);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return buffer;
    }

    private async flushBatch(width: number, height: number): Promise<void> {
        if (this.frameBuffer.length === 0) return;

        const batch = this.frameBuffer;
        this.frameBuffer = [];

        try {
            await this.saveBatch(batch, width, height);
            // saveBatch 内部已逐帧 release；此处不再操作 batch
        } catch (error) {
            console.error('[OfflineRenderManager] 批量保存失败，尝试逐帧保存:', error);
            let anyFailed = false;
            let lastError: unknown = error;
            for (const frame of batch) {
                try {
                    await this.saveFrame(frame.index, width, height, frame.data);
                } catch (e) {
                    anyFailed = true;
                    lastError = e;
                } finally {
                    this.frameBufferPool?.release(frame.data);
                }
            }
            // 逐帧兜底仍失败（连接断开/帧超限）：必须向上抛出，
            // 否则渲染循环会静默跑完所有帧，产出损坏视频且前端无错误提示
            if (anyFailed) {
                throw lastError instanceof Error ? lastError : new Error(String(lastError));
            }
        }
    }

    /**
     * 渲染场景 → 读取帧数据
     * 透明输出模式: YUV+Alpha 双 Pass 转换 → 合并为 NV12A（[NV12 字节][Alpha 字节]）
     * 普通模式:     YUV 转换 → 同步 readPixels → NV12 解包
     * 返回带 4 字节帧索引头的帧数据（bytes 0-3 预留，数据从 offset 4 开始）
     * 零额外分配：readPixels 与输出均写入池中 buffer
     */
    private readFrame(width: number, height: number): Uint8Array {
        if (!this.frameBufferPool) {
            throw new Error('FrameBufferPool 未初始化');
        }

        if (this.yuvConverter) {
            const sceneTexture = this.getSceneTexture();
            if (sceneTexture) {
                this.yuvConverter.convert(sceneTexture);

                // 透明输出模式：读取 NV12A（NV12 + Alpha 合并）
                if (this._transparentOutput && this.yuvConverter.isAlphaEnabled()) {
                    return this.readFrameNV12A();
                }

                // 普通模式：读取 NV12
                const { buffer } = this.frameBufferPool.acquire();
                const dataView = new Uint8Array(buffer.buffer, 4, buffer.length - 4);
                this.yuvConverter.readPixelsInto(dataView);

                if (width % 4 === 0) {
                    return buffer;
                }
                const { buffer: dstBuf } = this.frameBufferPool.acquire();
                const dstDataView = new Uint8Array(dstBuf.buffer, 4, dstBuf.length - 4);
                this.yuvConverter.unpackToNV12InPlace(dataView, width, height, dstDataView);
                this.frameBufferPool.release(buffer);
                return dstBuf;
            }
        }

        // software fallback
        const rawData = this.readFrameFallback(width, height);
        const { buffer } = this.frameBufferPool.acquire();
        buffer.set(rawData, 4);
        return buffer;
    }

    /**
     * 透明输出模式：读取 NV12A，NV12 + Alpha 合并到池 buffer
     */
    private readFrameNV12A(): Uint8Array {
        if (!this.yuvConverter || !this.frameBufferPool) {
            throw new Error('NV12A 管线依赖 YUVConverter + FrameBufferPool');
        }
        const { buffer } = this.frameBufferPool.acquire();
        const dataView = new Uint8Array(buffer.buffer, 4, buffer.length - 4);
        this.yuvConverter.readNV12AInto(dataView);
        return buffer;
    }

    /**
     * Fallback: 同步读取 RGBA 并在 CPU 侧转换为 NV12
     */
    private readFrameFallback(width: number, height: number): Uint8Array {
        if (!this.renderTarget) throw new Error('渲染目标未初始化');

        const scene = this.sceneManager.getScene();
        const engine = scene.getEngine() as any;
        const gl = engine._gl as WebGL2RenderingContext;
        if (!gl) throw new Error('WebGL 上下文未找到');

        const framebuffer = (this.renderTarget.renderTarget as any)?._framebuffer;
        if (framebuffer) gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        // 复用预分配的 RGBA buffer
        const rgbaSize = width * height * 4;
        if (!this._fallbackRgbaBuffer || this._fallbackRgbaBuffer.length !== rgbaSize) {
            this._fallbackRgbaBuffer = new Uint8Array(rgbaSize);
        }
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, this._fallbackRgbaBuffer);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return this.softwareRGBAToNV12(this._fallbackRgbaBuffer, width, height);
    }

    // 预分配的 fallback RGBA buffer，避免每帧分配 ~8MB
    private _fallbackRgbaBuffer: Uint8Array | null = null;
    // 预分配的 NV12 输出 buffer，避免每帧分配 ~3MB
    private _fallbackNv12Buffer: Uint8Array | null = null;

    /**
     * CPU 侧 RGBA→NV12 转换（BT.709，有限范围）
     * 仅用作 YUV 转换器不可用时的降级路径
     */
    private softwareRGBAToNV12(rgba: Uint8Array, width: number, height: number): Uint8Array {
        const ySize = width * height;
        const uvSize = width * (height / 2);
        const totalSize = ySize + uvSize;

        // 复用预分配的 NV12 buffer
        if (!this._fallbackNv12Buffer || this._fallbackNv12Buffer.length !== totalSize) {
            this._fallbackNv12Buffer = new Uint8Array(totalSize);
        }
        const nv12 = this._fallbackNv12Buffer;

        // Y 平面
        const yOffset = 16 / 255;
        const yRange = 219 / 255;
        for (let i = 0; i < ySize; i++) {
            const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
            nv12[i] = ((0.2126 * r + 0.7152 * g + 0.0722 * b) * yRange + yOffset * 255) & 0xFF;
        }

        // UV 平面（NV12 交错，水平+垂直 2× 下采样）
        const cOffset = 128;
        const cRange = 224 / 255;
        for (let row = 0; row < height / 2; row++) {
            for (let col = 0; col < width / 2; col++) {
                const si = (row * 2 * width + col * 2) * 4;
                const r = rgba[si], g = rgba[si + 1], b = rgba[si + 2];
                const cb = (-0.1146 * r - 0.3854 * g + 0.5 * b) * cRange + cOffset;
                const cr = (0.5 * r - 0.4542 * g - 0.0458 * b) * cRange + cOffset;
                const di = ySize + row * width + col * 2;
                nv12[di] = cb & 0xFF;
                nv12[di + 1] = cr & 0xFF;
            }
        }

        return nv12;
    }

    /**
     * 获取场景渲染目标的 WebGL 纹理句柄
     */
    private getSceneTexture(): WebGLTexture | null {
        try {
            const rtw = (this.renderTarget?.renderTarget as any);
            const internalTexture = rtw?.texture;
            const hw = internalTexture?._hardwareTexture;
            return hw?.underlyingResource ?? null;
        } catch {
            return null;
        }
    }

    /**
     * 获取输出路径
     */
    private async getOutputPath(): Promise<string> {
        try {
            const result = await OfflineRender.getOutputPath?.();
            const basePath = result?.path || '';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            return `${basePath}/MikuPlay_${timestamp}.mp4`;
        } catch (error) {
            console.warn('[OfflineRenderManager] 获取输出路径失败，使用默认路径:', error);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            return `/storage/emulated/0/MikuPlay/MikuPlay_${timestamp}.mp4`;
        }
    }

    /**
     * 获取音频路径
     */
    private getAudioPath(): string | undefined {
        return videoComposeManager.getMusicFilePath() ?? undefined;
    }

    /**
     * 初始化渲染会话并启动MediaCodec（携带视频参数）
     */
    private async initRenderSession(params: {
        width: number;
        height: number;
        frameRate: number;
        bitrate: number;
        frameCount: number;
        outputPath: string;
        audioPath?: string;
        /** 帧范围渲染的音频起点偏移（微秒），native 据此跳过前缀 PCM 保持音画同步 */
        audioStartUs?: number;
        forceColorFormat?: string;
        pixelFormat?: string;
        skipAudio?: boolean;
    }): Promise<void> {
        const queueSize = this.calculateQueueSize(params.width, params.height);
        const result = await this.wsClient!.sendCommand('createSession', {
            ...params,
            queueSize
        });
        if (!result.success) {
            throw new Error('初始化渲染会话失败');
        }
    }

    /**
     * 保存单帧。发送失败（连接断开/帧超限）直接抛出，由 flushBatch 统一处理。
     */
    private async saveFrame(frameIndex: number, width: number, height: number, frameData: Uint8Array): Promise<void> {
        await this.wsClient!.sendBatch([{ index: frameIndex, data: frameData }], width, height);
    }

    private async saveBatch(frames: { index: number; data: Uint8Array }[], width: number, height: number): Promise<boolean> {
        try {
            const result = await this.wsClient!.sendBatch(frames, width, height, this.frameBufferPool!);
            console.log(`[OfflineRenderManager] 批量保存成功: ${result.queued} 帧入队`);
            return true;
        } catch (error) {
            console.error('[OfflineRenderManager] 批量保存失败:', error);
            throw error;
        }
    }

    /**
     * finalize渲染，等待MediaCodec编码完成
     */
    private async finalizeRender(): Promise<{ success: boolean; outputPath: string }> {
        const result = await this.wsClient!.sendCommand('finalize');

        if (!result.success) {
            throw new Error(result.error || 'finalize失败');
        }

        return { success: true, outputPath: result.outputPath };
    }

    private async cleanupServer(): Promise<void> {
        try {
            await this.wsClient!.sendCommand('cleanup');
        } catch (error) {
            console.error('[OfflineRenderManager] 清理服务器状态失败:', error);
        }
    }

    private async stopWebSocketServer(): Promise<void> {
        try {
            if (this.wsClient) {
                this.wsClient.close();
                this.wsClient = null;
            }
            await OfflineRender.stopServer();
            console.log('[OfflineRenderManager] WebSocket服务器已停止');
        } catch (error) {
            console.error('[OfflineRenderManager] 停止WebSocket服务器失败:', error);
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
    }

    private restoreUI(): void {
        for (const el of this.uiElements) {
            el.style.visibility = '';
            el.style.opacity = '';
        }
        this.uiElements = [];
    }

    private cleanupOffscreenRender(): void {
        if (this.offscreenCamera) {
            this.offscreenCamera.outputRenderTarget = null;
        }

        if (this.renderTarget) {
            this.renderTarget.dispose();
            this.renderTarget = null;
        }

        this.offscreenCamera = null;

        if (this.yuvConverter) {
            this.yuvConverter.dispose();
            this.yuvConverter = null;
        }

        // 释放帧缓冲池
        this.frameBufferPool = null;

        console.log('[OfflineRenderManager] 离屏渲染资源已清理');
    }

    private cleanup(): void {
        this.isRendering = false;
        // 恢复 clearColor（必须在清除 _transparentOutput 标志之前）
        if (this._prevClearColor) {
            const scene = this.sceneManager.getScene();
            const p = this._prevClearColor;
            scene.clearColor = new (scene.clearColor.constructor as any)(p.r, p.g, p.b, p.a);
            this._prevClearColor = null;
        }
        this._transparentOutput = false;
        this._frameOutputMode = false;
        this.cleanupOffscreenRender();
        this.restoreCameraAspectRatio();

        if (this.originalCanvasSize) {
            const scene = this.sceneManager.getScene();
            const engine = scene.getEngine();
            const canvas = engine.getRenderingCanvas();
            if (canvas) {
                canvas.width = this.originalCanvasSize.width;
                canvas.height = this.originalCanvasSize.height;
                engine.resize();
            }
            this.originalCanvasSize = null;
        }

        this.restoreUI();
        this.sceneManager.resumeScreenRender();
        this.frameBuffer = [];
    }

    public getIsRendering(): boolean {
        return this.isRendering;
    }

    public isYuvFallbackActive(): boolean {
        return this._yuvFallbackActive;
    }

    public getRenderProgress(): { currentFrame: number; totalFrames: number } {
        return {
            currentFrame: this.currentFrame,
            totalFrames: this.totalFrames
        };
    }
}
