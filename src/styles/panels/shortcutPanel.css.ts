import { theme, createTransition, rgba } from '../theme';

export const shortcutPanelStyles = `
    .shortcut-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow-y: auto;
    }

    /* 折叠面板内部控件间距 */
    .shortcut-controls {
        display: flex;
        flex-direction: column;
        padding: 4px 0 8px;
    }

    .bone-parenting-hint {
        font-size: 11px;
        color: var(--color-warning);
        padding: 4px 6px;
        background-color: var(--color-warning-bg);
        border-radius: ${theme.borderRadius};
        margin-bottom: 8px;
    }

    .bone-parenting-binding-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 8px;
    }

    .bone-parenting-empty {
        font-size: 12px;
        color: var(--color-text-secondary);
        padding: 8px 6px;
        text-align: center;
    }

    .bone-parenting-binding-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background-color: var(--color-bg);
        border-radius: 4px;
        font-size: 12px;
    }

    .bone-parenting-binding-info {
        flex: 1;
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .bone-parenting-toggle-btn {
        padding: 2px 8px;
        font-size: 11px;
        border: 1px solid var(--color-border);
        border-radius: 3px;
        background-color: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: ${createTransition(['background-color', 'color', 'border-color'])};
    }

    .bone-parenting-toggle-btn.active {
        background-color: var(--color-accent);
        border-color: var(--color-accent);
        color: white;
    }

    .bone-parenting-remove-btn {
        padding: 2px 6px;
        font-size: 11px;
        border: none;
        border-radius: 3px;
        background-color: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .bone-parenting-divider {
        height: 1px;
        background-color: var(--color-border);
        margin: 8px 0;
    }

    .bone-parenting-add-title {
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-primary);
        margin-bottom: 8px;
    }

    .bone-parenting-add-btn {
        width: 100%;
        padding: 8px 16px;
        margin-top: 8px;
        background-color: var(--color-accent);
        border: none;
        border-radius: ${theme.borderRadius};
        color: white;
        font-size: 13px;
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
    }

    .bone-parenting-add-btn:active {
        opacity: 0.8;
    }

    /* 覆盖折叠面板的overflow，允许下拉框溢出显示 */
    .bone-parenting-section .mp-collapsible-content {
        overflow: visible;
    }

    /* 全局提示文本 */
    .shortcut-global-hint {
        font-size: 12px;
        color: var(--color-text-secondary);
        padding: 4px 0 8px;
        margin-bottom: 4px;
        border-bottom: 1px solid var(--color-border);
    }
`;
