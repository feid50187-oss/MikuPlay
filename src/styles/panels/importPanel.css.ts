
import { theme, createTransition } from '../theme';

export const importPanelStyles = `
    .import-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .import-panel-content {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        display: flex;
        flex-direction: column;
        //gap: 12px;
        padding-bottom: 8px;
    }

    .import-card.mp-collapsible-section {
        background-color: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: ${theme.borderRadius};
        overflow: hidden;
        flex-shrink: 0;
        min-width: 0;
    }

    .add-button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 4px 16px;
        border: 1px dashed var(--color-text-disabled);
        border-radius: ${theme.borderRadiusSm};
        background-color: transparent;
        color: var(--color-accent);
        font-size: 12px;
        cursor: pointer;
        transition: ${createTransition(['border-color', 'background-color'])};
        user-select: none;
    }

    .add-button svg {
        width: 20px;
        height: 20px;
    }

    .add-button + .add-button {
        margin-top: 8px;
    }

    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 60px;
        color: var(--color-text-disabled);
        font-size: 14px;
    }

    .model-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 8px;
    }

    .model-item,
    .music-item,
    .camera-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
        transition: ${createTransition(['background-color'])};
        overflow: hidden;
    }

    // .model-item:hover {
    //     background-color: var(--color-border);
    // }

    .model-name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        color: var(--color-text-primary);
        overflow: hidden;
        white-space: nowrap;
        margin-right: 8px;
    }

    .model-delete-button,
    .camera-delete-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 4px;
        background-color: transparent;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'color'])};
        padding: 0;
    }

    .model-delete-button {
        color: var(--color-accent);
        flex-shrink: 0;
    }

    .model-delete-button svg {
        width: 18px;
        height: 18px;
    }

    .animation-item {
        overflow: hidden;
        min-width: 0;
    }

    .motion-list {
        display: flex;
        flex-direction: column;
        //gap: 8px;
    }

    .motion-model-entry.mp-collapsible-section {
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadiusSm};
        overflow: hidden;
        min-width: 0;
    }

    .motion-model-entry .mp-collapsible-header {
        overflow: hidden;
        min-width: 0;
    }

    .motion-model-entry .mp-collapsible-title {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        color: var(--color-text-primary);
        overflow: hidden;
        white-space: nowrap;
        margin-right: 8px;
    }

    .motion-model-entry .mp-collapsible-arrow {
        width: 20px;
        height: 20px;
        color: var(--color-accent);
        transition: ${createTransition(['transform'])};
        flex-shrink: 0;
    }

    .motion-import-button {
        margin-top: 0;
    }

    .motion-button-container {
        display: flex;
        gap: 8px;
        margin-top: 8px;
    }

    .motion-button-container .add-button,
    .clear-animations-button {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 4px 16px;
        border: 1px dashed var(--color-text-disabled);
        border-radius: ${theme.borderRadiusSm};
        background-color: transparent;
        font-size: 12px;
        cursor: pointer;
        transition: ${createTransition(['border-color', 'background-color', 'color'])},
        user-select: none;
    }

    .motion-button-container .add-button {
        color: var(--color-accent);
    }

    .clear-animations-button {
        color: var(--color-error);
    }

    .motion-button-container .add-button svg,
    .clear-animations-button svg {
        width: 24px;
        height: 24px;
    }

        .motion-button-container .clear-animations-button svg {
        width: 18px;
        height: 18px;
    }

    /* 音乐列表样式 */
    .music-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 8px;
    }

    .music-item.current {
        background-color: ${theme.accentColor}20;
        border: 1px solid ${theme.accentColor}40;
    }

    .music-info,
    .camera-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        margin-right: 8px;
    }

    .music-name {
        font-size: 13px;
        color: var(--color-text-primary);
        overflow: hidden;
        white-space: nowrap;
        min-width: 0;
    }

    .music-duration {
        font-size: 11px;
        color: var(--color-text-secondary);
        margin-top: 2px;
    }

    .music-button-container,
    .camera-button-container {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
    }

    .music-play-button,
    .music-delete-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 4px;
        background-color: transparent;
        cursor: pointer;
        transition: ${createTransition(['background-color', 'color'])};
        padding: 0;
    }

    .music-play-button {
        color: var(--color-accent);
        font-size: 12px;
    }

    .music-delete-button {
        color: var(--color-text-disabled);
    }

    .music-delete-button svg {
        width: 18px;
        height: 18px;
    }

    /* 镜头列表样式 */
    .camera-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 8px;
    }

    .camera-item.current {
        background-color: ${theme.accentColor}20;
        border: 1px solid ${theme.accentColor}40;
    }

    .camera-name {
        font-size: 13px;
        color: var(--color-text-primary);
        overflow: hidden;
        white-space: nowrap;
        min-width: 0;
    }

    .camera-label {
        font-size: 11px;
        color: var(--color-text-secondary);
        margin-top: 2px;
    }

    .camera-delete-button {
        color: var(--color-text-disabled);
    }

    .camera-delete-button svg {
        width: 18px;
        height: 18px;
    }

    /* 跟随相机开关 */
    .camera-follow-toggle {
        margin-top: 8px;
        //border-top: 1px solid var(--color-border);
    }

    /* Frame Control Bottom Bar */
    .frame-ctrl-bottom-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 2px 0px 4px;
        background-color: var(--color-surface);
        flex-shrink: 0;
        margin-top: auto;
    }

    .frame-ctrl-jump-buttons {
        display: flex;
        gap: 4px;
    }

    .frame-ctrl-jump-btn {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 4px;
        cursor: pointer;
        user-select: none;
        transition: ${createTransition(['background-color', 'border-color'])};
        padding: 0;
    }

    .frame-ctrl-jump-btn svg {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        color: var(--color-text-primary);
    }

    .frame-ctrl-jump-btn.end svg {
        transform: rotate(180deg);
    }

    .frame-ctrl-value-controller {
        display: flex;
        align-items: center;
        flex: 1;
        background-color: var(--color-bg);
        border-radius: ${theme.borderRadius};
        overflow: hidden;
    }

    .frame-ctrl-value-arrow {
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

    .frame-ctrl-value-arrow svg {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
    }

    .frame-ctrl-value-arrow.left svg {
        transform: rotate(180deg);
    }

    .frame-ctrl-value-input {
        flex: 1;
        min-width: 80px;
        text-align: center;
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
        background: transparent;
        border: none;
        outline: none;
        /* 进度条：从左到右填充，使用 accent 色 */
        background: linear-gradient(
            to right,
            var(--color-accent) 0%,
            var(--color-accent) var(--progress, 0%),
            transparent var(--progress, 0%),
            transparent 100%
        );
        border-radius: 8px;
    }
`;
