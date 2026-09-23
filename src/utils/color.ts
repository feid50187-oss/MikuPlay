
import { Color4 } from '@babylonjs/core';

/**
 * RGB 转十六进制颜色字符串
 * @param r 红色分量 (0-1)
 * @param g 绿色分量 (0-1)
 * @param b 蓝色分量 (0-1)
 * @returns 十六进制颜色字符串 (如 '#ff6699')
 */
export function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (value: number) => {
        const hex = Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 十六进制颜色字符串转 RGB
 * @param hex 十六进制颜色字符串 (如 '#ff6699' 或 'ff6699')
 * @returns RGB 颜色对象 (分量 0-1)
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        return { r: 1, g: 1, b: 1 };
    }
    return {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
    };
}

/**
 * 十六进制颜色字符串转 Babylon.js Color4
 * @param hex 十六进制颜色字符串
 * @param alpha Alpha 分量 (默认 1)
 * @returns Babylon Color4 对象
 */
export function hexToColor4(hex: string, alpha: number = 1): Color4 {
    const { r, g, b } = hexToRgb(hex);
    return new Color4(r, g, b, alpha);
}

/**
 * 钳制数值到 [0, 1] 范围
 */
export function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}
