
import { Capacitor } from '@capacitor/core';

export interface FullscreenPlugin {
    setImmersiveMode(options: { enabled: boolean }): Promise<void>;
    isImmersiveMode(): Promise<{ enabled: boolean }>;
    showSafeAreaTuner(): Promise<void>;
}

export const Fullscreen = Capacitor.registerPlugin<FullscreenPlugin>('Fullscreen');

/**
 * 检查当前是否处于全屏状态
 * 处理各浏览器厂商前缀
 */
export function checkFullscreenState(): boolean {
    return !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
    );
}

/**
 * 进入全屏
 * @returns 是否成功进入全屏
 */
export async function enterFullscreen(): Promise<boolean> {
    try {
        const docEl = document.documentElement;
        let requestMethod: (() => Promise<void>) | null = null;

        if (docEl.requestFullscreen) {
            requestMethod = docEl.requestFullscreen.bind(docEl);
        } else if ((docEl as any).webkitRequestFullscreen) {
            requestMethod = (docEl as any).webkitRequestFullscreen.bind(docEl);
        } else if ((docEl as any).mozRequestFullScreen) {
            requestMethod = (docEl as any).mozRequestFullScreen.bind(docEl);
        } else if ((docEl as any).msRequestFullscreen) {
            requestMethod = (docEl as any).msRequestFullscreen.bind(docEl);
        }

        if (requestMethod) {
            await requestMethod();
            if (Capacitor.isNativePlatform()) {
                try {
                    await Fullscreen.setImmersiveMode({ enabled: true });
                } catch (e) {
                    console.warn('设置沉浸模式失败:', e);
                }
            }
            return true;
        }
        return false;
    } catch (error) {
        console.error('进入全屏失败:', error);
        return false;
    }
}

/**
 * 退出全屏
 * @returns 是否成功退出全屏
 */
export async function exitFullscreen(): Promise<boolean> {
    try {
        let exitMethod: (() => Promise<void>) | null = null;

        if (document.exitFullscreen) {
            exitMethod = document.exitFullscreen.bind(document);
        } else if ((document as any).webkitExitFullscreen) {
            exitMethod = (document as any).webkitExitFullscreen.bind(document);
        } else if ((document as any).mozCancelFullScreen) {
            exitMethod = (document as any).mozCancelFullScreen.bind(document);
        } else if ((document as any).msExitFullscreen) {
            exitMethod = (document as any).msExitFullscreen.bind(document);
        }

        if (exitMethod) {
            await exitMethod();
            if (Capacitor.isNativePlatform()) {
                try {
                    await Fullscreen.setImmersiveMode({ enabled: false });
                } catch (e) {
                    console.warn('退出沉浸模式失败:', e);
                }
            }
            return true;
        }
        return false;
    } catch (error) {
        console.error('退出全屏失败:', error);
        return false;
    }
}

/**
 * Capacitor 文件路径转 URL
 * 封装 Capacitor.convertFileSrc，统一处理平台差异
 */
export function convertFilePathToUrl(filePath: string): string {
    return Capacitor.convertFileSrc(filePath);
}

/**
 * 通过文件路径获取 ArrayBuffer
 *
 * 内部使用 convertFilePathToUrl 转换为可 fetch 的 URL，
 * 然后在 Capacitor (Android) 和 Web 平台上均可正常工作。
 *
 * @param filePath - 原生文件路径（Android）或虚拟路径（Web）
 * @returns 文件的 ArrayBuffer
 * @throws 网络或文件读取失败时抛出错误
 */
export async function fetchFileAsArrayBuffer(filePath: string): Promise<ArrayBuffer> {
    const fileUrl = convertFilePathToUrl(filePath);
    const response = await fetch(fileUrl);
    if (!response.ok) {
        throw new Error(`无法读取文件: HTTP ${response.status}`);
    }
    return response.arrayBuffer();
}
