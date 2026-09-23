/**
 * 截图 API 服务
 * 插件可通过此服务截取当前画面
 */
import type { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';

export interface ScreenshotOptions {
    width?: number;
    height?: number;
    mimeType?: 'image/png' | 'image/jpeg';
    quality?: number; // 0-1，仅 jpeg
}

export class ScreenshotApiService {
    private static instance: ScreenshotApiService;
    private scene: Scene | null = null;
    private engine: Engine | null = null;

    private constructor() {}

    static getInstance(): ScreenshotApiService {
        if (!ScreenshotApiService.instance) {
            ScreenshotApiService.instance = new ScreenshotApiService();
        }
        return ScreenshotApiService.instance;
    }

    /**
     * 初始化（注入 scene 和 engine）
     */
    initialize(scene: Scene, engine: Engine): void {
        this.scene = scene;
        this.engine = engine;
    }

    /**
     * 截取当前画面
     */
    async capture(options: ScreenshotOptions = {}): Promise<Blob> {
        if (!this.engine || !this.scene) {
            throw new Error('ScreenshotApi 未初始化');
        }

        const {
            width = this.engine.getRenderWidth(),
            height = this.engine.getRenderHeight(),
            mimeType = 'image/png',
            quality = 0.95
        } = options;

        // 使用 Babylon 的截图功能
        return new Promise((resolve, reject) => {
            try {
                // 渲染一帧确保最新
                this.engine!.scenes[0].render();

                // 获取 canvas
                const canvas = this.engine!._renderingCanvas;

                // 创建临时 canvas 缩放
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = width;
                tempCanvas.height = height;
                const ctx = tempCanvas.getContext('2d');

                if (!ctx) {
                    reject(new Error('无法创建 canvas context'));
                    return;
                }

                // 绘制当前画面
                ctx.drawImage(canvas, 0, 0, width, height);

                // 转 Blob
                tempCanvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('截图失败'));
                    }
                }, mimeType, quality);
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * 截取并保存到内容库
     */
    async captureAndSave(name?: string, options: ScreenshotOptions = {}): Promise<string> {
        const blob = await this.capture(options);
        const fileName = name || `screenshot_${Date.now()}.png`;

        // 调用内容库保存
        const { contentLibraryApi } = await import('../library/ContentLibraryApi');
        await contentLibraryApi.addAsset(blob, 'images', fileName);

        return fileName;
    }

    /**
     * 截取为 base64
     */
    async captureBase64(options: ScreenshotOptions = {}): Promise<string> {
        const blob = await this.capture(options);
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
}

export const screenshotApiService = ScreenshotApiService.getInstance();
