
import { theme, createTransition } from '../theme';

const PANEL_HEIGHT_PERCENT = 40;

export const navBarStyles = `
    .nav-bar-container {
        display: flex;
        flex-direction: column;
        position: relative;
        width: 100%;
        /* 不使用 paint containment：panel-container 是绝对定位且向上弹出，paint 会导致裁剪 */
        contain: layout;
    }

    .nav-bar-wrapper {
        display: flex;
        align-items: center;
        width: 100%;
        min-height: ${theme.navBarHeight};
        background-color: var(--color-surface);
        border-top: 1px solid var(--color-border);
        position: relative;
        z-index: 100;
        flex-wrap: wrap;
    }

    .nav-items-container {
        display: flex;
        align-items: center;
        flex: 1;
        height: 100%;
        padding-left: 8px;
        flex-wrap: wrap;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }

    .nav-items-container::-webkit-scrollbar {
        display: none;
    }

    .nav-bar-container .nav-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 48px;
        padding: 0px;
        cursor: pointer;
        position: relative;
        transition: ${createTransition(['background-color'])};
        min-width: 50px;
        flex-shrink: 0;
        width: max-content;
    }

    .nav-bar-container .nav-item.active {
        background-color: transparent;
    }

    .nav-bar-container .nav-item-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text-secondary);
        user-select: none;
        padding: 2px;
        white-space: nowrap;
    }

    .nav-bar-container .nav-item.active .nav-item-label {
        color: var(--color-accent);
    }

    .nav-bar-container .nav-indicator {
        position: absolute;
        bottom: 0;
        width: 32px;
        height: 4px;
        border-radius: 4px;
        background-color: var(--color-accent);
        transform: scaleX(0);
        transition: ${createTransition(['transform'])};
    }

    .nav-bar-container .nav-item.active .nav-indicator {
        transform: scaleX(1);
    }

    .nav-bar-container .expand-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        cursor: pointer;
        transition: ${createTransition(['background-color'])};
        flex-shrink: 0;
    }

    .nav-bar-container .expand-button svg {
        width: 24px;
        height: 24px;
        color: var(--color-accent);
        transition: ${createTransition(['transform'])};
    }

    .nav-bar-container .expand-button.expanded svg {
        transform: rotate(180deg);
    }

    .nav-bar-container .panel-container {
        position: absolute;
        bottom: 48px;
        left: 0;
        right: 0;
        height: ${PANEL_HEIGHT_PERCENT}vh;
        background-color: var(--color-surface);
        border-top: 1px solid var(--color-border);
        overflow: hidden;
        clip-path: inset(100% 0 0 0);
        opacity: 0;
        visibility: hidden;
        transition: ${createTransition(['clip-path', 'opacity', 'visibility'])};
        z-index: 99;
        //box-shadow: ${theme.shadowMd};
        will-change: clip-path, opacity;
        contain: layout paint;
    }

    .nav-bar-container .panel-container.expanded {
        clip-path: inset(0 0 0 0);
        opacity: 1;
        visibility: visible;
    }

    .nav-bar-container .panel-content {
        width: 100%;
        max-width: 800px;
        margin: auto;
        height: 100%;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
        padding: 8px 8px 0px;
        contain: layout paint;
    }

    // @media (max-width: 600px) {
    //     .nav-bar-container .nav-item {
    //         padding: 0 12px;
    //         min-width: 56px;
    //     }

    //     .nav-bar-container .nav-item-label {
    //         font-size: 12px;
    //     }
    // }

    /* 横屏模式下减小高度 */
    @media (orientation: landscape) and (max-height: 500px) {
        .nav-bar-wrapper {
            height: 24px;
            min-height: 24px;
        }

        .nav-bar-container .nav-item {
            min-width: 40px;
        }

        .nav-bar-container .nav-item-label {
            font-size: 10px;
        }

        .nav-bar-container .expand-button {
            width: 24px;
            height: 24px;
        }

        .nav-bar-container .expand-button svg {
            width: 16px;
            height: 16px;
        }

        .nav-bar-container .panel-container {
            bottom: 24px;
        }
    }
`;
