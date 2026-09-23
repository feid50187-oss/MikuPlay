
/**
 * 获取 CSS 安全区域 inset 值
 * @param position 安全区域位置
 * @returns CSS 像素值
 */
const _safeAreaCache = new Map<string, number>();

export function getSafeAreaInset(position: 'top' | 'bottom' | 'left' | 'right'): number {
    const cached = _safeAreaCache.get(position);
    if (cached !== undefined) return cached;

    // 从原生注入的CSS变量读取安全区值
    const computedStyle = window.getComputedStyle(document.documentElement);
    const value = parseFloat(computedStyle.getPropertyValue(`--safe-area-${position}`)) || 0;
    _safeAreaCache.set(position, value);
    return value;
}

/**
 * 向上遍历 DOM 树查找最近的带有 data-model-id 属性的祖先元素
 * @param element 起始元素
 * @returns modelId 字符串，未找到返回 null
 */
export function getFirstAncestorModelId(element: HTMLElement): string | null {
    const entry = element.closest('.model-opt-bone-entry') as HTMLElement | null;
    return entry?.dataset.modelId ?? null;
}

/**
 * 为元素应用中间省略名称功能
 * 当名称过长超出容器时，省略中间部分，显示为 "前缀…后缀"
 * 使用 ResizeObserver 自动响应容器尺寸变化
 * @param element 需要显示名称的元素
 * @param fullName 完整名称
 */
export function applyMiddleEllipsis(element: HTMLElement, fullName: string): void {
    element.title = fullName;

    const update = () => {
        const availableWidth = element.clientWidth;
        if (availableWidth <= 0) return;

        // 设置完整文本以测量所需宽度
        element.textContent = fullName;
        if (element.scrollWidth <= availableWidth) return;

        // 估算可容纳的字符数
        const avgCharWidth = element.scrollWidth / fullName.length;
        const maxChars = Math.max(1, Math.floor(availableWidth / avgCharWidth) - 1);

        // 从估算值逐步缩小直到文本不溢出
        let totalChars = Math.min(maxChars, fullName.length - 1);
        while (totalChars >= 1) {
            const leftLen = Math.ceil(totalChars / 2);
            const rightLen = totalChars - leftLen;
            const truncated = fullName.substring(0, leftLen) + '…' + fullName.substring(fullName.length - rightLen);
            element.textContent = truncated;
            if (element.scrollWidth <= availableWidth) return;
            totalChars--;
        }
        element.textContent = '…';
    };

    const observer = new ResizeObserver(() => requestAnimationFrame(update));
    observer.observe(element);
}
