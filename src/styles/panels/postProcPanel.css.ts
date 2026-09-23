
import { theme, createTransition } from '../theme';

export const postProcPanelStyles = `
    .post-proc-panel {
        display: flex;
        flex-direction: column;
    }

    .post-proc-item {
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        overflow: visible;
        position: relative;
    }

    .post-proc-item .mp-collapsible-arrow {
        width: 20px;
        height: 20px;
        color: var(--color-accent);
        flex-shrink: 0;
    }

    .post-proc-item.expanded .mp-collapsible-arrow {
        transform: rotate(90deg);
    }

    .post-proc-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
        overflow: visible;
    }

    .post-proc-section-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        padding-bottom: 4px;
        border-bottom: 1px solid var(--color-border);
    }

    /* 插件效果区域 */
    .post-proc-plugin-effects {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    /* Toggle 开关 */
    .shading-toggle {
        position: relative;
        width: 36px;
        height: 20px;
        background-color: var(--color-border);
        border-radius: 10px;
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
        flex-shrink: 0;
    }

    .shading-toggle.active {
        background-color: var(--color-accent);
    }

    .shading-toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        background-color: white;
        border-radius: 50%;
        transition: ${createTransition(['transform'])};
        //box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .shading-toggle.active .shading-toggle-thumb {
        transform: translateX(16px);
    }

    /* 颜色预览 */
    .shading-color-preview {
        width: 24px;
        height: 24px;
        border-radius: 4px;
        border: 1px solid var(--color-border);
        flex-shrink: 0;
        cursor: pointer;
        transition: ${createTransition(['transform', 'border-color'])};
    }

    /* 颜色选择器弹窗 */
    .shading-color-picker-popup {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.95);
        padding: 20px;
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        display: flex;
        flex-direction: column;
        gap: 12px;
        z-index: 1000;
        opacity: 0;
        visibility: hidden;
        transition: ${createTransition(['opacity', 'visibility', 'transform'])};
        min-width: 240px;
        //box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }

    .shading-color-picker-popup.visible {
        opacity: 1;
        visibility: visible;
        transform: translate(-50%, -50%) scale(1);
    }

    /* RGB滑块容器 */
    .shading-rgb-slider-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .shading-rgb-label {
        font-size: 12px;
        font-weight: 600;
    }

    .shading-rgb-label-r {
        color: var(--color-axis-x);
    }

    .shading-rgb-label-g {
        color: var(--color-axis-y);
    }

    .shading-rgb-label-b {
        color: var(--color-axis-z);
    }

    .shading-rgb-slider-wrapper {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .shading-rgb-slider {
        flex: 1;
        height: 6px;
        -webkit-appearance: none;
        appearance: none;
        border-radius: 3px;
        outline: none;
        cursor: pointer;
    }

    .shading-rgb-slider::-webkit-slider-thumb,
    .shading-rgb-slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid white;
        //box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .shading-rgb-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        transition: ${createTransition(['transform'])};
    }

    .shading-rgb-slider::-webkit-slider-thumb:active {
        transform: scale(1.1);
    }

    /* RGB滑块颜色 */
    .shading-rgb-label-r + .shading-rgb-slider-wrapper .shading-rgb-slider {
        background: linear-gradient(to right, ${theme.gradientBlack}, ${theme.colorAxisX});
    }

    .shading-rgb-label-r + .shading-rgb-slider-wrapper .shading-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-x);
    }

    .shading-rgb-label-r + .shading-rgb-slider-wrapper .shading-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-x);
    }

    .shading-rgb-label-g + .shading-rgb-slider-wrapper .shading-rgb-slider {
        background: linear-gradient(to right, ${theme.gradientBlack}, ${theme.colorAxisY});
    }

    .shading-rgb-label-g + .shading-rgb-slider-wrapper .shading-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-y);
    }

    .shading-rgb-label-g + .shading-rgb-slider-wrapper .shading-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-y);
    }

    .shading-rgb-label-b + .shading-rgb-slider-wrapper .shading-rgb-slider {
        background: linear-gradient(to right, ${theme.gradientBlack}, ${theme.colorAxisZ});
    }

    .shading-rgb-label-b + .shading-rgb-slider-wrapper .shading-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-z);
    }

    .shading-rgb-label-b + .shading-rgb-slider-wrapper .shading-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-z);
    }

    /* RGB值显示 */
    .shading-rgb-value {
        min-width: 36px;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-secondary);
        text-align: right;
        font-family: monospace;
        background-color: var(--color-bg);
        padding: 4px 8px;
        border-radius: ${theme.borderRadiusSm};
    }

    /* 确定按钮 */
    .shading-color-confirm-btn {
        padding: 8px 16px;
        background-color: var(--color-accent);
        color: white;
        border: none;
        border-radius: ${theme.borderRadiusSm};
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'transform'])};
        margin-top: 4px;
    }

    .shading-color-confirm-btn:active {
        transform: scale(0.98);
    }

    /* 颜色控件行 */
    .post-proc-color-item {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .post-proc-color-label {
        font-size: 13px;
        color: var(--color-text-secondary);
        flex: 1;
    }

    /* 特效分组样式（参照光照控制风格） */
    .post-proc-special-section {
        display: flex;
        flex-direction: column;
        padding: 12px;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
    }

    .post-proc-special-section-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        padding-bottom: 4px;
        border-bottom: 1px solid var(--color-border);
    }

`;
