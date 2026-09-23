
import type { ToastType } from './types';

interface ToastEntry {
    element: HTMLElement;
    timer: ReturnType<typeof setTimeout> | null;
}

const TOAST_POOL_SIZE = 3;

class ToastServiceImpl {
    private container: HTMLElement | null = null;
    private pool: ToastEntry[] = [];
    private stylesInjected = false;

    private ensureContainer(): HTMLElement {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'mp-toast-container';
            document.body.appendChild(this.container);
        }
        return this.container;
    }

    private injectStyles(): void {
        if (this.stylesInjected) return;
        const style = document.createElement('style');
        style.textContent = `
            .mp-toast-container {
                position: fixed;
                bottom: 10vh;
                left: 50%;
                transform: translateX(-50%);
                z-index: 1000000;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                pointer-events: none;
            }
            .mp-toast {
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                color: #fff;
                pointer-events: auto;
                animation: mp-toast-in 0.25s ease;
                max-width: 80vw;
                text-align: center;
                //box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                word-wrap: break-word;
                overflow-wrap: break-word;
                white-space: pre-wrap;
                line-height: 1.4;
            }
            .mp-toast.mp-toast-out {
                animation: mp-toast-out 0.2s ease forwards;
            }
            .mp-toast--info { background: #333; }
            .mp-toast--success { background: #22c55e; }
            .mp-toast--error { background: #ef4444; }
            .mp-toast--loading { background: #3b82f6; }
            @keyframes mp-toast-in {
                from { opacity: 0; transform: translateY(12px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes mp-toast-out {
                from { opacity: 1; transform: translateY(0); }
                to { opacity: 0; transform: translateY(12px); }
            }
        `;
        document.head.appendChild(style);
        this.stylesInjected = true;
    }

    private getPooledElement(type: ToastType): ToastEntry {
        // Reuse a pooled element if available
        const existing = this.pool.find(e => !e.element.parentNode);
        if (existing) {
            existing.element.className = `mp-toast mp-toast--${type}`;
            if (existing.timer) { clearTimeout(existing.timer); existing.timer = null; }
            return existing;
        }
        if (this.pool.length >= TOAST_POOL_SIZE) {
            const oldest = this.pool.shift()!;
            oldest.element.remove();
        }
        const element = document.createElement('div');
        element.className = `mp-toast mp-toast--${type}`;
        const entry: ToastEntry = { element, timer: null };
        this.pool.push(entry);
        return entry;
    }

    show(message: string, type: ToastType = 'info', duration: number = 3000): { dismiss: () => void } {
        this.injectStyles();
        const container = this.ensureContainer();
        const entry = this.getPooledElement(type);
        entry.element.textContent = message;
        container.appendChild(entry.element);

        const dismiss = () => {
            if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
            entry.element.classList.add('mp-toast-out');
            entry.element.addEventListener('animationend', () => {
                entry.element.remove();
                entry.element.classList.remove('mp-toast-out');
            }, { once: true });
        };

        if (type !== 'loading' && duration > 0) {
            entry.timer = setTimeout(dismiss, duration);
        }

        return { dismiss };
    }

    info(message: string, duration?: number) { return this.show(message, 'info', duration); }
    success(message: string, duration?: number) { return this.show(message, 'success', duration); }
    error(message: string, duration?: number) { return this.show(message, 'error', duration); }
    loading(message: string) { return this.show(message, 'loading', 0); }

    dispose(): void {
        this.pool.forEach(e => { e.element.remove(); if (e.timer) clearTimeout(e.timer); });
        this.pool = [];
        this.container?.remove();
        this.container = null;
    }
}

export const toast = new ToastServiceImpl();
