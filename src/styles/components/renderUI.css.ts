
import { theme, createTransition } from '../theme';

export const renderUIStyles = `
    .render-ui-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: var(--color-overlay-bg);
        z-index: 1000;
        opacity: 0;
        pointer-events: none;
        transition: ${createTransition(['opacity'])};
    }

    .render-ui-overlay.visible {
        opacity: 1;
        pointer-events: auto;
    }

    .render-ui-panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.9);
        background-color: var(--color-surface);
        border-radius: ${theme.borderRadiusLg};
        //box-shadow: ${theme.shadowLg};
        width: 90%;
        max-width: 480px;
        max-height: 90vh;
        overflow: hidden;
        //z-index: 1001;
        opacity: 0;
        //pointer-events: none;
        transition: ${createTransition(['opacity', 'transform'])};
        contain: layout paint;
    }

    .render-ui-panel.open {
        opacity: 1;
        pointer-events: auto;
        transform: translate(-50%, -50%) scale(1);
    }

    .render-ui-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-border);
    }

    .render-ui-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .render-ui-close-btn {
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

    .render-ui-close-btn svg {
        width: 20px;
        height: 20px;
    }

    .render-ui-content {
        padding: 20px;
        overflow-y: auto;
        max-height: calc(90vh - 140px);
        -webkit-overflow-scrolling: touch;
    }

    .render-ui-section {
        margin-bottom: 8px;
    }

    .render-ui-section:last-child {
        margin-bottom: 0;
    }

    .render-ui-label {
        display: block;
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        margin-bottom: 8px;
    }

    .render-ui-dropdown {
        position: relative;
    }

    .render-ui-dropdown-selected {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['border-color', 'background-color'])};
    }

    .render-ui-dropdown-text {
        font-size: 14px;
        color: var(--color-text-primary);
    }

    .render-ui-dropdown-arrow {
        width: 20px;
        height: 20px;
        color: var(--color-text-secondary);
        transition: ${createTransition(['transform'])};
    }

    .render-ui-dropdown.open .render-ui-dropdown-arrow {
        transform: rotate(180deg);
    }

    .render-ui-dropdown-options {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        margin-top: 4px;
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        //box-shadow: ${theme.shadowMd};
        max-height: 200px;
        overflow-y: auto;
        z-index: 10;
        opacity: 0;
        pointer-events: none;
        transform: translateY(-8px);
        transition: ${createTransition(['opacity', 'transform'])};
    }

    .render-ui-dropdown.open .render-ui-dropdown-options {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
    }

    .render-ui-dropdown-option {
        padding: 10px 14px;
        font-size: 14px;
        color: var(--color-text-primary);
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['background-color'])};
    }

    .render-ui-dropdown-option.selected {
        background-color: ${theme.accentColor}20;
        color: var(--color-accent);
    }

    .render-ui-inputs-row {
        display: flex;
        gap: 12px;
        align-items: flex-end;
        position: relative;
    }

    .render-ui-input-group {
        flex: 1;
    }

    .render-ui-exchange-btn {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        border-radius: ${theme.borderRadiusSm};
        background-color: transparent;
        cursor: pointer;
        color: var(--color-accent);
        padding: 0;
        flex-shrink: 0;
        position: relative;
        top: -2px;
        transition: ${createTransition(['transform'])};
    }

    .render-ui-exchange-btn svg {
        width: 24px;
        height: 24px;
    }

    .render-ui-exchange-btn:active {
        transform: scale(0.9);
    }

    .render-ui-frame-range-separator {
        display: flex;
        align-items: center;
        height: 41px;
        font-size: 14px;
        color: var(--color-text-secondary);
        flex-shrink: 0;
    }

    .render-ui-preset-buttons-row {
        display: flex;
        gap: 8px;
        margin-top: 12px;
    }

    .render-ui-preset-btn {
        flex: 1;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-primary);
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        cursor: pointer;
        transition: none;
    }

    .render-ui-preset-btn:active {
        transform: scale(0.98);
        background-color: ${theme.accentColor}20;
    }

    .render-ui-input-label {
        display: block;
        font-size: 12px;
        color: var(--color-text-secondary);
        margin-bottom: 4px;
    }

    .render-ui-input {
        width: 100%;
        padding: 10px 14px;
        font-size: 14px;
        color: var(--color-text-primary);
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        outline: none;
        transition: ${createTransition(['border-color'])};
    }

    .render-ui-input:focus {
        border-color: var(--color-accent);
    }

    .render-ui-resolution-hint {
        font-size: 12px;
        color: var(--color-text-secondary);
        margin-top: 8px;
        font-style: italic;
    }

    .render-ui-footer {
        padding: 16px 20px;
        border-top: 1px solid var(--color-border);
    }

    .render-ui-start-btn {
        width: 100%;
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

    .render-ui-start-btn:active {
        transform: scale(0.98);
    }
`;
