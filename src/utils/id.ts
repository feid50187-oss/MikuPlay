
/**
 * 生成唯一 ID
 * @param prefix ID 前缀 (如 'model', 'anim', 'music')
 * @returns 唯一标识字符串
 */
export function generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}
