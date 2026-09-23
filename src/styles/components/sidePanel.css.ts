
import { theme, createTransition } from '../theme';

export const sidePanelStyles = `
    .side-panel-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--color-overlay-bg);
        opacity: 0;
        visibility: hidden;
        transition: ${createTransition(['opacity', 'visibility'])};
        z-index: 999;
    }

    .side-panel-overlay.visible {
        opacity: 1;
        visibility: visible;
    }

    .side-panel {
        position: fixed;
        top: 0;
        left: 0;
        width: 280px;
        height: 100%;
        background-color: var(--color-surface);
        transform: translateX(-100%);
        transition: ${createTransition(['transform'])};
        z-index: 1000;
        display: flex;
        flex-direction: column;
        will-change: transform;
        /* 使用原生注入的安全区CSS变量 */
        padding-top: var(--safe-area-top, 0px);
        padding-bottom: var(--safe-area-bottom, 0px);
        contain: layout paint style;
    }

    .side-panel.open {
        transform: translateX(0);
    }

    .side-panel-header {
        height: ${theme.topBarHeight};
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 16px;
        border-bottom: 1px solid var(--color-border);
    }

    .side-panel-theme-toggle {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        color: var(--color-accent);
        transition: ${createTransition(['background-color', 'transform'])};
        padding: 0;
    }

    .side-panel-theme-toggle:active {
        transform: scale(0.92);
    }

    .side-panel-theme-toggle svg {
        display: block;
    }

    .side-panel-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .side-panel-save-toggle {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        color: var(--color-accent);
        transition: ${createTransition(['background-color', 'transform'])};
        padding: 0;
    }

    .side-panel-save-toggle:active {
        transform: scale(0.92);
    }

    .side-panel-save-toggle svg {
        display: block;
    }

    .side-panel-title {
        font-size: 18px;
        font-weight: 500;
        color: var(--color-text-primary);
        //font-family: 'SimSun','Songti SC', 'STSong','宋体',serif;
    }

    .side-panel-content {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 8px 0;
        contain: layout paint;
    }

    /* SidePanel 中的共享 ToggleSwitch 需要左右内边距 */
    .side-panel .mp-toggle-item {
        padding: 6px 16px;
    }

    .side-panel .mp-dropdown-display{
        height:30px;
    }

    /* 开关下方小字说明 */
    .side-panel-toggle-subtitle {
        font-size: 12px;
        color: var(--color-text-secondary);
        padding: 0 16px 0px;
        margin-top: -14px;
        line-height: 1.4;
    }

    /* 共享折叠箭头 */
    .side-panel-collapsible-arrow {
        width: 20px;
        height: 20px;
        color: var(--color-accent);
        flex-shrink: 0;
        transition: transform 0.2s ease;
    }

    /* 可折叠区域样式 — 调试工具、插件管理、通用折叠 */
    .side-panel-collapsible,
    .side-panel-debug-section,
    .side-panel-plugin-section {
        border-top: 1px solid var(--color-border);
        border-bottom: none;
        border-left: none;
        border-right: none;
        border-radius: 0;
        margin-bottom: 0;
    }

    .side-panel-collapsible-header,
    .side-panel-debug-header,
    .side-panel-plugin-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        cursor: pointer;
        user-select: none;
    }

    .side-panel-collapsible-title,
    .side-panel-debug-title,
    .side-panel-plugin-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .side-panel-collapsible-content,
    .side-panel-debug-content,
    .side-panel-plugin-content {
        display: grid;
        grid-template-rows: minmax(0px, 0fr);
        overflow: hidden;
        transition: grid-template-rows 0.3s ease;
    }

    .side-panel-collapsible-inner,
    .side-panel-debug-inner,
    .side-panel-plugin-inner {
        min-height: 0;
        overflow: hidden;
        padding: 8px 16px 16px;
    }

    .side-panel-collapsible.expanded .side-panel-collapsible-content,
    .side-panel-debug-section.expanded .side-panel-debug-content,
    .side-panel-plugin-section.expanded .side-panel-plugin-content {
        grid-template-rows: minmax(0px, 1fr);
    }

    .side-panel-collapsible.expanded .side-panel-collapsible-arrow,
    .side-panel-debug-section.expanded .side-panel-collapsible-arrow,
    .side-panel-plugin-section.expanded .side-panel-collapsible-arrow {
        transform: rotate(90deg);
    }

    /* 环境贴图管理样式 */
    .env-map-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .env-map-import-btn {
        width: 100%;
        padding: 10px 16px;
        background-color: var(--color-accent);
        color: white;
        border: none;
        border-radius: ${theme.borderRadiusSm};
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'transform'])};
    }

    .env-map-import-btn:active {
        transform: scale(0.98);
    }

    .env-map-file-input {
        display: none;
    }

    .env-map-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 200px;
        overflow-y: auto;
    }

    .env-map-empty-tip {
        padding: 16px;
        text-align: center;
        color: var(--color-text-disabled);
        font-size: 13px;
    }

    .env-map-list-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
    }

    .env-map-item-name {
        font-size: 13px;
        color: var(--color-text-primary);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-right: 8px;
    }

    .env-map-delete-btn {
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: transparent;
        border: none;
        border-radius: 4px;
        color: var(--color-text-disabled);
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'color'])};
        flex-shrink: 0;
    }

    /* 确认弹窗样式 */
    .confirm-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--color-overlay-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        animation: fadeIn 0.2s ease;
    }

    /* 重力控制样式 */
    .side-panel-gravity-section {
        padding: 3px 15px;
    }

    .side-panel-gravity-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        margin-bottom: 2px;
    }

    .side-panel-gravity-slider-container {
        margin-bottom: 12px;
    }

    .side-panel-gravity-slider-container:last-child {
        margin-bottom: 10px;
    }

    .side-panel-gravity-label-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: -10px;
    }

    .side-panel-gravity-axis-label {
        font-size: 12px;
        color: var(--color-text-secondary);
        font-weight: 500;
    }

    .side-panel-gravity-value {
        font-size: 12px;
        color: var(--color-text-secondary);
        font-family: monospace;
        font-weight: 500;
    }

    .side-panel-gravity-slider {
        width: 100%;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background: var(--color-bg);
        border-radius: 2px;
        outline: none;
        cursor: pointer;
    }

    .side-panel-gravity-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--color-accent);
        cursor: pointer;
        //box-shadow: ${theme.shadowSm};
        transition: ${createTransition(['transform', 'background-color'])}
    }

    .side-panel-gravity-slider::-webkit-slider-thumb:active {
        transform: scale(0.95);
    }

    .side-panel-gravity-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--color-accent);
        cursor: pointer;
        border: none;
        //box-shadow: ${theme.shadowSm};
    }

    /* 分隔线样式 */
    .side-panel-divider {
        height: 1px;
        background-color: var(--color-border);
        margin: 8px 0;
    }

    /* 物理精度控制样式 */
    .side-panel-precision-section {
        padding: 6px 16px;        
    }

    .side-panel-precision-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        margin-bottom: 12px;
    }

    .side-panel-precision-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
    }

    .side-panel-precision-item:last-child {
        margin-bottom: 0;
    }

    .side-panel-precision-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    /* 覆盖 mp-dropdown 在 precision 区域的文本样式，与 mp-toggle-label 一致 */
    .side-panel-precision-item .mp-dropdown-text {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    /* 两个 dropdown 宽度一致 */
    .side-panel-precision-item .mp-dropdown {
        width: 120px;
    }

    /* 下拉框区域下方小字说明 */
    .side-panel-precision-subtitle {
        font-size: 11px;
        color: var(--color-text-secondary);
        margin-top: -16px;
        line-height: 1.4;
        white-space: pre;
        
    }

    /* 调试工具区域样式 */
    .side-panel-debug-btn-row {
        display: flex;
        gap: 8px;
    }

    .side-panel-debug-btn {
        flex: 1;
        padding: 8px 12px;
        background-color: var(--color-bg);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadiusSm};
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'transform'])};
    }

    .side-panel-debug-btn:active {
        transform: scale(0.98);
    }

    .side-panel-debug-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .side-panel-plugin-btn-row {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
    }

    .side-panel-plugin-install-btn {
        width: 100%;
        padding: 6px 12px;
        background-color: var(--color-accent);
        color: white;
        border: none;
        border-radius: ${theme.borderRadiusSm};
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'transform'])};
    }

    .side-panel-plugin-install-btn:active {
        transform: scale(0.98);
    }

    .side-panel-plugin-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 250px;
        overflow-y: auto;
    }

    .side-panel-plugin-empty {
        padding: 16px;
        text-align: center;
        color: var(--color-text-disabled);
        font-size: 13px;
    }

    .side-panel-plugin-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 8px;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
    }

    .side-panel-plugin-item-name {
        font-size: 13px;
        color: var(--color-text-primary);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-right: 8px;
    }

    /* 插件详情弹窗样式 */
    .plugin-detail-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--color-overlay-bg);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        animation: fadeIn 0.2s ease;
    }

    .plugin-detail-body .plugin-detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border-bottom: 1px solid var(--color-border)40;
    }

    .plugin-detail-row:last-of-type {
        border-bottom: none;
    }

    .plugin-detail-label {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .plugin-detail-value {
        font-size: 13px;
        color: var(--color-text-primary);
        font-weight: 500;
    }

    .plugin-detail-desc {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--color-border);
        font-size: 13px;
        color: var(--color-text-secondary);
        line-height: 1.5;
    }

    .plugin-detail-btn {
        flex: 1;
    }

    .plugin-detail-btn.update {
        background-color: var(--color-bg);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
    }

    .plugin-detail-builtin {
        flex: 1;
        text-align: center;
        font-size: 13px;
        color: var(--color-text-disabled);
        padding: 10px 0;
    }

    /* 版权信息区域 */
    .side-panel-footer {
        padding: 6px 16px 8px;
        border-top: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
        background: var(--color-surface);
        position: relative;
        cursor: default;
    }

    .side-panel-footer-copyright {
        font-size: 12px;
        color: var(--color-text-secondary);
    }

    .side-panel-footer-application {
        font-size: 11px;
        color: var(--color-text-primary);
        //opacity: 0.7;
    }

    .side-panel-footer-links {
        display: flex;
        gap: 16px;
        //margin-top: 2px;
    }

    .side-panel-footer-link {
        font-size: 12px;
        color: var(--color-accent);
        text-decoration: none;
        transition: ${createTransition(['opacity'])};
    }

    .side-panel-footer-link:active {
        opacity: 0.5;
    }

    @media (max-width: 320px) {
        .side-panel {
            width: 240px;
        }
    }

    /* 彩蛋：抖动动画 */
    .ee-shaking {
        animation: ee-shake 0.4s ease-in-out;
    }

    @keyframes ee-shake {
        0%, 100% { transform: translateX(0); }
        10% { transform: translateX(-4px) rotate(-2deg); }
        20% { transform: translateX(4px) rotate(2deg); }
        30% { transform: translateX(-4px) rotate(-2deg); }
        40% { transform: translateX(4px) rotate(2deg); }
        50% { transform: translateX(-3px) rotate(-1deg); }
        60% { transform: translateX(3px) rotate(1deg); }
        70% { transform: translateX(-2px); }
        80% { transform: translateX(2px); }
        90% { transform: translateX(-1px); }
    }

    /* 彩蛋：Emoji 上浮 */
    .side-panel-footer-emoji {
        position: absolute;
        pointer-events: none;
        user-select: none;
        z-index: 10;
        animation: ee-float-up 1.2s ease-out forwards;
    }

    @keyframes ee-float-up {
        0% {
            opacity: 1;
            transform: translateY(0) scale(0.5) rotate(0deg);
        }
        50% {
            opacity: 1;
            transform: translateY(-120px) scale(1.2) rotate(10deg);
        }
        100% {
            opacity: 0;
            transform: translateY(-250px) scale(0.8) rotate(-10deg);
        }
    }

    /* 彩蛋：Miku 台词 */
    .side-panel-footer-easter-egg-text {
        font-size: 16px;
        font-weight: bold;
        color: var(--color-miku);
        text-align: center;
        padding: 8px 0;
        transition: opacity 0.5s ease;
        opacity: 1;
    }

    .side-panel-footer-easter-egg-text.ee-fading-out {
        opacity: 0;
    }

    /* 安全区校准入口 */
    .side-panel-safe-area-entry {
        margin-top: auto;
        padding: 8px 16px;
    }

    .side-panel-safe-area-divider {
        height: 1px;
        background-color: var(--mp-border, ${theme.borderColor});
        margin: 8px 0 12px;
        opacity: 0.6;
    }

    .side-panel-safe-area-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 16px;
        border: 1px solid var(--mp-border, ${theme.borderColor});
        border-radius: 10px;
        background: var(--mp-surface, ${theme.surfaceColor});
        color: var(--mp-text, ${theme.textPrimary});
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'border-color', 'transform'])};
    }

    .side-panel-safe-area-btn:hover {
        background: ${theme.surfaceColor};
        border-color: ${theme.accentColor};
    }

    .side-panel-safe-area-btn:active {
        transform: scale(0.97);
    }

    .side-panel-safe-area-btn svg {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
    }
`;
