
import type { ConfirmDialogConfig, ChoiceDialogConfig } from './types';
import { createOverlay } from './Overlay';
import { icons } from './IconRegistry';
import { theme } from '../../styles/theme';

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) return;
    const style = document.createElement('style');
    style.textContent = `
        .mp-confirm-dialog {
            min-width: 260px;
        }
        .mp-confirm-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--color-text-primary);
            margin-bottom: 8px;
        }
        .mp-confirm-message {
            font-size: 14px;
            color: var(--color-text-secondary);
            margin-bottom: 20px;
            line-height: 1.5;
        }
        .mp-confirm-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            flex-wrap: wrap;
        }
        .mp-confirm-btn {
            padding: 8px 20px;
            border-radius: 8px;
            border: 1px solid var(--color-border);
            background: var(--color-surface);
            color: var(--color-text-secondary);
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s;
            min-height: 36px;
        }
        .mp-confirm-btn:hover {
            filter: brightness(1.1);
        }
        .mp-confirm-btn--primary {
            background: var(--color-accent);
            color: #fff;
            border-color: var(--color-accent);
        }
        .mp-confirm-btn--danger {
            background: var(--color-error);
            color: #fff;
            border-color: var(--color-error);
        }

    `;
    document.head.appendChild(style);
    stylesInjected = true;
}

/**
 * 显示确认对话框
 * @returns Promise<boolean> — 确认则 resolve(true)，取消则 resolve(false)
 */
export function showConfirmDialog(config: ConfirmDialogConfig): Promise<boolean> {
    injectStyles();

    return new Promise((resolve) => {
        const content = document.createElement('div');
        content.className = 'mp-confirm-dialog';

        const title = document.createElement('div');
        title.className = 'mp-confirm-title';
        title.textContent = config.title;

        const message = document.createElement('div');
        message.className = 'mp-confirm-message';
        message.textContent = config.message;

        const actions = document.createElement('div');
        actions.className = 'mp-confirm-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'mp-confirm-btn';
        cancelBtn.textContent = config.cancelText ?? '取消';

        const confirmBtn = document.createElement('button');
        confirmBtn.className = `mp-confirm-btn ${config.danger ? 'mp-confirm-btn--danger' : 'mp-confirm-btn--primary'}`;
        confirmBtn.textContent = config.confirmText ?? '确认';

        cancelBtn.addEventListener('click', () => {
            dismiss();
            resolve(false);
        });
        confirmBtn.addEventListener('click', () => {
            dismiss();
            resolve(true);
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);
        content.appendChild(title);
        content.appendChild(message);
        content.appendChild(actions);

        const { dismiss } = createOverlay(content, () => resolve(false));
    });
}

/**
 * 显示多选对话框
 * @returns Promise<string | null> — 选择某个选项则 resolve 该选项的 value，取消则 resolve(null)
 */
export function showChoiceDialog(config: ChoiceDialogConfig): Promise<string | null> {
    injectStyles();

    return new Promise((resolve) => {
        const content = document.createElement('div');
        content.className = 'mp-confirm-dialog';

        const title = document.createElement('div');
        title.className = 'mp-confirm-title';
        title.textContent = config.title;

        const message = document.createElement('div');
        message.className = 'mp-confirm-message';
        message.textContent = config.message;

        const actions = document.createElement('div');
        actions.className = 'mp-confirm-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'mp-confirm-btn';
        cancelBtn.textContent = config.cancelText ?? '取消';
        cancelBtn.addEventListener('click', () => {
            dismiss();
            resolve(null);
        });
        actions.appendChild(cancelBtn);

        for (const option of config.options) {
            const btn = document.createElement('button');
            btn.className = option.primary ? 'mp-confirm-btn mp-confirm-btn--primary' : 'mp-confirm-btn';
            btn.textContent = option.label;
            btn.addEventListener('click', () => {
                dismiss();
                resolve(option.value);
            });
            actions.appendChild(btn);
        }

        content.appendChild(title);
        content.appendChild(message);
        content.appendChild(actions);

        const { dismiss } = createOverlay(content, () => resolve(null));
    });
}
