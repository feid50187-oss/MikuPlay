
import { theme } from '../theme';

export const collapsibleStyles = `
    .mp-collapsible-section {
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        overflow: visible;
        margin-bottom: 8px;
    }

    .mp-collapsible-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 14px;
        cursor: pointer;
        user-select: none;
        min-height: ${theme.touchTargetMin};
        min-width: 0;
        overflow: hidden;
        transition: background ${theme.transitionFast};
    }

    .mp-collapsible-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
    }

    .mp-collapsible-arrow {
        transition: transform 0.2s ease;
    }

    .mp-collapsible-content {
        display: grid;
        grid-template-rows: minmax(0px, 0fr);
        overflow: hidden;
        transition: grid-template-rows 0.3s ease;
    }

    .mp-collapsible-inner {
        min-height: 0;
        min-width: 0;
        overflow: hidden;
        padding: 0 14px;
    }

    .mp-collapsible-section.expanded > .mp-collapsible-content {
        grid-template-rows: minmax(0px, 1fr);
    }

    .mp-collapsible-section.expanded > .mp-collapsible-content > .mp-collapsible-inner {
        overflow-x: clip;
        overflow-y: visible;
    }

    /* 带 overflow-visible 的折叠面板：
       折叠态保持 overflow: hidden 以正常收起内容，
       展开态使用 overflow: visible 以允许下拉框溢出显示。 */
    .mp-collapsible-section.overflow-visible:not(.expanded) .mp-collapsible-content {
        overflow: hidden;
    }

    .mp-collapsible-section.overflow-visible.expanded {
        overflow: visible;
    }

    .mp-collapsible-section.overflow-visible.expanded .mp-collapsible-content {
        overflow: visible;
    }
`;
