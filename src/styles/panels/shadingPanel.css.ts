
import { theme, createTransition } from '../theme';

export const shadingPanelStyles = `
    .shading-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .shading-panel-top {
        flex-shrink: 0;
        padding: 0px 6px 2px 6px;
        background-color: var(--color-surface);
        border: none;
        border-radius: 0;
    }

    .shading-render-style-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
    }

    .shading-style-selector-container {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 1px;
    }

    .shading-style-dropdown {
        flex: 1;
    }

    .shading-render-style-label {
        font-size: 13px;
        color: var(--color-text-primary);
        font-weight: 500;
        flex-shrink: 0;
    }

    .shading-render-style-select {
        flex: 1;
        padding: 6px 10px;
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        color: var(--color-text-primary);
        font-size: 13px;
        cursor: pointer;
        outline: none;
        transition: ${createTransition(['border-color'])};
    }

    .shading-render-style-select:focus {
        border-color: var(--color-accent);
    }

    .shading-outline-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 0 6px 0;
    }

    .shading-outline-label {
        font-size: 13px;
        color: var(--color-text-primary);
        font-weight: 500;
        flex-shrink: 0;
    }

    .shading-outline-slider-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
    }

    .shading-outline-slider {
        flex: 1;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background-color: var(--color-border);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
    }

    .shading-outline-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background-color: var(--color-accent);
        cursor: pointer;
    }

    .shading-outline-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background-color: var(--color-accent);
        cursor: pointer;
        border: none;
    }

    .shading-outline-value {
        font-size: 12px;
        color: var(--color-text-secondary);
        min-width: 40px;
        text-align: right;
        font-family: monospace;
    }


    .shading-panel-bottom {
        flex: 1;
        display: flex;
        overflow: hidden;
        gap: 0;
        background-color: var(--color-surface);
    }

    .shading-material-list {
        width: 20%;
        min-width: 100px;
        background-color: transparent;
        border: none;
        border-radius: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }

    .shading-material-list-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 4px 0 0 0;
    }

    .shading-material-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 0 4px 4px;
        border-radius: 6px;
        cursor: pointer;
        user-select: none;
        -webkit-touch-callout: none;
        transition: ${createTransition(['background-color'])};
        margin-bottom: 2px;
    }

    .shading-material-item.selected {
        background-color: ${theme.accentColor}20;
    }

    .shading-material-indicator {
        width: 11px;
        height: 11px;
        border: 1px solid var(--color-text-disabled);
        border-radius: 50%;
        flex-shrink: 0;
        transition: ${createTransition(['border-color', 'background-color'])};
        cursor: pointer;
    }

    .shading-material-indicator.active {
        border-color: var(--color-accent);
        background-color: var(--color-accent);
    }

    .shading-material-indicator.inactive {
        border-color: var(--color-text-disabled);
        background-color: transparent;
    }

    .shading-material-item.selected .shading-material-indicator.active {
        border-color: var(--color-accent);
        background-color: var(--color-accent);
    }

    .shading-material-name {
        font-size: 13px;
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
    }

    .shading-material-params {
        flex: 1;
        background-color: transparent;
        border: none;
        border-radius: 0;
        margin-left: 0;
        padding: 4px;
        overflow-y: auto;
        overflow-x: hidden;
        display: flex;
        flex-direction: column;
    }

    .shading-material-params-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--color-text-disabled);
        font-size: 14px;
    }

    .shading-empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        color: var(--color-text-disabled);
        font-size: 13px;
    }

    .shading-vertical-divider {
        width: 1px;
        background-color: var(--color-border);
        flex-shrink: 0;
    }

    .shading-material-params-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .shading-params-info {
        font-size: 14px;
        color: var(--color-text-primary);
        margin-bottom: 12px;
        flex-shrink: 0;
    }

    .shading-params-scroll {
        flex: 1;
        padding-right: 4px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    /* container 样式 */
    .shading-container {
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        overflow: visible;
    }

    .shading-container-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        background-color: var(--color-bg);
        font-size: 13px;
        color: var(--color-text-primary);
        font-weight: 500;
        height:32px;
        border-radius: ${theme.borderRadiusSm} ${theme.borderRadiusSm} 0 0;
    }

    .shading-container-content {
        padding: 10px;
        overflow: visible;
    }

    /* 滑块行布局 - 左右显示 min/max 值 */
    .shading-slider-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .shading-slider-row .mp-slider-item {
        flex: 1;
    }

    .shading-slider-row .mp-slider-label-row {
        display: none;
    }

    .shading-slider-minmax {
        font-size: 12px;
        color: var(--color-text-secondary);
        min-width: 24px;
        text-align: center;
        font-family: monospace;
    }

    /* 下拉菜单 */
    .shading-dropdown {
        position: relative;
        width: 100%;
    }

    .shading-dropdown-selected {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['border-color', 'background-color'])};
    }

    .shading-dropdown.open .shading-dropdown-selected {
        border-color: var(--color-accent);
    }

    .shading-dropdown-text {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .shading-dropdown-arrow {
        width: 16px;
        height: 16px;
        color: var(--color-accent);
        transition: ${createTransition(['transform'])};
        flex-shrink: 0;
    }

    .shading-dropdown.open .shading-dropdown-arrow {
        transform: rotate(90deg);
    }

    .shading-dropdown-options {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        z-index: 100;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px);
        transition: ${createTransition(['opacity', 'visibility', 'transform'])};
        //box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        max-height: 200px;
        overflow-y: auto;
    }

    .shading-dropdown.open .shading-dropdown-options {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }

    .shading-dropdown-option {
        padding: 8px 12px;
        font-size: 13px;
        color: var(--color-text-primary);
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
        user-select: none;
    }

    .shading-dropdown-option.selected {
        background-color: ${theme.accentColor}20;
        color: var(--color-accent);
    }

    /* Spa 模式按钮 */
    .shading-spa-mode-container {
        display: flex;
        gap: 6px;
    }

    .shading-spa-mode-btn {
        flex: 1;
        padding: 6px 0;
        text-align: center;
        font-size: 12px;
        color: var(--color-text-secondary);
        background-color: var(--color-bg);
        border-radius: 4px;
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['background-color', 'color'])};
    }

    .shading-spa-mode-btn.active {
        background-color: ${theme.accentColor}20;
        color: var(--color-accent);
        font-weight: 500;
    }

    .shading-spa-no-texture {
        font-size: 12px;
        color: var(--color-text-disabled);
        padding: 4px 0;
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

    /* 分组容器标题文字 */
    .shading-container-title-text {
        flex: 1;
    }

    /* 分组内滑块标签 */
    .shading-group-slider-label {
        font-size: 12px;
        color: var(--color-text-secondary);
        min-width: 32px;
        flex-shrink: 0;
    }

    /* 分组内下拉行 */
    .shading-group-dropdown-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
    }

    .shading-group-dropdown-row:first-child {
        margin-top: 0;
    }

    .shading-group-dropdown-label {
        font-size: 12px;
        color: var(--color-text-secondary);
        min-width: 56px;
        flex-shrink: 0;
    }

    .shading-group-dropdown-row .shading-dropdown {
        flex: 1;
    }

    /* 材质项长按菜单（全选/反选） */
    .shading-material-menu {
        position: fixed;
        z-index: 300;
        min-width: 120px;
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        padding: 4px 0;
        //box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        user-select: none;
        -webkit-touch-callout: none;
    }

    .shading-material-menu-item {
        padding: 10px 14px;
        font-size: 13px;
        color: var(--color-text-primary);
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
        user-select: none;
        -webkit-touch-callout: none;
    }

    .shading-material-menu-item:active {
        background-color: ${theme.accentColor}20;
    }
`;
