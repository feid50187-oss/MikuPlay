import { Capacitor } from '@capacitor/core';
import { Fullscreen } from './platform';

/**
 * 主动呼出原生安全区调整对话框。
 * 用于用户发现安全区配置错误后需要重新校准的场景。
 */
export async function showSafeAreaTuner(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
        console.warn('[SafeArea] 非原生平台，无法呼出安全区调整窗口');
        return;
    }
    try {
        await Fullscreen.showSafeAreaTuner();
    } catch (error) {
        console.error('[SafeArea] 呼出安全区调整窗口失败:', error);
    }
}