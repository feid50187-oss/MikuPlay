
import { Scene, Texture } from '@babylonjs/core';

export interface DownsampleResult {
    targetWidth: number;
    targetHeight: number;
    shouldDownsample: boolean;
}

export class TextureDownsampler {
    private static instance: TextureDownsampler;
    private cache: Map<string, Texture> = new Map();

    public static getInstance(): TextureDownsampler {
        if (!TextureDownsampler.instance) {
            TextureDownsampler.instance = new TextureDownsampler();
        }
        return TextureDownsampler.instance;
    }

    public static resetInstance(): void {
        if (TextureDownsampler.instance) {
            TextureDownsampler.instance.clearCache();
        }
        TextureDownsampler.instance = undefined as any;
    }

    public calculateTargetSize(width: number, height: number): DownsampleResult {
        const pixelCount = width * height;
        const threshold = 1024 * 1024;

        if (pixelCount <= threshold) {
            return {
                targetWidth: width,
                targetHeight: height,
                shouldDownsample: false
            };
        }

        let tw = Math.floor(width * 0.5);
        let th = Math.floor(height * 0.5);

        const shortEdge = Math.min(tw, th);
        if (shortEdge > 1024) {
            const limitScale = 1024 / shortEdge;
            tw = Math.floor(tw * limitScale);
            th = Math.floor(th * limitScale);
        }

        console.log(`[TextureDownsampler] ${width}x${height} -> ${tw}x${th} (pixels: ${pixelCount.toLocaleString()} -> ${(tw * th).toLocaleString()})`);

        return {
            targetWidth: tw,
            targetHeight: th,
            shouldDownsample: true
        };
    }

    public async downsample(
        textureData: ArrayBuffer,
        textureKey: string,
        scene: Scene
    ): Promise<Texture | null> {
        if (this.cache.has(textureKey)) {
            console.log(`[TextureDownsampler] Cache hit: ${textureKey}`);
            return this.cache.get(textureKey)!;
        }

        try {
            const blob = new Blob([textureData]);
            const bitmap = await createImageBitmap(blob);
            const width = bitmap.width;
            const height = bitmap.height;

            const { targetWidth, targetHeight, shouldDownsample } = this.calculateTargetSize(width, height);

            if (!shouldDownsample) {
                console.log(`[TextureDownsampler] No downsample needed for ${textureKey}: ${width}x${height}`);
                bitmap.close();
                return null;
            }

            console.log(`[TextureDownsampler] Processing ${textureKey}: ${width}x${height} -> ${targetWidth}x${targetHeight}`);

            const canvas = new OffscreenCanvas(targetWidth, targetHeight);
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                bitmap.close();
                return null;
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            // Y-flip: 在Y轴上翻转绘制
            ctx.translate(0, targetHeight);
            ctx.scale(1, -1);
            ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
            bitmap.close();

            const blobOut = await canvas.convertToBlob({ type: 'image/png' });
            const url = URL.createObjectURL(blobOut);

            // 等待纹理加载完成
            const texture = await new Promise<Texture>((resolve, reject) => {
                const tex = new Texture(
                    url,
                    scene,
                    false,
                    false,
                    Texture.TRILINEAR_SAMPLINGMODE,
                    () => {
                        console.log(`[TextureDownsampler] Completed ${textureKey}: ${targetWidth}x${targetHeight}`);
                        this.cache.set(textureKey, tex);
                        resolve(tex);
                    },
                    (message, exception) => {
                        console.error(`[TextureDownsampler] Texture load error for ${textureKey}:`, message, exception);
                        reject(new Error(message || 'Texture load failed'));
                    }
                );
            });

            return texture;
        } catch (error) {
            console.error('[TextureDownsampler] Failed to downsample:', error);
            return null;
        }
    }

    public clearCache(): void {
        this.cache.clear();
    }
}

export const textureDownsampler = TextureDownsampler.getInstance();
