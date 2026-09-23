
import { theme, createTransition } from '../theme';

export const filePickerUIStyles = `
    .file-picker-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: var(--color-overlay-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        opacity: 0;
        visibility: hidden;
        transition: ${createTransition(['opacity', 'visibility'])};
    }

    .file-picker-overlay.visible {
        opacity: 1;
        visibility: visible;
    }

    .file-picker-container {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 90%;
        max-width: 480px;
        max-height: 90vh;
        background-color: var(--color-surface);
        border-radius: ${theme.borderRadiusLg};
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        transition: ${createTransition(['opacity', 'transform'])};
        contain: layout paint;
    }

    .file-picker-overlay.visible .file-picker-container {
        opacity: 1;
    }

    .file-picker-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 13px 20px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .file-picker-title {
        font-size: 18px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .file-picker-close {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: none;
        background-color: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: ${createTransition(['background-color'])};
        padding: 0;
    }

    .file-picker-close svg {
        width: 24px;
        height: 24px;
        color: var(--color-text-secondary);
    }

    .file-picker-path {
        padding: 6px 20px;
        background-color: var(--color-bg);
        border-bottom: 1px solid var(--color-border);
        font-size: 13px;
        color: var(--color-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex-shrink: 0;
    }

    .file-picker-list {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }

    .file-picker-item {
        display: flex;
        align-items: center;
        padding: 8px 20px;
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
        border-bottom: 1px solid var(--color-item-border);
    }

    .file-picker-item:active {
        background-color: var(--color-active-bg);
    }

    .file-picker-icon {
        width: 32px;
        height: 32px;
        margin-right: 12px;
        flex-shrink: 0;
    }

    .file-picker-icon svg {
        width: 100%;
        height: 100%;
    }

    .file-picker-icon.folder svg {
        color: var(--color-accent);
    }

    .file-picker-icon.file svg {
        color: var(--color-accent);
    }

    .file-picker-info {
        flex: 1;
        min-width: 0;
    }

    .file-picker-name {
        font-size: 15px;
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .file-picker-meta {
        font-size: 12px;
        color: var(--color-muted-meta);
        margin-top: 2px;
    }

    .file-picker-footer {
        padding: 10px 20px;
        border-top: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .file-picker-back-button {
        width: 100%;
        padding: 8px 16px;
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        background-color: var(--color-surface);
        color: var(--color-text-secondary);
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: ${createTransition(['border-color', 'color', 'background-color'])};
    }

    .file-picker-back-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .file-picker-back-button svg {
        width: 20px;
        height: 20px;
    }

    .file-picker-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        color: var(--color-text-disabled);
    }

    .file-picker-empty svg {
        width: 48px;
        height: 48px;
        margin-bottom: 12px;
        opacity: 0.5;
    }

    .file-picker-empty-text {
        font-size: 14px;
    }

    .file-picker-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
    }

    .file-picker-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--color-spinner-border);
        border-top-color: var(--color-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    .file-picker-web-root {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        text-align: center;
        gap: 8px;
    }

    .file-picker-web-root svg {
        color: var(--color-text-secondary);
        margin-bottom: 8px;
    }

    .file-picker-web-root-text {
        font-size: 15px;
        color: var(--color-text-primary);
    }

    .file-picker-web-root-hint {
        font-size: 12px;
        color: var(--color-text-disabled);
        margin-bottom: 16px;
    }

    .file-picker-web-root-btn {
        padding: 10px 28px;
        border: none;
        border-radius: ${theme.borderRadiusSm};
        background-color: var(--color-accent);
        color: white;
        font-size: 14px;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'opacity'])};
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    // ── 横屏适配：降低整体高度占用，确保底部"返回上一级"按钮可见 ──
    @media (orientation: landscape) and (max-height: 500px) {
        .file-picker-container {
            max-height: 95vh;
        }

        .file-picker-header {
            padding: 8px 16px;
        }

        .file-picker-title {
            font-size: 16px;
        }

        .file-picker-close {
            width: 28px;
            height: 28px;
        }

        .file-picker-path {
            padding: 6px 16px;
            font-size: 12px;
        }

        .file-picker-item {
            padding: 6px 16px;
        }

        .file-picker-icon {
            width: 24px;
            height: 24px;
            margin-right: 10px;
        }

        .file-picker-name {
            font-size: 14px;
        }

        .file-picker-meta {
            font-size: 11px;
            margin-top: 0;
        }

        .file-picker-footer {
            padding: 6px 16px;
        }

        .file-picker-back-button {
            padding: 8px 12px;
            font-size: 13px;
        }

        .file-picker-back-button svg {
            width: 18px;
            height: 18px;
        }

        .file-picker-empty,
        .file-picker-loading {
            padding: 20px 16px;
        }

        .file-picker-web-root {
            padding: 20px 16px;
        }
    }
`;
