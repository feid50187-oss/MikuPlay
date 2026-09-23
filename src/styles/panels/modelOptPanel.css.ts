
import { theme, createTransition } from '../theme';

export const modelOptPanelStyles = `
    .model-opt-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .model-opt-panel-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        display: flex;
        flex-direction: column;
        //gap: 12px;
        padding-bottom: 8px;
    }

    .model-opt-section {
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        overflow: hidden;
        flex-shrink: 0;
    }

    .model-opt-section .mp-collapsible-header:active {
        background-color: var(--color-bg);
    }

    .model-opt-section .mp-collapsible-arrow {
        width: 20px;
        height: 20px;
        color: var(--color-accent);
        transition: ${createTransition(['transform'])};
        flex-shrink: 0;
    }

    .model-opt-section.expanded .mp-collapsible-arrow {
        transform: rotate(90deg);
    }

    .model-opt-bone-tree {
        padding: 0 8px 8px 8px;
        width: 100%;
        min-width: 0;
        max-height: 25vh;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .model-opt-empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        color: var(--color-text-disabled);
        font-size: 13px;
    }

    .model-opt-bone-entry {
        margin-bottom: 4px;
    }

    .model-opt-bone-entry.disabled {
        opacity: 0.5;
    }

    .model-opt-bone-entry.disabled .model-opt-bone-row {
        cursor: not-allowed;
    }

    .model-opt-bone-entry.selected > .model-opt-bone-row,
    .model-opt-bone-item.selected > .model-opt-bone-row {
        background-color: ${theme.accentColor}20;
    }

    .model-opt-bone-row,
    .model-opt-morph-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-radius: 4px;
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['background-color'])};
    }

    .model-opt-circle-controller {
        width: 8px;
        height: 8px;
        border: 1px solid var(--color-text-disabled);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: ${createTransition(['border-color', 'background-color'])};
        cursor: pointer;
    }

    .model-opt-circle-controller.enabled {
        border-color: var(--color-accent);
        background-color: var(--color-accent);
    }

    .model-opt-expand-icon {
        width: 16px;
        height: 16px;
        color: var(--color-accent);
        transition: ${createTransition(['transform'])};
        flex-shrink: 0;
        cursor: pointer;
    }

    .model-opt-bone-entry.expanded > .model-opt-bone-row .model-opt-expand-icon,
    .model-opt-bone-item.expanded > .model-opt-bone-row .model-opt-expand-icon,
    .model-opt-morph-entry.expanded > .model-opt-morph-row .model-opt-expand-icon,
    .model-opt-morph-category.expanded > .model-opt-morph-category-header .model-opt-expand-icon {
        transform: rotate(90deg);
    }

    .model-opt-bone-name,
    .model-opt-morph-name {
        font-size: 13px;
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .model-opt-ik-btn {
        padding: 2px 8px;
        font-size: 11px;
        border: 1px solid var(--color-border);
        border-radius: 3px;
        background-color: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        margin-left: auto;
        flex-shrink: 0;
        transition: ${createTransition(['background-color', 'color', 'border-color'])};
    }

    .model-opt-ik-btn.active {
        background-color: var(--color-accent);
        border-color: var(--color-accent);
        color: white;
    }

    .model-opt-bone-children {
        display: grid;
        grid-template-rows: minmax(0px, 0fr);
        overflow: hidden;
        transition: grid-template-rows 0.3s ease;
        padding-left: 8px;
    }

    .model-opt-bone-children-inner {
        min-height: 0;
        overflow: hidden;
    }

    .model-opt-bone-entry.expanded > .model-opt-bone-children,
    .model-opt-bone-item.expanded > .model-opt-bone-children {
        grid-template-rows: minmax(0px, 1fr);
    }

    .model-opt-bone-entry.expanded > .model-opt-bone-children > .model-opt-bone-children-inner,
    .model-opt-bone-item.expanded > .model-opt-bone-children > .model-opt-bone-children-inner {
        overflow: visible;
    }

    .model-opt-bone-item {
        margin-left: 0;
    }

    .model-opt-morph-tree {
        padding: 0 8px 8px 8px;
        min-width: 0;
    }

    .model-opt-morph-entry {
        margin-bottom: 4px;
    }

    .model-opt-morphs-container {
        display: grid;
        grid-template-rows: minmax(0px, 0fr);
        overflow: hidden;
        transition: grid-template-rows 0.3s ease;
    }

    .model-opt-morphs-inner {
        min-height: 0;
        overflow: hidden;
    }

    .model-opt-morph-entry.expanded > .model-opt-morphs-container {
        grid-template-rows: minmax(0px, 1fr);
    }

    .model-opt-morph-entry.expanded > .model-opt-morphs-container > .model-opt-morphs-inner {
        overflow: visible;
    }

    // .model-opt-morph-category {
    //     margin-bottom: 2px;
    // }

    .model-opt-morph-category-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 12px;
        cursor: pointer;
        user-select: none;
        border-radius: 4px;
        transition: background-color 0.2s;
    }

    .model-opt-morph-category-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .model-opt-morph-category-content {
        display: grid;
        grid-template-rows: minmax(0px, 0fr);
        overflow: hidden;
        transition: grid-template-rows 0.3s ease;
    }

    .model-opt-morph-category-inner {
        min-height: 0;
        overflow: hidden;
        padding: 0 40px; /* 两侧留出操作空间，避免误触 */
    }

    .model-opt-morph-category.expanded > .model-opt-morph-category-content {
        grid-template-rows: minmax(0px, 1fr);
    }

    .model-opt-morph-category.expanded > .model-opt-morph-category-content > .model-opt-morph-category-inner {
        overflow: visible;
    }

    .model-opt-skeleton-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        margin-bottom: 8px;
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['background-color'])};
    }

    .model-opt-skeleton-toggle:active {
        background-color: var(--color-bg);
    }

    .model-opt-skeleton-toggle-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .model-opt-skeleton-toggle-track {
        width: 40px;
        height: 22px;
        background-color: var(--color-border);
        border-radius: 11px;
        position: relative;
        transition: ${createTransition(['background-color'])};
        flex-shrink: 0;
    }

    .model-opt-skeleton-toggle-track.active {
        background-color: var(--color-accent);
    }

    .model-opt-skeleton-toggle-thumb {
        width: 18px;
        height: 18px;
        background-color: white;
        border-radius: 50%;
        position: absolute;
        top: 2px;
        left: 2px;
        transition: ${createTransition(['transform'])};
        //box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .model-opt-skeleton-toggle-track.active .model-opt-skeleton-toggle-thumb {
        transform: translateX(18px);
    }

    .model-opt-bottom-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 2px 0px 4px;
        background-color: var(--color-surface);
        flex-shrink: 0;
        margin-top: auto;
    }

    .model-opt-mode-toggle {
        display: flex;
        background-color: var(--color-bg);
        border-radius: 6px;
        overflow: hidden;
    }

    .model-opt-mode-btn {
        padding: 3px 6px;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['background-color', 'color'])};
    }

    .model-opt-mode-btn.active {
        background-color: var(--color-accent);
        color: white;
    }

    .model-opt-axis-selector {
        display: flex;
        gap: 4px;
    }

    .model-opt-axis-btn {
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 600;
        color: var(--color-text-primary);
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 50%;
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['background-color', 'color', 'border-color'])};
    }

    .model-opt-axis-btn.active {
        background-color: var(--color-accent);
        color: white;
        border-color: var(--color-accent);
    }

    .model-opt-axis-btn.x {
        color: var(--color-axis-x);
    }

    .model-opt-axis-btn.x.active {
        color: white;
        background-color: var(--color-axis-x);
        border-color: var(--color-axis-x);
    }

    .model-opt-axis-btn.y {
        color: var(--color-axis-y);
    }

    .model-opt-axis-btn.y.active {
        color: white;
        background-color: var(--color-axis-y);
        border-color: var(--color-axis-y);
    }

    .model-opt-axis-btn.z {
        color: var(--color-axis-z);
    }

    .model-opt-axis-btn.z.active {
        color: white;
        background-color: var(--color-axis-z);
        border-color: var(--color-axis-z);
    }

    .model-opt-value-controller {
        display: flex;
        align-items: center;
        flex: 1;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadius};
        overflow: hidden;
    }

    .model-opt-value-arrow {
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-secondary);
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['background-color', 'color'])};
    }

    .model-opt-value-arrow svg {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
    }

    .model-opt-value-arrow.left svg {
        transform: rotate(180deg);
    }

    .model-opt-value-input {
        flex: 1;
        min-width: 80px;
        text-align: center;
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        background: transparent;
        border: none;
        outline: none;
    }

    .bone-correction-selected {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .bone-correction-selected.has-selection {
        color: var(--color-accent);
        font-weight: 500;
    }

    .bone-correction-sliders {
        padding: 0px 6px;
        display: flex;
        flex-direction: column;
        //gap: 12px;
    }

    .bone-correction-slider-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .bone-correction-label {
        font-size: 12px;
        font-weight: 600;
        min-width: 40px;
    }

    .bone-correction-buttons {
        display: flex;
        gap: 8px;
        padding: 8px 12px;
    }

    .bone-correction-reset-btn {
        flex: 1;
        padding: 8px 16px;
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        color: var(--color-text-primary);
        font-size: 13px;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'border-color'])};
    }

    .bone-correction-reset-btn:active {
        background-color: ${theme.accentColor}20;
    }

    .bone-correction-apply-btn {
        flex: 1;
        padding: 8px 16px;
        background-color: var(--color-accent);
        border: none;
        border-radius: ${theme.borderRadius};
        color: white;
        font-size: 13px;
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
    }

    .bone-correction-apply-btn:active {
        opacity: 0.8;
    }

    .bone-correction-toast {
        margin: 0 12px 8px;
        padding: 8px 12px;
        background-color: ${theme.accentColor}20;
        border: 1px solid var(--color-accent);
        border-radius: ${theme.borderRadius};
        color: var(--color-accent);
        font-size: 12px;
        text-align: center;
        transition: opacity 0.3s ease;
        opacity: 0;
    }

    .bone-correction-toast.show {
        opacity: 1;
    }

    .bone-correction-current-frame-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-accent);
    }

    .bone-correction-info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 6px;
        gap: 8px;
    }

    .bone-correction-hint {
        padding: 4px 6px;
        font-size: 11px;
        color: var(--color-text-secondary);
        opacity: 0.65;
        line-height: 1.4;
    }

    .bone-correction-info-item {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--color-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .bone-correction-info-label {
        font-size: 12px;
        color: var(--color-text-secondary);
        flex-shrink: 0;
    }

    .bone-correction-frame-input {
        width: 46px;
        padding: 4px 6px;
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        background-color: var(--color-bg);
        color: var(--color-text-primary);
        font-size: 12px;
        text-align: center;
    }

    .bone-correction-frame-input:focus {
        border-color: var(--color-accent);
        outline: none;
    }

    .bone-correction-frame-separator {
        font-size: 12px;
        color: var(--color-text-secondary);
       //margin: 0 4px;
    }

    .bone-correction-slider-row .mp-slider-item {
        flex: 1;
        min-width: 0;
    }
`;