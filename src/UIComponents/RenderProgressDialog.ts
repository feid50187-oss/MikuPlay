
import { injectStyles } from '../styles/mainWindow.css';
import { theme } from '../styles/theme';

const renderProgressStyles = `
    .render-progress-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: ${theme.overlayDarkBg};
        z-index: 999998;
        display: none;
    }

    .render-progress-dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: ${theme.surfaceColor};
        border-radius: 12px;
        padding: 32px 24px 24px;
        min-width: 320px;
        max-width: 480px;
        //box-shadow: ${theme.shadowLg};
        z-index: 999999;
        display: none;
    }

    .render-progress-title {
        font-size: 18px;
        font-weight: 600;
        color: ${theme.textPrimary};
        margin-bottom: 20px;
        text-align: center;
    }

    .render-progress-bar-container {
        width: 100%;
        height: 8px;
        background-color: ${theme.progressBg};
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 16px;
    }

    .render-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, ${theme.progressColor}, ${theme.progressHover});
        border-radius: 4px;
        transition: width 0.3s ease;
        width: 0%;
    }

    .render-progress-text {
        font-size: 16px;
        color: ${theme.textSecondary};
        text-align: center;
        margin-bottom: 24px;
    }

    .render-progress-cancel-btn {
        width: 100%;
        padding: 12px 24px;
        background-color: ${theme.errorColor};
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 15px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s ease;
    }

    .render-progress-cancel-btn:active {
        background-color: ${theme.cancelHover};
    }
`;

export interface RenderProgressDialogCallbacks {
    onCancel: () => void;
}

export class RenderProgressDialog {
    private overlay!: HTMLElement;
    private dialog!: HTMLElement;
    private titleText!: HTMLElement;
    private progressBarContainer!: HTMLElement;
    private progressBar!: HTMLElement;
    private progressText!: HTMLElement;
    private cancelBtn!: HTMLButtonElement;
    private warningText!: HTMLElement;
    private callbacks: RenderProgressDialogCallbacks | null = null;
    private isVisible: boolean = false;
    private cancelHandler!: () => void;

    constructor() {
        injectStyles(renderProgressStyles, 'view-renderprogress');

        this.overlay = this.createOverlay();
        this.dialog = this.createDialog();

        document.body.appendChild(this.overlay);
        document.body.appendChild(this.dialog);

        this.cancelHandler = () => {
            this.callbacks?.onCancel();
        };
        this.cancelBtn.addEventListener('click', this.cancelHandler);
    }

    public setCallbacks(callbacks: RenderProgressDialogCallbacks): void {
        this.callbacks = callbacks;
    }

    private createOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        overlay.className = 'render-progress-overlay';
        return overlay;
    }

    private createDialog(): HTMLElement {
        const dialog = document.createElement('div');
        dialog.className = 'render-progress-dialog';

        this.titleText = document.createElement('div');
        this.titleText.className = 'render-progress-title';
        this.titleText.textContent = '渲染中...';

        this.progressBarContainer = document.createElement('div');
        this.progressBarContainer.className = 'render-progress-bar-container';

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'render-progress-bar';

        this.progressBarContainer.appendChild(this.progressBar);

        this.progressText = document.createElement('div');
        this.progressText.className = 'render-progress-text';
        this.progressText.textContent = '0 / 0';

        this.cancelBtn = document.createElement('button');
        this.cancelBtn.className = 'render-progress-cancel-btn';
        this.cancelBtn.textContent = '取消渲染';

        this.warningText = document.createElement('div');
        this.warningText.style.cssText = `
            font-size: 12px;
            color: ${theme.warningColor};
            text-align: center;
            margin-bottom: 12px;
            font-style: italic;
            display: none;
        `;

        dialog.appendChild(this.titleText);
        dialog.appendChild(this.progressBarContainer);
        dialog.appendChild(this.progressText);
        dialog.appendChild(this.warningText);
        dialog.appendChild(this.cancelBtn);

        return dialog;
    }

    public show(): void {
        if (this.isVisible) return;
        this.isVisible = true;
        this.overlay.style.display = 'block';
        this.dialog.style.display = 'block';
    }

    public hide(): void {
        if (!this.isVisible) return;
        this.isVisible = false;
        this.overlay.style.display = 'none';
        this.dialog.style.display = 'none';
        // 恢复进度条和文本的显示状态
        this.progressBarContainer.style.display = 'block';
        this.progressText.style.display = 'block';
        this.updateProgress(0, 0);
    }

    public updateProgress(current: number, total: number): void {
        if (total === 0) {
            // 不显示进度，只显示文本
            this.progressBarContainer.style.display = 'none';
            this.progressText.style.display = 'none';
            return;
        }
        // 恢复显示
        this.progressBarContainer.style.display = 'block';
        this.progressText.style.display = 'block';

        // 预热阶段：current 为负值，显示"预热中 X / total"并切换标题
        if (current < 0) {
            const warmupCurrent = -current;
            const percentage = (warmupCurrent / total) * 100;
            this.progressBar.style.width = `${percentage}%`;
            this.progressText.textContent = `预热中 ${warmupCurrent} / ${total}`;
            this.titleText.textContent = '物理预热中...';
            return;
        }

        // 渲染阶段：恢复标题
        if (this.titleText.textContent === '物理预热中...') {
            this.titleText.textContent = '离线渲染中...';
        }

        const percentage = (current / total) * 100;
        this.progressBar.style.width = `${percentage}%`;
        this.progressText.textContent = `${current} / ${total}`;
    }

    public setWritingMode(): void {
        this.progressBar.style.width = '100%';
        this.progressText.textContent = '写入文件中';
        this.progressBarContainer.style.display = 'block';
        this.progressText.style.display = 'block';
    }

    public setEncodingMode(): void {
        this.titleText.textContent = '编码中...';
        this.progressBar.style.width = '0%';
        this.progressText.textContent = '0 / 0';
        this.progressBarContainer.style.display = 'block';
        this.progressText.style.display = 'block';
    }

    public setTitle(title: string): void {
        this.titleText.textContent = title;
    }

    public showWarning(text: string | null): void {
        if (!text) {
            this.warningText.style.display = 'none';
            return;
        }
        this.warningText.textContent = text;
        this.warningText.style.display = 'block';
    }

    public dispose(): void {
        this.cancelBtn.removeEventListener('click', this.cancelHandler);
        this.callbacks = null;

        if (this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }
        if (this.dialog.parentElement) {
            this.dialog.parentElement.removeChild(this.dialog);
        }
    }
}
