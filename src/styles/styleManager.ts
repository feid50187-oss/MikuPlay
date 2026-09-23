
/**
 * 统一样式注入管理器
 * 所有组件通过此管理器注入 CSS，自动去重，避免同一样式多次注入
 */
class StyleManager {
    private injected = new Set<string>();

    /**
     * 注入样式（自动去重）
     * @param id 样式唯一标识，建议使用 `组件名` 或 `模块名`
     * @param styles CSS 字符串
     */
    inject(id: string, styles: string): void {
        if (this.injected.has(id)) return;

        const el = document.createElement('style');
        el.id = `mikuplay-${id}`;
        el.textContent = styles;
        document.head.appendChild(el);
        this.injected.add(id);
    }

    /**
     * 移除已注入的样式
     * @param id 样式唯一标识
     */
    remove(id: string): void {
        const el = document.getElementById(`mikuplay-${id}`);
        if (el) {
            el.remove();
            this.injected.delete(id);
        }
    }

    /**
     * 检查样式是否已注入
     */
    has(id: string): boolean {
        return this.injected.has(id);
    }

    /**
     * 清除所有注入的样式
     */
    clear(): void {
        this.injected.forEach(id => {
            const el = document.getElementById(`mikuplay-${id}`);
            if (el) el.remove();
        });
        this.injected.clear();
    }
}

export const styleManager = new StyleManager();

/**
 * 注入样式（便捷函数，委托给 styleManager.inject 去重）
 */
export function injectStyles(styles: string, id: string): void {
    styleManager.inject(id, styles);
}
