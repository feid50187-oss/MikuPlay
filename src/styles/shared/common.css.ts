
import { theme, createTransition, rgba } from '../theme';

/**
 * 通用按钮、输入框等基础样式
 * 用于共享组件和面板中的通用元素
 */
export const commonStyles = `
    /* === CSS 自定义属性 (主题变量) === */
    :root {
        /* 主色调 */
        --color-accent: ${theme.accentColor};
        --color-accent-hover: ${theme.accentHover};
        --color-bg: ${theme.backgroundColor};
        --color-surface: ${theme.surfaceColor};
        --color-border: ${theme.borderColor};
        --color-item-border: ${theme.itemBorderColor};

        /* 文字色 */
        --color-text-primary: ${theme.textPrimary};
        --color-text-secondary: ${theme.textSecondary};
        --color-text-disabled: ${theme.textDisabled};
        --color-muted-meta: ${theme.mutedMetaText};

        /* 状态色 */
        --color-hover-bg: ${theme.hoverBg};
        --color-active-bg: ${theme.activeBg};
        --color-focus-bg: ${theme.focusBg};
        --color-overlay-bg: ${theme.overlayBg};

        /* 错误/危险色 */
        --color-error: ${theme.errorColor};
        --color-error-hover: ${theme.errorHover};
        --color-cancel-hover: ${theme.cancelHover};

        /* 坐标轴色 */
        --color-axis-x: ${theme.colorAxisX};
        --color-axis-y: ${theme.colorAxisY};
        --color-axis-z: ${theme.colorAxisZ};
        --color-axis-w: ${theme.colorAxisW};

        /* 其他 UI 色 */
        --color-spinner-border: ${theme.spinnerBorderColor};
        --color-viewport-bg: ${theme.viewportBg};

        /* 圆角 */
        --radius-sm: ${theme.borderRadiusSm};
        --radius-md: ${theme.borderRadius};
        --radius-lg: ${theme.borderRadiusLg};

        /* 阴影 */
        --shadow-sm: ${theme.shadowSm};
        --shadow-md: ${theme.shadowMd};
        --shadow-lg: ${theme.shadowLg};

        /* 动画 */
        --transition-fast: ${theme.transitionFast};
        --transition-normal: ${theme.transitionNormal};

        /* 尺寸 */
        --touch-target-min: ${theme.touchTargetMin};
        --topbar-height: ${theme.topBarHeight};
        --navbar-height: ${theme.navBarHeight};
    }

    /* === 通用按钮 === */
    .mp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 16px;
        border-radius: 8px;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        color: var(--color-text-primary);
        font-size: 14px;
        cursor: pointer;
        min-height: ${theme.touchTargetMin};
        ${createTransition(['background', 'border-color'])}
        user-select: none;
    }

    .mp-btn:active {
        background: var(--color-active-bg);
        transform: scale(0.98);
    }

    .mp-btn--primary {
        background: var(--color-accent);
        color: #fff;
        border-color: var(--color-accent);
    }

    .mp-btn--danger {
        background: var(--color-error);
        color: #fff;
        border-color: var(--color-error);
    }

    .mp-btn--small {
        padding: 4px 10px;
        font-size: 12px;
        min-height: 32px;
    }

    /* === 通用输入框 === */
    .mp-input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        font-size: 14px;
        color: var(--color-text-primary);
        background: var(--color-surface);
        ${createTransition(['border-color'])}
    }

    .mp-input:focus {
        outline: none;
        border-color: var(--color-accent);
        //box-shadow: 0 0 0 2px ${rgba(theme.accentColor, 0.2)};
    }

    /* === 通用对话框 === */
    .mp-dialog-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: var(--color-overlay-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        animation: fadeIn 0.2s ease;
    }

    .mp-dialog {
        background-color: var(--color-surface);
        border-radius: var(--radius-md);
        min-width: 280px;
        max-width: 90%;
        max-height: 80%;
        //box-shadow: var(--shadow-lg);
        animation: slideUp 0.2s ease;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        contain: layout paint;
    }

    .mp-dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--color-border);
    }

    .mp-dialog-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .mp-dialog-close {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--color-text-secondary);
        font-size: 20px;
        cursor: pointer;
    }

    .mp-dialog-body {
        padding: 16px;
        flex: 1;
        overflow-y: auto;
    }

    .mp-dialog-footer {
        display: flex;
        gap: 12px;
        padding: 16px;
        border-top: 1px solid var(--color-border);
    }

    .mp-dialog-message {
        font-size: 14px;
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin: 0 0 16px 0;
    }

    .mp-dialog-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @keyframes slideUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
`;
