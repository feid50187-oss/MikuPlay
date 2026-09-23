
import { theme, createTransition } from '../theme';

export const worldPanelStyles = `
    .world-panel {
        display: flex;
        flex-direction: column;
    }

    /* 坐标网 toggle 与下方 world-item 样式一致 */
    .world-panel .mp-toggle-item {
        padding: 8px 20px;
        //background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        margin-bottom: 8px;
        height: 40px;
    }

    .world-item {
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        overflow: visible;
    }

    .world-item .mp-collapsible-arrow {
        width: 20px;
        height: 20px;
        color: var(--color-accent);
    }

    .world-item.expanded .mp-collapsible-arrow {
        transform: rotate(90deg);
    }

    /* 光照控制分区样式 */
    .world-lighting-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
    }

    .world-lighting-section-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        padding-bottom: 4px;
        border-bottom: 1px solid var(--color-border);
    }

    /* 占位区域 */
    .world-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 80px;
        color: var(--color-text-disabled);
        font-size: 13px;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
    }

    /* 地面插件私有滑块已迁移至共享 Slider（.mp-slider），以下 .world-slider* 规则随之废弃删除 */

    /* 颜色选择器项样式 - 与 mp-rgb-picker 保持一致 */
    .world-color-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        position: relative;
    }

    .world-color-label {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    /* 颜色预览 - 与 mp-color-preview 保持一致 */
    .world-color-preview {
        width: 48px;
        height: 32px;
        border-radius: 6px;
        border: 2px solid var(--color-border);
        cursor: pointer;
        transition: ${createTransition(['transform', 'border-color'])};
    }

    /* 颜色选择器弹窗 */- 在worldPanel中居中 */
    .world-color-picker-popup {
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

    .world-color-picker-popup.visible {
        opacity: 1;
        visibility: visible;
        transform: translate(-50%, -50%) scale(1);
    }

    /* RGB滑块容器 */
    .world-rgb-slider-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .world-rgb-label {
        font-size: 12px;
        font-weight: 600;
    }

    .world-rgb-label-r {
        color: var(--color-axis-x);
    }

    .world-rgb-label-g {
        color: var(--color-axis-y);
    }

    .world-rgb-label-b {
        color: var(--color-axis-z);
    }

    .world-rgb-slider-wrapper {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .world-rgb-slider {
        flex: 1;
        height: 6px;
        -webkit-appearance: none;
        appearance: none;
        border-radius: 3px;
        outline: none;
        cursor: pointer;
    }

    .world-rgb-slider::-webkit-slider-thumb,
    .world-rgb-slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid white;
        //box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .world-rgb-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        transition: ${createTransition(['transform'])};
    }

    .world-rgb-slider::-webkit-slider-thumb:active {
        transform: scale(1.1);
    }

    /* RGB滑块颜色 */
    .world-rgb-label-r + .world-rgb-slider-wrapper .world-rgb-slider {
        background: linear-gradient(to right, ${theme.gradientBlack}, ${theme.colorAxisX});
    }

    .world-rgb-label-r + .world-rgb-slider-wrapper .world-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-x);
    }

    .world-rgb-label-r + .world-rgb-slider-wrapper .world-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-x);
    }

    .world-rgb-label-g + .world-rgb-slider-wrapper .world-rgb-slider {
        background: linear-gradient(to right, #000, ${theme.colorAxisY});
    }

    .world-rgb-label-g + .world-rgb-slider-wrapper .world-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-y);
    }

    .world-rgb-label-g + .world-rgb-slider-wrapper .world-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-y);
    }

    .world-rgb-label-b + .world-rgb-slider-wrapper .world-rgb-slider {
        background: linear-gradient(to right, ${theme.gradientBlack}, ${theme.colorAxisZ});
    }

    .world-rgb-label-b + .world-rgb-slider-wrapper .world-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-z);
    }

    .world-rgb-label-b + .world-rgb-slider-wrapper .world-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-z);
    }

    /* RGB值显示 */
    .world-rgb-value,
    .world-fixed-rgb-value {
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
    .world-color-confirm-btn,
    .world-media-remove-btn {
        padding: 8px 16px;
        color: white;
        border: none;
        border-radius: ${theme.borderRadiusSm};
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'transform'])};
        margin-top: 4px;
    }

    .world-color-confirm-btn:active,
    .world-media-remove-btn:active {
        transform: scale(0.98);
    }

    .world-color-confirm-btn {
        background-color: var(--color-accent);
    }

    .world-media-remove-btn {
        background-color: var(--color-axis-x);
    }

    /* 下拉菜单容器 */
    .world-dropdown-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    /* 下拉菜单 */
    .world-dropdown {
        position: relative;
        width: 100%;
    }

    .world-dropdown-selected {
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

    .world-dropdown.open .world-dropdown-selected {
        border-color: var(--color-accent);
    }

    .world-dropdown-text {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .world-dropdown-arrow {
        width: 20px;
        height: 20px;
        color: var(--color-accent);
        transition: ${createTransition(['transform'])};
        flex-shrink: 0;
    }

    .world-dropdown.open .world-dropdown-arrow {
        transform: rotate(90deg);
    }

    /* 下拉选项列表 */
    .world-dropdown-options {
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

    .world-dropdown.open .world-dropdown-options {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }

    .world-dropdown-option {
        padding: 10px 14px;
        font-size: 13px;
        color: var(--color-text-primary);
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
        user-select: none;
    }

    .world-dropdown-option.selected {
        background-color: ${theme.accentColor}20;
        color: var(--color-accent);
    }

    /* 背景参数区容器 */
    .world-background-params {
        //margin-top: 16px;
        padding-top: 8px;
        //border-top: 1px solid var(--color-border);
    }

    /* 颜色背景参数区 */
    .world-background-color-params {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    /* 空白参数区 */
    .world-background-empty-params {
        min-height: 80px;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .world-background-empty-text {
        font-size: 14px;
        color: var(--color-text-secondary);
    }

    /* 环境贴图参数区 */
    .world-environment-params {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    /* 环境贴图预览器 */
    .world-environment-preview,
    .world-media-preview {
        height: 90px;
        width: 100%;
        background-color: var(--color-bg);
        border: 2px dashed var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: ${createTransition(['border-color', 'background-color'])};
        overflow: hidden;
        position: relative;
    }

    .world-environment-preview img,
    .world-media-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: inherit;
    }

    .world-environment-preview-placeholder,
    .world-media-preview-placeholder {
        font-size: 13px;
        color: var(--color-text-disabled);
        text-align: center;
        padding: 20px;
    }

    /* 环境贴图选择器弹窗 */
    .world-envmap-selector-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 20px;
    }

    .world-envmap-selector-dialog {
        background-color: var(--color-surface);
        border-radius: ${theme.borderRadius};
        border: 1px solid var(--color-border);
        max-width: 480px;
        width: 100%;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        //box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }

    .world-envmap-selector-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-primary);
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-border);
    }

    .world-envmap-selector-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        overflow-y: auto;
        max-height: 400px;
    }

    .world-envmap-selector-item {
        display: flex;
        flex-direction: column;
        gap: 8px;
        cursor: pointer;
        padding: 12px;
        border-radius: ${theme.borderRadiusSm};
        transition: ${createTransition(['background-color'])};
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
    }

    .world-envmap-selector-thumbnail {
        height: 100px;
        aspect-ratio: 2 / 1;
        background-color: var(--color-surface);
        border-radius: ${theme.borderRadiusSm};
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: var(--color-text-disabled);
    }

    .world-envmap-selector-thumbnail img {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .world-envmap-selector-name {
        font-size: 13px;
        color: var(--color-text-primary);
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-weight: 500;
    }

    .world-envmap-selector-buttons {
        display: flex;
        gap: 12px;
        padding: 12px 20px;
        border-top: 1px solid var(--color-border);
    }

    .world-envmap-selector-import {
        flex: 1;
        padding: 10px 16px;
        background-color: var(--color-accent);
        border: none;
        border-radius: ${theme.borderRadiusSm};
        color: white;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'transform'])};
    }

    .world-envmap-selector-import:active {
        transform: scale(0.98);
    }

    .world-envmap-selector-close {
        flex: 1;
        padding: 10px 16px;
        background-color: transparent;
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        color: var(--color-text-secondary);
        font-size: 14px;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'color', 'border-color'])};
    }

    /* 提示消息 */
    .world-toast {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        color: var(--color-text-primary);
        font-size: 14px;
        font-weight: 500;
        //box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        z-index: 2000;
        animation: worldToastIn 0.3s ease;
    }

    .world-toast.loading {
        background-color: var(--color-accent);
        color: white;
        border-color: var(--color-accent);
    }

    @keyframes worldToastIn {
        from {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    }

    /* 固定RGB滑块容器（用于背景颜色） */
    .world-fixed-rgb-slider-container {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .world-fixed-rgb-label {
        font-size: 13px;
        font-weight: 600;
        min-width: 20px;
        text-align: center;
    }

    .world-fixed-rgb-label-r {
        color: var(--color-axis-x);
    }

    .world-fixed-rgb-label-g {
        color: var(--color-axis-y);
    }

    .world-fixed-rgb-label-b {
        color: var(--color-axis-z);
    }

    .world-fixed-rgb-slider-wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .world-fixed-rgb-slider {
        flex: 1;
        height: 6px;
        -webkit-appearance: none;
        appearance: none;
        border-radius: 3px;
        outline: none;
        cursor: pointer;
    }

    .world-fixed-rgb-slider::-webkit-slider-thumb,
    .world-fixed-rgb-slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid white;
        //box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .world-fixed-rgb-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        transition: ${createTransition(['transform'])};
    }

    .world-fixed-rgb-slider::-webkit-slider-thumb:active {
        transform: scale(1.1);
    }

    /* 固定RGB滑块颜色 - R */
    .world-fixed-rgb-label-r + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider {
        background: linear-gradient(to right, ${theme.gradientBlack}, ${theme.colorAxisX});
    }

    .world-fixed-rgb-label-r + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-x);
    }

    .world-fixed-rgb-label-r + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-x);
    }

    /* 固定RGB滑块颜色 - G */
    .world-fixed-rgb-label-g + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider {
        background: linear-gradient(to right, #000, ${theme.colorAxisY});
    }

    .world-fixed-rgb-label-g + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-y);
    }

    .world-fixed-rgb-label-g + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-y);
    }

    /* 固定RGB滑块颜色 - B */
    .world-fixed-rgb-label-b + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider {
        background: linear-gradient(to right, ${theme.gradientBlack}, ${theme.colorAxisZ});
    }

    .world-fixed-rgb-label-b + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider::-webkit-slider-thumb {
        background: var(--color-axis-z);
    }

    .world-fixed-rgb-label-b + .world-fixed-rgb-slider-wrapper .world-fixed-rgb-slider::-moz-range-thumb {
        background: var(--color-axis-z);
    }

    /* 粒子参数区 */
    .world-particle-params {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 8px;
    }

    /* Alpha滑块样式 */
    .world-rgb-label-alpha {
        color: var(--color-text-secondary);
    }

    .world-rgb-label-alpha + .world-rgb-slider-wrapper .world-rgb-slider {
        background: linear-gradient(to right, transparent, ${theme.textPrimary});
    }

    .world-rgb-label-alpha + .world-rgb-slider-wrapper .world-rgb-slider::-webkit-slider-thumb {
        background: var(--color-text-secondary);
    }

    .world-rgb-label-alpha + .world-rgb-slider-wrapper .world-rgb-slider::-moz-range-thumb {
        background: var(--color-text-secondary);
    }

    /* 矢量输入项样式 */
    .world-vector-item {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 0;
    }

    .world-vector-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-secondary);
    }

    .world-vector-inputs {
        display: flex;
        gap: 8px;
    }

    .world-vector-component {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .world-vector-component-label {
        font-size: 11px;
        font-weight: 600;
        text-align: center;
    }

    .world-vector-component-label-x {
        color: var(--color-axis-x);
    }

    .world-vector-component-label-y {
        color: var(--color-axis-y);
    }

    .world-vector-component-label-z {
        color: var(--color-axis-z);
    }

    .world-vector-component-input {
        width: 100%;
        padding: 6px 8px;
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        color: var(--color-text-primary);
        font-size: 12px;
        font-family: monospace;
        text-align: center;
        transition: ${createTransition(['border-color', 'background-color'])},
        -moz-appearance: textfield;
    }

    .world-vector-component-input::-webkit-outer-spin-button,
    .world-vector-component-input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    .world-vector-component-input:focus {
        outline: none;
        border-color: var(--color-accent);
        background-color: var(--color-surface);
    }

    /* 媒体背景控制区 */
    .world-media-controls {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .world-media-controls .world-item {
        border: none;
        background: transparent;
    }

    .world-media-controls .world-toggle-item {
        padding: 8px 12px;
    }

    .world-media-controls .world-slider-item {
        padding: 4px 0;
    }

    .world-media-controls .world-vector-item {
        padding: 4px 0;
    }

    /* 视频控制区 */
    .world-media-video-controls {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-top: 6px;
        border-top: 1px solid var(--color-border);
        margin-top: 4px;
    }

    .world-media-video-controls .world-item {
        border: none;
        background: transparent;
    }

    .world-media-video-controls .world-toggle-item {
        padding: 8px 12px;
    }

    .world-media-video-controls .world-slider-item {
        padding: 4px 0;
    }

    /* 带 overflow-visible 的 world-item：
       折叠态保持 overflow: hidden 以正常收起内容，
       展开态使用 overflow: visible 以允许下拉框溢出显示。 */
    .world-item.overflow-visible:not(.expanded) .mp-collapsible-content {
        overflow: hidden;
    }

    .world-item.overflow-visible.expanded {
        overflow: visible;
    }

    .world-item.overflow-visible.expanded .mp-collapsible-content {
        overflow: visible;
    }

    .world-ground-params {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 8px;       
    }

    .world-ground-private-params {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 8px;
        border-top: 1px solid var(--color-border);
    }
`;
