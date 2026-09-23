
/**
 * 主题变量
 * 统一的颜色、尺寸和动画配置
 * 支持亮色/暗色双主题
 */

export type ThemeKey = 'light' | 'dark';

export interface ThemeVars {
    accentColor: string;
    backgroundColor: string;
    surfaceColor: string;
    borderColor: string;
    textPrimary: string;
    textSecondary: string;
    textDisabled: string;
    hoverBg: string;
    activeBg: string;
    focusBg: string;
    overlayBg: string;
    errorColor: string;
    errorHover: string;
    accentHover: string;
    cancelHover: string;
    colorAxisX: string;
    colorAxisY: string;
    colorAxisZ: string;
    colorAxisW: string;
    spinnerBorderColor: string;
    viewportBg: string;
    itemBorderColor: string;
    mutedMetaText: string;
    successColor: string;
    successHover: string;
    warningColor: string;
    warningBg: string;
    infoColor: string;
    mikuColor: string;
    gradientBlack: string;
    overlayDarkBg: string;
    overlayDarkBg80: string;
    progressBg: string;
    progressColor: string;
    progressHover: string;
    topBarHeight: string;
    navBarHeight: string;
    touchTargetMin: string;
    borderRadius: string;
    borderRadiusSm: string;
    borderRadiusLg: string;
    transitionFast: string;
    transitionNormal: string;
    shadowSm: string;
    shadowMd: string;
    shadowLg: string;
}

/** 亮色主题 (默认) */
export const lightTheme: ThemeVars = {
    accentColor: '#FF6699',
    backgroundColor: '#f5f5f5',
    surfaceColor: '#ffffff',
    borderColor: '#e0e0e0',
    textPrimary: '#212121',
    textSecondary: '#616161',
    textDisabled: '#bdbdbd',
    hoverBg: 'rgba(0, 0, 0, 0.02)',
    activeBg: 'rgba(0, 0, 0, 0.08)',
    focusBg: 'rgba(0, 0, 0, 0.04)',
    overlayBg: 'rgba(0, 0, 0, 0.5)',
    errorColor: '#ff5252',
    errorHover: '#dc2626',
    accentHover: '#e65c8a',
    cancelHover: '#e04848',
    colorAxisX: '#ef4444',
    colorAxisY: '#22c55e',
    colorAxisZ: '#3b82f6',
    colorAxisW: '#f59e0b',
    spinnerBorderColor: '#f0f0f0',
    viewportBg: '#ffffff',
    itemBorderColor: '#f0f0f0',
    mutedMetaText: '#9e9e9e',
    successColor: '#22c55e',
    successHover: '#16a34a',
    warningColor: '#f59e0b',
    warningBg: 'rgba(245, 158, 11, 0.1)',
    infoColor: '#3b82f6',
    mikuColor: '#39C5BB',
    gradientBlack: '#000000',
    overlayDarkBg: 'rgba(0, 0, 0, 0.7)',
    overlayDarkBg80: 'rgba(0, 0, 0, 0.8)',
    progressBg: '#e0e0e0',
    progressColor: '#22c55e',
    progressHover: '#16a34a',
    topBarHeight: '48px',
    navBarHeight: '48px',
    touchTargetMin: '40px',
    borderRadius: '12px',
    borderRadiusSm: '8px',
    borderRadiusLg: '16px',
    transitionFast: '0.2s ease',
    transitionNormal: '0.3s ease',
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.2)',
    shadowMd: '0 2px 8px rgba(0, 0, 0, 0.1)',
    shadowLg: '0 8px 32px rgba(0, 0, 0, 0.2)',
};

/** 暗色主题 - Material Design 风格 */
export const darkTheme: ThemeVars = {
    accentColor: '#FF6699',
    backgroundColor: '#242424ff',
    surfaceColor: '#3b3b3bff',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    textPrimary: '#e6e6e6ff',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
    textDisabled: 'rgba(255, 255, 255, 0.38)',
    hoverBg: 'rgba(255, 255, 255, 0.05)',
    activeBg: 'rgba(255, 255, 255, 0.12)',
    focusBg: 'rgba(255, 255, 255, 0.08)',
    overlayBg: 'rgba(0, 0, 0, 0.7)',
    errorColor: '#ff5252',
    errorHover: '#dc2626',
    accentHover: '#e65c8a',
    cancelHover: '#e04848',
    colorAxisX: '#ef4444',
    colorAxisY: '#22c55e',
    colorAxisZ: '#3b82f6',
    colorAxisW: '#f59e0b',
    spinnerBorderColor: 'rgba(255, 255, 255, 0.1)',
    viewportBg: '#000000',
    itemBorderColor: 'rgba(255, 255, 255, 0.08)',
    mutedMetaText: 'rgba(255, 255, 255, 0.5)',
    successColor: '#22c55e',
    successHover: '#16a34a',
    warningColor: '#f59e0b',
    warningBg: 'rgba(245, 158, 11, 0.15)',
    infoColor: '#3b82f6',
    mikuColor: '#39C5BB',
    gradientBlack: '#000000',
    overlayDarkBg: 'rgba(0, 0, 0, 0.85)',
    overlayDarkBg80: 'rgba(0, 0, 0, 0.9)',
    progressBg: 'rgba(255, 255, 255, 0.12)',
    progressColor: '#22c55e',
    progressHover: '#16a34a',
    topBarHeight: '48px',
    navBarHeight: '48px',
    touchTargetMin: '40px',
    borderRadius: '12px',
    borderRadiusSm: '8px',
    borderRadiusLg: '16px',
    transitionFast: '0.2s ease',
    transitionNormal: '0.3s ease',
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.5)',
    shadowMd: '0 2px 8px rgba(0, 0, 0, 0.4)',
    shadowLg: '0 8px 32px rgba(0, 0, 0, 0.5)',
};

/** 当前活跃主题变量 */
export let theme: ThemeVars = { ...lightTheme };

/** CSS 变量名映射表 */
const cssVarMap: Record<keyof ThemeVars, string> = {
    accentColor: '--color-accent',
    accentHover: '--color-accent-hover',
    backgroundColor: '--color-bg',
    surfaceColor: '--color-surface',
    borderColor: '--color-border',
    itemBorderColor: '--color-item-border',
    textPrimary: '--color-text-primary',
    textSecondary: '--color-text-secondary',
    textDisabled: '--color-text-disabled',
    mutedMetaText: '--color-muted-meta',
    hoverBg: '--color-hover-bg',
    activeBg: '--color-active-bg',
    focusBg: '--color-focus-bg',
    overlayBg: '--color-overlay-bg',
    errorColor: '--color-error',
    errorHover: '--color-error-hover',
    cancelHover: '--color-cancel-hover',
    colorAxisX: '--color-axis-x',
    colorAxisY: '--color-axis-y',
    colorAxisZ: '--color-axis-z',
    colorAxisW: '--color-axis-w',
    spinnerBorderColor: '--color-spinner-border',
    viewportBg: '--color-viewport-bg',
    successColor: '--color-success',
    successHover: '--color-success-hover',
    warningColor: '--color-warning',
    warningBg: '--color-warning-bg',
    infoColor: '--color-info',
    mikuColor: '--color-miku',
    gradientBlack: '--color-gradient-black',
    overlayDarkBg: '--color-overlay-dark',
    overlayDarkBg80: '--color-overlay-dark-80',
    progressBg: '--color-progress-bg',
    progressColor: '--color-progress',
    progressHover: '--color-progress-hover',
    topBarHeight: '--topbar-height',
    navBarHeight: '--navbar-height',
    touchTargetMin: '--touch-target-min',
    borderRadius: '--radius-md',
    borderRadiusSm: '--radius-sm',
    borderRadiusLg: '--radius-lg',
    transitionFast: '--transition-fast',
    transitionNormal: '--transition-normal',
    shadowSm: '--shadow-sm',
    shadowMd: '--shadow-md',
    shadowLg: '--shadow-lg',
};

/**
 * 将主题变量应用到 DOM 的 :root CSS 变量
 * 同时更新全局 theme 对象
 */
export function applyThemeToDOM(key: ThemeKey): void {
    const newTheme = key === 'dark' ? darkTheme : lightTheme;
    theme = { ...newTheme };

    const root = document.documentElement;
    if (!root) return;

    (Object.keys(cssVarMap) as Array<keyof ThemeVars>).forEach((k) => {
        root.style.setProperty(cssVarMap[k], newTheme[k]);
    });

    // 兼容旧版 --mp-xxx 变量名
    root.style.setProperty('--mp-border', newTheme.borderColor);
    root.style.setProperty('--mp-surface', newTheme.surfaceColor);
    root.style.setProperty('--mp-text', newTheme.textPrimary);

    // 同步 body 背景色
    document.body.style.backgroundColor = newTheme.backgroundColor;
    document.body.style.color = newTheme.textPrimary;
}

/**
 * 初始化主题，读取持久化设置
 */
export function initTheme(): ThemeKey {
    let saved: ThemeKey = 'light';
    try {
        const raw = localStorage.getItem('mikuplay_theme');
        if (raw === 'dark' || raw === 'light') {
            saved = raw;
        }
    } catch { /* ignore */ }
    applyThemeToDOM(saved);
    return saved;
}

/**
 * 创建CSS过渡动画
 * @param properties 需要过渡的CSS属性数组
 * @param duration 动画时长，默认使用theme.transitionNormal
 */
export function createTransition(properties: string[], duration?: string): string {
    const dur = duration || theme.transitionNormal;
    return properties.map(prop => `${prop} ${dur}`).join(', ');
}

/**
 * 创建RGBA颜色
 * @param hex 十六进制颜色值
 * @param alpha 透明度 0-1
 */
export function rgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
