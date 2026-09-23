
import type { ISharedComponent, RGBColorPickerConfig } from './types';
import { rgbToHex, hexToRgb, clamp01 } from '../../utils/color';
import { Slider } from './Slider';
import { icons } from './IconRegistry';

export class RGBColorPicker implements ISharedComponent<RGBColorPickerConfig, { r: number; g: number; b: number; a: number }> {
    readonly element: HTMLElement;
    private color: { r: number; g: number; b: number; a: number };
    private mode: 'inline' | 'popup';
    private popupContainer?: HTMLElement;
    private listeners = new Set<(value: { r: number; g: number; b: number; a: number }) => void>();
    private popupOverlay: HTMLElement | null = null;
    private documentClickListener: ((e: MouseEvent) => void) | null = null;

    // UI refs
    private preview: HTMLElement;
    private rSlider!: Slider;
    private gSlider!: Slider;
    private bSlider!: Slider;
    private aSlider?: Slider;
    private hexInput!: HTMLInputElement;
    private confirmBtn?: HTMLElement;

    private static stylesInjected = false;

    constructor(config: RGBColorPickerConfig) {
        this.color = {
            r: config.color.r,
            g: config.color.g,
            b: config.color.b,
            a: config.alpha ?? 1
        };
        this.mode = config.mode;
        this.popupContainer = config.popupContainer;

        this.injectStyles();

        this.element = document.createElement('div');
        this.element.className = 'mp-rgb-picker';

        // 创建头部容器（label + preview）
        const headerContainer = document.createElement('div');
        headerContainer.className = 'mp-rgb-picker-header';

        if (config.label) {
            const label = document.createElement('span');
            label.className = 'mp-rgb-picker-label';
            label.textContent = config.label;
            headerContainer.appendChild(label);
        }

        // 颜色预览块
        this.preview = document.createElement('div');
        this.preview.className = 'mp-color-preview';
        this.updatePreview();
        this.preview.addEventListener('click', () => {
            if (this.mode === 'popup') this.openPopup();
        });
        headerContainer.appendChild(this.preview);
        this.element.appendChild(headerContainer);

        if (this.mode === 'inline') {
            const slidersContainer = document.createElement('div');
            slidersContainer.className = 'mp-rgb-sliders';
            this.createSliders(slidersContainer, config.showAlpha);
            this.element.appendChild(slidersContainer);
        }
    }

    private updatePreview(): void {
        const hex = rgbToHex(this.color.r, this.color.g, this.color.b);
        this.preview.style.backgroundColor = hex;
    }

    private updateHexInputBg(): void {
        const hex = rgbToHex(this.color.r, this.color.g, this.color.b);
        this.hexInput.style.backgroundColor = hex;
        // 根据亮度决定文字颜色
        const luminance = 0.299 * this.color.r + 0.587 * this.color.g + 0.114 * this.color.b;
        this.hexInput.style.color = luminance > 0.5 ? '#000' : '#fff';
    }

    private createSliders(container: HTMLElement, showAlpha?: boolean): void {
        // R slider
        const rWrapper = document.createElement('div');
        rWrapper.className = 'mp-rgb-slider-wrapper';
        const rLabel = document.createElement('span');
        rLabel.className = 'mp-rgb-label mp-rgb-label-r';
        rLabel.textContent = 'R';
        const rInput = document.createElement('input');
        rInput.type = 'range';
        rInput.className = 'mp-rgb-slider';
        rInput.min = '0';
        rInput.max = '255';
        rInput.step = '1';
        rInput.value = Math.round(this.color.r * 255).toString();
        const rValue = document.createElement('span');
        rValue.className = 'mp-rgb-value';
        rValue.textContent = Math.round(this.color.r * 255).toString();
        rInput.addEventListener('input', () => {
            const v = parseInt(rInput.value);
            this.color.r = v / 255;
            rValue.textContent = v.toString();
            this.syncFromSliders();
        });
        rWrapper.appendChild(rLabel);
        rWrapper.appendChild(rInput);
        rWrapper.appendChild(rValue);
        container.appendChild(rWrapper);

        // G slider
        const gWrapper = document.createElement('div');
        gWrapper.className = 'mp-rgb-slider-wrapper';
        const gLabel = document.createElement('span');
        gLabel.className = 'mp-rgb-label mp-rgb-label-g';
        gLabel.textContent = 'G';
        const gInput = document.createElement('input');
        gInput.type = 'range';
        gInput.className = 'mp-rgb-slider';
        gInput.min = '0';
        gInput.max = '255';
        gInput.step = '1';
        gInput.value = Math.round(this.color.g * 255).toString();
        const gValue = document.createElement('span');
        gValue.className = 'mp-rgb-value';
        gValue.textContent = Math.round(this.color.g * 255).toString();
        gInput.addEventListener('input', () => {
            const v = parseInt(gInput.value);
            this.color.g = v / 255;
            gValue.textContent = v.toString();
            this.syncFromSliders();
        });
        gWrapper.appendChild(gLabel);
        gWrapper.appendChild(gInput);
        gWrapper.appendChild(gValue);
        container.appendChild(gWrapper);

        // B slider
        const bWrapper = document.createElement('div');
        bWrapper.className = 'mp-rgb-slider-wrapper';
        const bLabel = document.createElement('span');
        bLabel.className = 'mp-rgb-label mp-rgb-label-b';
        bLabel.textContent = 'B';
        const bInput = document.createElement('input');
        bInput.type = 'range';
        bInput.className = 'mp-rgb-slider';
        bInput.min = '0';
        bInput.max = '255';
        bInput.step = '1';
        bInput.value = Math.round(this.color.b * 255).toString();
        const bValue = document.createElement('span');
        bValue.className = 'mp-rgb-value';
        bValue.textContent = Math.round(this.color.b * 255).toString();
        bInput.addEventListener('input', () => {
            const v = parseInt(bInput.value);
            this.color.b = v / 255;
            bValue.textContent = v.toString();
            this.syncFromSliders();
        });
        bWrapper.appendChild(bLabel);
        bWrapper.appendChild(bInput);
        bWrapper.appendChild(bValue);
        container.appendChild(bWrapper);

        // Alpha slider (optional)
        if (showAlpha) {
            const aWrapper = document.createElement('div');
            aWrapper.className = 'mp-rgb-slider-wrapper';
            const aLabel = document.createElement('span');
            aLabel.className = 'mp-rgb-label mp-rgb-label-a';
            aLabel.textContent = 'A';
            const aInput = document.createElement('input');
            aInput.type = 'range';
            aInput.className = 'mp-rgb-slider';
            aInput.min = '0';
            aInput.max = '255';
            aInput.step = '1';
            aInput.value = Math.round(this.color.a * 255).toString();
            const aValue = document.createElement('span');
            aValue.className = 'mp-rgb-value';
            aValue.textContent = Math.round(this.color.a * 255).toString();
            aInput.addEventListener('input', () => {
                const v = parseInt(aInput.value);
                this.color.a = v / 255;
                aValue.textContent = v.toString();
                this.syncFromSliders();
            });
            aWrapper.appendChild(aLabel);
            aWrapper.appendChild(aInput);
            aWrapper.appendChild(aValue);
            container.appendChild(aWrapper);
        }

        // Hex input
        const hexRow = document.createElement('div');
        hexRow.className = 'mp-rgb-hex-row';
        const hexLabel = document.createElement('span');
        hexLabel.textContent = 'HEX';
        this.hexInput = document.createElement('input');
        this.hexInput.type = 'text';
        this.hexInput.className = 'mp-rgb-hex-input';
        this.hexInput.value = rgbToHex(this.color.r, this.color.g, this.color.b).replace('#', '');
        this.hexInput.maxLength = 6;
        this.hexInput.addEventListener('input', () => {
            const hex = this.hexInput.value.trim();
            if (/^[0-9a-fA-F]{6}$/.test(hex)) {
                const rgb = hexToRgb('#' + hex);
                this.color.r = rgb.r;
                this.color.g = rgb.g;
                this.color.b = rgb.b;
                rInput.value = Math.round(this.color.r * 255).toString();
                gInput.value = Math.round(this.color.g * 255).toString();
                bInput.value = Math.round(this.color.b * 255).toString();
                rValue.textContent = Math.round(this.color.r * 255).toString();
                gValue.textContent = Math.round(this.color.g * 255).toString();
                bValue.textContent = Math.round(this.color.b * 255).toString();
                this.updatePreview();
                this.updateHexInputBg();
            }
        });
        this.updateHexInputBg();
        hexRow.appendChild(hexLabel);
        hexRow.appendChild(this.hexInput);
        container.appendChild(hexRow);
    }

    private syncFromSliders(): void {
        this.updatePreview();
        this.hexInput.value = rgbToHex(this.color.r, this.color.g, this.color.b).replace('#', '');
        this.updateHexInputBg();
        this.listeners.forEach(cb => { try { cb({ ...this.color }); } catch { /* ignore */ } });
    }

    private openPopup(): void {
        // Remove existing popup
        this.closePopup();

        const popup = document.createElement('div');
        popup.className = this.popupContainer ? 'mp-rgb-popup mp-rgb-popup--inline' : 'mp-rgb-popup';
        popup.addEventListener('click', (e) => e.stopPropagation());

        const popupSliders = document.createElement('div');
        popupSliders.className = 'mp-rgb-sliders';
        this.createSliders(popupSliders, true);

        this.confirmBtn = document.createElement('button');
        this.confirmBtn.className = 'mp-rgb-confirm-btn';
        this.confirmBtn.textContent = '确定';
        this.confirmBtn.addEventListener('click', () => this.closePopup());

        popup.appendChild(popupSliders);
        popup.appendChild(this.confirmBtn);

        if (this.popupContainer) {
            this.popupContainer.appendChild(popup);
            this.popupOverlay = popup;
            // 点击外部关闭
            this.documentClickListener = (e: MouseEvent) => {
                if (!popup.contains(e.target as Node) && e.target !== this.preview) {
                    this.closePopup();
                }
            };
            setTimeout(() => {
                document.addEventListener('click', this.documentClickListener!);
            }, 0);
        } else {
            this.popupOverlay = document.createElement('div');
            this.popupOverlay.className = 'mp-rgb-popup-overlay';
            this.popupOverlay.addEventListener('click', (e) => {
                if (e.target === this.popupOverlay) this.closePopup();
            });
            this.popupOverlay.appendChild(popup);
            document.body.appendChild(this.popupOverlay);
        }
    }

    private closePopup(): void {
        if (this.popupOverlay) {
            this.popupOverlay.remove();
            this.popupOverlay = null;
        }
        if (this.documentClickListener) {
            document.removeEventListener('click', this.documentClickListener);
            this.documentClickListener = null;
        }
    }

    getValue(): { r: number; g: number; b: number; a: number } {
        return { ...this.color };
    }

    setValue(value: { r: number; g: number; b: number; a?: number }): void {
        this.color.r = clamp01(value.r);
        this.color.g = clamp01(value.g);
        this.color.b = clamp01(value.b);
        if (value.a !== undefined) this.color.a = clamp01(value.a);
        this.updatePreview();
        this.updateHexInputBg();
        // Note: Can't update sliders directly in this simplified version without refs
    }

    configure(config: Partial<RGBColorPickerConfig>): void {
        if (config.color) this.setValue(config.color);
    }

    onChange(callback: (value: { r: number; g: number; b: number; a: number }) => void): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    dispose(): void {
        this.closePopup();
        if (this.documentClickListener) {
            document.removeEventListener('click', this.documentClickListener);
            this.documentClickListener = null;
        }
        this.listeners.clear();
        this.element.remove();
    }

    private injectStyles(): void {
        if (RGBColorPicker.stylesInjected) return;
        const style = document.createElement('style');
        style.textContent = `
            .mp-rgb-picker { display: flex; flex-direction: column; gap: 8px; }
            .mp-rgb-picker-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
            .mp-rgb-picker-label { font-size: 13px; color: var(--color-text-secondary); }
            .mp-color-preview {
                width: 40px; height: 30px; border-radius: 6px; border: 2px solid var(--color-border);
                cursor: pointer;
            }
            .mp-rgb-sliders { display: flex; flex-direction: column; gap: 12px; }
            .mp-rgb-slider-wrapper {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .mp-rgb-label {
                font-size: 12px;
                font-weight: 600;
                min-width: 20px;
            }
            .mp-rgb-label-r { color: var(--color-axis-x); }
            .mp-rgb-label-g { color: var(--color-axis-y); }
            .mp-rgb-label-b { color: var(--color-axis-z); }
            .mp-rgb-label-a { color: #bbbbbb; }
            .mp-rgb-slider {
                flex: 1;
                height: 6px;
                -webkit-appearance: none;
                appearance: none;
                border-radius: 3px;
                outline: none;
                cursor: pointer;
            }
            .mp-rgb-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                cursor: pointer;
                border: 2px solid white;
                //box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
            }
            .mp-rgb-slider::-webkit-slider-thumb:active {
                transform: scale(1.1);
            }
            .mp-rgb-slider::-moz-range-thumb {
                width: 18px;
                height: 18px;
                border-radius: 50%;
                cursor: pointer;
                border: 2px solid white;
                //box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
            }
            /* Slider colors */
            .mp-rgb-label-r + .mp-rgb-slider-wrapper .mp-rgb-slider,
            .mp-rgb-label-r + .mp-rgb-slider {
                background: linear-gradient(to right, var(--color-gradient-black), var(--color-axis-x));
            }
            .mp-rgb-label-r + .mp-rgb-slider-wrapper .mp-rgb-slider::-webkit-slider-thumb,
            .mp-rgb-label-r + .mp-rgb-slider::-webkit-slider-thumb {
                background: var(--color-axis-x);
            }
            .mp-rgb-label-r + .mp-rgb-slider-wrapper .mp-rgb-slider::-moz-range-thumb,
            .mp-rgb-label-r + .mp-rgb-slider::-moz-range-thumb {
                background: var(--color-axis-x);
            }
            .mp-rgb-label-g + .mp-rgb-slider-wrapper .mp-rgb-slider,
            .mp-rgb-label-g + .mp-rgb-slider {
                background: linear-gradient(to right, var(--color-gradient-black), var(--color-axis-y));
            }
            .mp-rgb-label-g + .mp-rgb-slider-wrapper .mp-rgb-slider::-webkit-slider-thumb,
            .mp-rgb-label-g + .mp-rgb-slider::-webkit-slider-thumb {
                background: var(--color-axis-y);
            }
            .mp-rgb-label-g + .mp-rgb-slider-wrapper .mp-rgb-slider::-moz-range-thumb,
            .mp-rgb-label-g + .mp-rgb-slider::-moz-range-thumb {
                background: var(--color-axis-y);
            }
            .mp-rgb-label-b + .mp-rgb-slider-wrapper .mp-rgb-slider,
            .mp-rgb-label-b + .mp-rgb-slider {
                background: linear-gradient(to right, var(--color-gradient-black), var(--color-axis-z));
            }
            .mp-rgb-label-b + .mp-rgb-slider-wrapper .mp-rgb-slider::-webkit-slider-thumb,
            .mp-rgb-label-b + .mp-rgb-slider::-webkit-slider-thumb {
                background: var(--color-axis-z);
            }
            .mp-rgb-label-b + .mp-rgb-slider-wrapper .mp-rgb-slider::-moz-range-thumb,
            .mp-rgb-label-b + .mp-rgb-slider::-moz-range-thumb {
                background: var(--color-axis-z);
            }
            .mp-rgb-label-a + .mp-rgb-slider-wrapper .mp-rgb-slider,
            .mp-rgb-label-a + .mp-rgb-slider {
                background: linear-gradient(to right, transparent, var(--color-text-disabled));
            }
            .mp-rgb-label-a + .mp-rgb-slider-wrapper .mp-rgb-slider::-webkit-slider-thumb,
            .mp-rgb-label-a + .mp-rgb-slider::-webkit-slider-thumb {
                background: #bbbbbb;
            }
            .mp-rgb-label-a + .mp-rgb-slider-wrapper .mp-rgb-slider::-moz-range-thumb,
            .mp-rgb-label-a + .mp-rgb-slider::-moz-range-thumb {
                background: var(--color-text-disabled);
            }
            /* Value display */
            .mp-rgb-value {
                min-width: 36px;
                font-size: 12px;
                font-weight: 500;
                color: var(--color-text-secondary);
                text-align: right;
                font-family: monospace;
                background-color: var(--color-bg);
                padding: 4px 8px;
                border-radius: 6px;
            }
            /* Hex row */
            .mp-rgb-hex-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
            .mp-rgb-hex-row span { font-size: 12px; color: var(--color-text-secondary); font-weight: 500; }
            .mp-rgb-hex-input {
                flex: 1;
                padding: 6px 10px;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                font-size: 13px;
                font-family: monospace;
                text-align: center;
            }
            .mp-rgb-hex-input:focus { outline: none; border-color: var(--color-accent); }
            /* Popup overlay */
            .mp-rgb-popup-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                //background: var(--color-overlay-bg);
                z-index: 60000;
                display: flex;
                align-items: center;
                justify-content: center;
                animation: mp-overlay-in 0.2s ease;
            }
            /* Popup container */
            .mp-rgb-popup {
                padding: 20px;
                background-color: var(--color-surface);
                border: 1px solid var(--color-border);
                border-radius: 12px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-width: 240px;
                max-width: 90vw;
                //box-shadow: var(--shadow-lg);
            }
            .mp-rgb-popup--inline {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 1000;
            }
            .mp-rgb-confirm-btn {
                padding: 8px 16px;
                background-color: var(--color-accent);
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                margin-top: 4px;
            }
            .mp-rgb-confirm-btn:active {
                transform: scale(0.98);
            }
            @keyframes mp-overlay-in {
                from { opacity: 0; }
                to { opacity: 1; }
            }
        `;
        document.head.appendChild(style);
        RGBColorPicker.stylesInjected = true;
    }
}