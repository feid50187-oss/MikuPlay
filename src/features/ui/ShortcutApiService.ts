/**
 * 快捷键 API 服务
 * 插件可通过此服务注册全局快捷键
 */

export interface ShortcutOptions {
    key: string;           // 按键（如 'ctrl+s', 'ctrl+shift+p'）
    description?: string;   // 描述
    handler: () => void;   // 回调
    preventDefault?: boolean; // 是否阻止默认行为
}

interface ShortcutEntry extends ShortcutOptions {
    id: string;
}

export class ShortcutApiService {
    private static instance: ShortcutApiService;
    private shortcuts: Map<string, ShortcutEntry> = new Map();
    private bound: boolean = false;

    private constructor() {}

    static getInstance(): ShortcutApiService {
        if (!ShortcutApiService.instance) {
            ShortcutApiService.instance = new ShortcutApiService();
        }
        return ShortcutApiService.instance;
    }

    /**
     * 注册快捷键
     * @returns 快捷键 ID，用于注销
     */
    register(options: ShortcutOptions): string {
        const id = `shortcut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        this.shortcuts.set(id, {
            ...options,
            id
        });

        this.ensureBound();
        return id;
    }

    /**
     * 注销快捷键
     */
    unregister(id: string): void {
        this.shortcuts.delete(id);
    }

    /**
     * 注销所有插件的快捷键
     */
    unregisterAll(): void {
        this.shortcuts.clear();
    }

    /**
     * 获取所有快捷键
     */
    getAll(): ShortcutEntry[] {
        return Array.from(this.shortcuts.values());
    }

    /**
     * 绑定全局键盘事件
     */
    private ensureBound(): void {
        if (this.bound) return;
        this.bound = true;

        document.addEventListener('keydown', (e) => {
            const keyCombo = this.parseEvent(e);
            if (!keyCombo) return;

            // 查找匹配的快捷键
            for (const shortcut of this.shortcuts.values()) {
                if (shortcut.key.toLowerCase() === keyCombo) {
                    if (shortcut.preventDefault !== false) {
                        e.preventDefault();
                    }
                    shortcut.handler();
                    break;
                }
            }
        });
    }

    /**
     * 解析键盘事件为组合键字符串
     */
    private parseEvent(e: KeyboardEvent): string | null {
        const parts: string[] = [];

        if (e.ctrlKey || e.metaKey) parts.push('ctrl');
        if (e.shiftKey) parts.push('shift');
        if (e.altKey) parts.push('alt');

        let key = e.key.toLowerCase();

        // 特殊键处理
        if (key === ' ') key = 'space';
        if (key === 'escape') key = 'esc';

        parts.push(key);

        return parts.join('+');
    }
}

export const shortcutApiService = ShortcutApiService.getInstance();
