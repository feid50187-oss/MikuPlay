
import { StateStore } from './StateStore';
import { applyThemeToDOM, type ThemeKey } from '../../styles/theme';
import { Events } from '../../core';

export interface ThemeState {
    theme: ThemeKey;
}

function getDefaultThemeState(): ThemeState {
    let saved: ThemeKey = 'light';
    try {
        const raw = localStorage.getItem('mikuplay_theme');
        if (raw === 'dark' || raw === 'light') {
            saved = raw;
        }
    } catch { /* ignore */ }
    return { theme: saved };
}

/**
 * 主题状态管理器
 * 管理亮色/暗色主题切换，支持持久化和状态栏同步
 */
export class ThemeStateManager extends StateStore<ThemeState> {
    protected state: ThemeState = getDefaultThemeState();
    private static instance: ThemeStateManager | null = null;

    private constructor() {
        super();
        // 初始化时应用已保存的主题
        applyThemeToDOM(this.state.theme);
    }

    static getInstance(): ThemeStateManager {
        if (!ThemeStateManager.instance) {
            ThemeStateManager.instance = new ThemeStateManager();
        }
        return ThemeStateManager.instance;
    }

    /**
     * 获取当前主题
     */
    getTheme(): ThemeKey {
        return this.state.theme;
    }

    /**
     * 是否为暗色主题
     */
    isDarkMode(): boolean {
        return this.state.theme === 'dark';
    }

    /**
     * 切换主题
     */
    toggleTheme(): void {
        const newTheme: ThemeKey = this.state.theme === 'dark' ? 'light' : 'dark';
        this.setTheme(newTheme);
    }

    /**
     * 设置指定主题
     */
    setTheme(theme: ThemeKey): void {
        if (this.state.theme === theme) return;

        this.update({ theme }, Events.THEME_CHANGED, theme);

        // 持久化
        try {
            localStorage.setItem('mikuplay_theme', theme);
        } catch { /* ignore */ }

        // 应用到 DOM
        applyThemeToDOM(theme);
    }

    /**
     * 清理单例（用于测试）
     */
    static resetInstance(): void {
        ThemeStateManager.instance = null;
    }
}

export const themeStateManager = ThemeStateManager.getInstance();
