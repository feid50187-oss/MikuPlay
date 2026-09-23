
import { theme } from '../../styles/theme';

const OVERLAY_CLASS = 'mp-overlay';
const DIALOG_CLASS = 'mp-overlay-dialog';

let stylesInjected = false;

function injectOverlayStyles(): void {
    if (stylesInjected) return;
    const style = document.createElement('style');
    style.textContent = `
        .${OVERLAY_CLASS} {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: var(--color-overlay-bg);
            z-index: 70000;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: mp-overlay-in 0.2s ease;
        }
        .${OVERLAY_CLASS}.mp-overlay-out {
            animation: mp-overlay-out 0.15s ease forwards;
        }
        .${DIALOG_CLASS} {
            background: var(--color-surface);
            border-radius: 16px;
            padding: 24px;
            min-width: 280px;
            max-width: 90vw;
            //box-shadow: var(--shadow-lg);
            animation: mp-dialog-in 0.25s ease;
        }
        @keyframes mp-overlay-in {
            from { opacity: 0; }
            to { opacity: 1; }
        }
        @keyframes mp-overlay-out {
            from { opacity: 1; }
            to { opacity: 0; }
        }
        @keyframes mp-dialog-in {
            from { opacity: 0; transform: scale(0.92); }
            to { opacity: 1; transform: scale(1); }
        }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
}

/**
 * 创建模态覆盖层
 * @param content 覆盖层中的内容元素
 * @param onClose 关闭回调 (点击遮罩层时触发)
 * @returns 覆盖层元素和关闭函数
 */
export function createOverlay(content: HTMLElement, onClose?: () => void): { element: HTMLElement; dismiss: () => void } {
    injectOverlayStyles();

    const overlay = document.createElement('div');
    overlay.className = OVERLAY_CLASS;

    const dialog = document.createElement('div');
    dialog.className = DIALOG_CLASS;
    dialog.appendChild(content);
    overlay.appendChild(dialog);

    // 点击背景关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            dismiss();
        }
    });

    const dismiss = () => {
        overlay.classList.add('mp-overlay-out');
        overlay.addEventListener('animationend', () => {
            overlay.remove();
            onClose?.();
        }, { once: true });
    };

    document.body.appendChild(overlay);

    return { element: overlay, dismiss };
}
