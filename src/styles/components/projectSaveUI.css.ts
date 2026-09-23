import { theme, createTransition } from '../theme';

export const projectSaveUIStyles = `
    .project-save-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: var(--color-overlay-bg);
        z-index: 65535;
        opacity: 0;
        pointer-events: none;
        transition: ${createTransition(['opacity'])};
    }

    .project-save-overlay.visible {
        opacity: 1;
        pointer-events: auto;
    }

    .project-save-panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.9);
        background-color: var(--color-surface);
        border-radius: ${theme.borderRadiusLg};
        width: 90%;
        max-width: 420px;
        max-height: 85vh;
        overflow: hidden;
        opacity: 0;
        transition: ${createTransition(['opacity', 'transform'])};
        contain: layout paint;
        z-index: 65536;
    }

    .project-save-panel.open {
        opacity: 1;
        pointer-events: auto;
        transform: translate(-50%, -50%) scale(1);
    }

    .project-save-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-border);
    }

    .project-save-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .project-save-close-btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: 50%;
        background-color: transparent;
        cursor: pointer;
        color: var(--color-text-secondary);
        transition: ${createTransition(['background-color', 'color'])};
        padding: 0;
    }

    .project-save-close-btn svg {
        width: 20px;
        height: 20px;
    }

    /* Tab 栏 */
    .project-save-tab-bar {
        display: flex;
        position: relative;
        border-bottom: 1px solid var(--color-border);
    }

    .project-save-tab-btn {
        flex: 1;
        padding: 12px 0;
        text-align: center;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: color 0.2s;
        background: transparent;
        border: none;
        color: var(--color-text-secondary);
    }

    .project-save-tab-btn.active {
        color: var(--color-accent);
    }

    .project-save-tab-indicator {
        position: absolute;
        bottom: 0;
        height: 2px;
        background: var(--color-accent);
        transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 1px;
    }

    /* Content */
    .project-save-content {
        padding: 20px;
        overflow-y: auto;
        max-height: calc(85vh - 180px);
        -webkit-overflow-scrolling: touch;
    }

    /* 保存页面 */
    .project-save-path-label {
        font-size: 13px;
        color: var(--color-text-secondary);
        margin-bottom: 4px;
    }

    .project-save-path-value {
        font-size: 12px;
        color: var(--color-text-disabled);
        margin-bottom: 16px;
        word-break: break-all;
    }

    .project-save-name-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        margin-bottom: 6px;
    }

    .project-save-name-input {
        width: 100%;
        padding: 10px 14px;
        font-size: 14px;
        color: var(--color-text-primary);
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        outline: none;
        transition: ${createTransition(['border-color'])};
        box-sizing: border-box;
    }

    .project-save-name-input:focus {
        border-color: var(--color-accent);
    }

    .project-save-info-box {
        margin-top: 16px;
        padding: 12px;
        background: var(--color-bg);
        border-radius: 6px;
    }

    .project-save-info-row {
        font-size: 13px;
        color: var(--color-text-secondary);
        line-height: 1.8;
    }

    /* 读取页面 */
    .project-save-archive-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .project-save-archive-item {
        padding: 12px;
        background: var(--color-bg);
        border-radius: 6px;
        cursor: pointer;
        transition: background-color 0.2s;
        border: 2px solid transparent;
    }

    .project-save-archive-item.selected {
        border-color: var(--color-accent);
        background: ${theme.accentColor}10;
    }

    .project-save-archive-item.corrupt {
        opacity: 0.7;
        cursor: default;
    }
    .project-save-archive-item.corrupt.selected {
        border-color: var(--color-warning, #e67e22);
    }

    .project-save-archive-name {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .project-save-archive-meta {
        font-size: 12px;
        color: var(--color-text-secondary);
        margin-top: 4px;
    }

    .project-save-archive-empty {
        padding: 32px;
        text-align: center;
        color: var(--color-text-disabled);
        font-size: 13px;
    }

    /* Footer */
    .project-save-footer {
        padding: 16px 20px;
        border-top: 1px solid var(--color-border);
        display: flex;
        gap: 12px;
    }

    .project-save-primary-btn {
        flex: 1;
        padding: 12px 24px;
        font-size: 16px;
        font-weight: 600;
        color: white;
        background-color: var(--color-accent);
        border: none;
        border-radius: ${theme.borderRadius};
        cursor: pointer;
        transition: ${createTransition(['background-color', 'transform'])};
    }

    .project-save-primary-btn:active {
        transform: scale(0.98);
    }

    .project-save-primary-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .project-save-secondary-btn {
        padding: 12px 24px;
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        cursor: pointer;
        transition: ${createTransition(['background-color', 'transform'])};
    }

    .project-save-secondary-btn:active {
        transform: scale(0.98);
    }

    .project-save-secondary-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;
