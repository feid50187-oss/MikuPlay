
import { theme, createTransition } from '../theme';

export const topBarStyles = `
    .top-bar-container {
        display: flex;
        align-items: center;
        width: 100%;
        height: ${theme.topBarHeight};
        min-height: ${theme.topBarHeight};
        background-color: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
        padding: 0px;
        contain: layout paint;
    }

    .top-bar-container .menu-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: none;
        background-color: transparent;
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
        padding: 0;
        outline: none;
    }

    .top-bar-container .menu-button:active {
        background-color: var(--color-active-bg);
    }

    .top-bar-container .menu-button:focus {
        background-color: var(--color-focus-bg);
    }

    .top-bar-container .menu-button svg {
        width: 24px;
        height: 24px;
        color: var(--color-accent);
    }

    .top-bar-title {
        font-size: 16px;
        font-weight: 500;
        color: var(--color-text-secondary);
        margin-left: 8px;
    }

    .top-bar-spacer {
        flex: 1;
    }

    .top-bar-container .animation-controls {
        display: flex;
        align-items: center;
        margin-right: 8px;
    }

    .top-bar-container .control-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: none;
        background-color: transparent;
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
        padding: 0;
        outline: none;
    }

    .top-bar-container .control-button:active {
        background-color: var(--color-active-bg);
    }

    .top-bar-container .control-button:focus {
        background-color: var(--color-focus-bg);
    }

    .top-bar-container .control-button svg {
        width: 24px;
        height: 24px;
        color: var(--color-accent);
    }

    /* 全屏按钮特殊样式 */
    .top-bar-container .fullscreen-button svg {
        fill: var(--color-accent);
    }

    /* 性能监测控件样式 */
    .performance-monitor-container {
        margin-left: 2px;
        margin-bottom: 1px;
    }

    .performance-monitor-row {
        display: flex;
        align-items: center;
        //justify-content: space-between;
        gap: 4px;
    }

    .performance-monitor-label {
        font-size: 16px;
        font-weight: 500;
        color: var(--color-text-secondary);
        text-transform: uppercase;
        //letter-spacing: 0.5px;
    }

    .performance-monitor-value {
        font-size: 16px;
        font-weight: 600;
        //font-family: monospace;
        color: var(--color-text-primary);
        min-width: 50px;
        text-align: left;
    }

    /* FPS 状态颜色 */
    .performance-monitor-value.fps-good {
        color: var(--color-axis-y);
    }

    .performance-monitor-value.fps-warning {
        color: var(--color-axis-w);
    }

    .performance-monitor-value.fps-bad {
        color: var(--color-axis-x);
    }

    /* 横屏模式下减小高度 */
    @media (orientation: landscape) and (max-height: 500px) {
        .top-bar-container {
            height: 24px;
            min-height: 24px;
        }

        .top-bar-container .menu-button {
            width: 24px;
            height: 24px;
        }

        .top-bar-container .menu-button svg {
            width: 16px;
            height: 16px;
        }

        .top-bar-container .control-button {
            width: 24px;
            height: 24px;
        }

        .top-bar-container .control-button svg {
            width: 16px;
            height: 16px;
        }

        .top-bar-title {
            font-size: 12px;
        }

        .performance-monitor-container {
            min-width: 70px;
            margin-left: 4px;
            gap: 0;
        }

        .performance-monitor-row {
            gap: 6px;
        }

        .performance-monitor-label {
            font-size: 9px;
        }

        .performance-monitor-value {
            font-size: 10px;
            min-width: 36px;
        }
    }
`;
