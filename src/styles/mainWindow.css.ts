
/**
 * 主界面样式
 * 三段式布局：TopBar(48px) + 视口 + NavBar(48px)
 */

import { theme, createTransition } from './theme';

export { theme, createTransition } from './theme';

export const mainWindowStyles = `
    .main-window {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background-color: var(--color-surface);
        /* 使用原生注入的安全区CSS变量 */
        padding-top: var(--safe-area-top, 0px);
        padding-bottom: var(--safe-area-bottom, 0px);
        padding-left: var(--safe-area-left, 0px);
        padding-right: var(--safe-area-right, 0px);
        contain: layout paint style;
    }

    .top-bar {
        width: 100%;
        height: ${theme.topBarHeight};
        min-height: ${theme.topBarHeight};
        background-color: var(--color-surface);
        display: flex;
        align-items: center;
        padding: 0 4px;
        border-bottom: 1px solid var(--color-border);
        contain: layout paint;
    }

    .viewport {
        flex: 1;
        width: 100%;
        overflow: hidden;
        position: relative;
        background-color: var(--color-viewport-bg);
        contain: strict;
    }

    .nav-bar {
        width: 100%;
        height: ${theme.navBarHeight};
        min-height: ${theme.navBarHeight};
        background-color: var(--color-surface);
        display: flex;
        align-items: center;
        justify-content: center;
        border-top: 1px solid var(--color-border);
        /* 不使用 paint containment：NavBar 的 panel-container 向上弹出，paint 会导致裁剪 */
        contain: layout;
    }

    /* 横屏模式下减小Bar高度 */
    @media (orientation: landscape) and (max-height: 500px) {
        .top-bar {
            height: 24px;
            min-height: 24px;
        }

        .nav-bar {
            height: 24px;
            min-height: 24px;
        }
    }

    .viewport canvas {
        display: block;
        width: 100% !important;
        height: 100% !important;
        outline: none;
    }

    /* 退出对话框样式 */
    .exit-dialog-message {
        padding: 20px 0 8px 24px;
        font-size: 20px;
    }

    .exit-dialog-footer {
        border-top: none;
        justify-content: flex-end;
    }
`;

export { injectStyles } from './styleManager';
