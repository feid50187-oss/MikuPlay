import type { ISharedComponent, TexturePickerConfig } from './types';

/**
 * 贴图选择器（Phase 2）
 *
 * fork 自 RGBColorPicker：视觉结构与颜色选择一致（标题 + 标题栏内的预览块），
 * 但点击预览块不再打开取色器，而是打开系统媒体/文件选择框（image/*）。
 * 选中后通过 URL.createObjectURL 生成 blob URL，并通知 onChange。
 */
export class TexturePicker implements ISharedComponent<TexturePickerConfig, string> {
    readonly element: HTMLElement;
    private value: string;
    private listeners = new Set<(url: string) => void>();
    private preview: HTMLElement;
    private fileInput: HTMLInputElement;
    private revokePrevUrl: string | null = null;

    private static stylesInjected = false;

    constructor(config: TexturePickerConfig) {
        this.value = config.value ?? '';

        this.injectStyles();

        this.element = document.createElement('div');
        this.element.className = 'mp-texture-picker';

        // 头部容器（label + 预览块），与颜色选择布局一致
        const headerContainer = document.createElement('div');
        headerContainer.className = 'mp-texture-picker-header';

        if (config.label) {
            const label = document.createElement('span');
            label.className = 'mp-texture-picker-label';
            label.textContent = config.label;
            headerContainer.appendChild(label);
        }

        // 贴图预览块
        this.preview = document.createElement('div');
        this.preview.className = 'mp-texture-preview';
        this.updatePreview();
        this.preview.addEventListener('click', () => this.openPicker());
        headerContainer.appendChild(this.preview);

        this.element.appendChild(headerContainer);

        // 隐藏的文件输入框（点击预览时触发）
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = 'image/*';
        this.fileInput.style.display = 'none';
        document.body.appendChild(this.fileInput);
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            if (file) {
                const url = URL.createObjectURL(file);
                this.setValue(url);
                this.listeners.forEach(cb => { try { cb(url); } catch { /* ignore */ } });
            }
            this.fileInput.value = '';
        });
    }

    private openPicker(): void {
        this.fileInput.click();
    }

    private updatePreview(): void {
        this.preview.innerHTML = '';
        if (this.value) {
            const img = document.createElement('img');
            img.className = 'mp-texture-preview-img';
            img.src = this.value;
            this.preview.appendChild(img);
        } else {
            const placeholder = document.createElement('span');
            placeholder.className = 'mp-texture-preview-placeholder';
            placeholder.textContent = '选择贴图';
            this.preview.appendChild(placeholder);
        }
    }

    getValue(): string {
        return this.value;
    }

    setValue(value: string): void {
        this.value = value ?? '';
        this.updatePreview();
    }

    configure(config: Partial<TexturePickerConfig>): void {
        if (config.value !== undefined) this.setValue(config.value);
    }

    onChange(callback: (url: string) => void): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    dispose(): void {
        if (this.revokePrevUrl) {
            URL.revokeObjectURL(this.revokePrevUrl);
            this.revokePrevUrl = null;
        }
        this.listeners.clear();
        this.fileInput.remove();
        this.element.remove();
    }

    private injectStyles(): void {
        if (TexturePicker.stylesInjected) return;
        const style = document.createElement('style');
        style.textContent = `
            .mp-texture-picker { display: flex; flex-direction: column; gap: 8px; }
            .mp-texture-picker-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
            .mp-texture-picker-label { font-size: 13px; color: var(--color-text-secondary); }
            .mp-texture-preview {
                width: 48px; height: 32px; border-radius: 6px; border: 2px solid var(--color-border);
                cursor: pointer; overflow: hidden; display: flex; align-items: center; justify-content: center;
                background-color: var(--color-bg);
            }
            .mp-texture-preview-img {
                width: 100%; height: 100%; object-fit: cover; pointer-events: none;
            }
            .mp-texture-preview-placeholder {
                font-size: 10px; color: var(--color-text-disabled); pointer-events: none;
            }
        `;
        document.head.appendChild(style);
        TexturePicker.stylesInjected = true;
    }
}