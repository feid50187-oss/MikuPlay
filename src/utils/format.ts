
/**
 * 格式化文件大小
 * @param bytes 字节数
 * @returns 人类可读的文件大小字符串
 */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

/**
 * 格式化秒数为 MM:SS 格式
 * @param seconds 总秒数
 * @returns MM:SS 格式字符串，无效值返回 '--:--'
 */
export function formatDuration(seconds: number): string {
    if (!seconds || isNaN(seconds)) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 向下取最接近的偶数
 * @param value 输入数值
 * @returns 偶数（最小为 2）
 */
export function makeEven(value: number): number {
    if (value % 2 !== 0) {
        return Math.max(2, value - 1);
    }
    return value;
}

/**
 * 线性插值
 */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * 钳制数值到 [min, max] 范围
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}
