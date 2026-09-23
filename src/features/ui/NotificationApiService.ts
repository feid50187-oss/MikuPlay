/**
 * 通知 API 服务
 * 插件可通过此服务发送 Toast 通知
 */

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface ToastOptions {
    message: string;
    type?: ToastType;
    duration?: number; // 毫秒，0 = 不自动关闭
}

export interface ToastHandle {
    dismiss: () => void;
}

export class NotificationApiService {
    private static instance: NotificationApiService;
    private toasts: HTMLElement[] = [];
    private container: HTMLElement | null = null;

    private constructor() {}

    static getInstance(): NotificationApiService {
        if (!NotificationApiService.instance) {
            NotificationApiService.instance = new NotificationApiService();
        }
        return NotificationApiService.instance;
    }

    /**
     * 显示 Toast 通知
     */
    show(options: ToastOptions): ToastHandle {
        const { message, type = 'info', duration = 3000 } = options;

        this.ensureContainer();

        const toast = document.createElement('div');
        toast.style.cssText = `
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 8px;
            font-size: 14px;
            color: #fff;
            max-width: 300px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.2s ease;
            z-index: 9999;
        `;

        // 根据类型设置颜色
        const colors: Record<ToastType, string> = {
            info: '#2196F3',
            success: '#4CAF50',
            error: '#F44336',
            warning: '#FF9800'
        };
        toast.style.background = colors[type];
        toast.textContent = message;

        this.container!.appendChild(toast);
        this.toasts.push(toast);

        const dismiss = () => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            this.toasts = this.toasts.filter(t => t !== toast);
        };

        // 自动关闭
        if (duration > 0) {
            setTimeout(dismiss, duration);
        }

        return { dismiss };
    }

    /**
     * 快捷方法：info
     */
    info(message: string, duration?: number): ToastHandle {
        return this.show({ message, type: 'info', duration });
    }

    /**
     * 快捷方法：success
     */
    success(message: string, duration?: number): ToastHandle {
        return this.show({ message, type: 'success', duration });
    }

    /**
     * 快捷方法：error
     */
    error(message: string, duration?: number): ToastHandle {
        return this.show({ message, type: 'error', duration });
    }

    /**
     * 快捷方法：warning
     */
    warning(message: string, duration?: number): ToastHandle {
        return this.show({ message, type: 'warning', duration });
    }

    /**
     * 快捷方法：loading（不自动关闭）
     */
    loading(message: string): ToastHandle {
        return this.show({ message, type: 'info', duration: 0 });
    }

    /**
     * 确保容器存在
     */
    private ensureContainer(): void {
        if (this.container) return;

        this.container = document.createElement('div');
        this.container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
        `;
        document.body.appendChild(this.container);

        // 添加动画样式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
}

export const notificationApiService = NotificationApiService.getInstance();
