
import type { ISharedComponent, SliderConfig } from './types';
import { clamp } from '../../utils/format';
import { injectStyles } from '../../styles/mainWindow.css';
import { sliderStyles } from '../../styles/shared/slider.css';
import { theme } from '../../styles/theme';
import { themeStateManager } from '../../features/state';

export class Slider implements ISharedComponent<SliderConfig, number> {
    readonly element: HTMLElement;
    private input: HTMLInputElement;
    private valueDisplay: HTMLElement | null = null;
    private config: SliderConfig;
    private listeners = new Set<(value: number) => void>();
    private static stylesInjected = false;

    // 缓存 min/max 为数字，避免 updateSliderFill 每次解析 DOM 属性
    private _min: number;
    private _max: number;

    // RAF 节流：合并同一帧内的多次 input 事件
    private _rafPending = false;

    private _unsubscribeTheme: (() => void) | null = null;

    constructor(config: SliderConfig) {
        this.injectStyles();
        this.config = { ...config };
        const value = clamp(config.value, config.min, config.max);
        this._min = config.min;
        this._max = config.max;

        this.element = document.createElement('div');
        this.element.className = 'mp-slider-item';

        // 主题变化时重绘滑块填充色
        this._unsubscribeTheme = themeStateManager.subscribe(() => {
            this.updateSliderFill();
        });

        const labelRow = document.createElement('div');
        labelRow.className = 'mp-slider-label-row';

        const label = document.createElement('span');
        label.className = 'mp-slider-label';
        label.textContent = config.label;
        labelRow.appendChild(label);

        if (config.showValue !== false) {
            this.valueDisplay = document.createElement('span');
            this.valueDisplay.className = 'mp-slider-value';
            this.valueDisplay.textContent = this.formatValue(value);
            labelRow.appendChild(this.valueDisplay);
        }

        const inputContainer = document.createElement('div');
        inputContainer.className = 'mp-slider-container';

        this.input = document.createElement('input');
        this.input.type = 'range';
        this.input.className = 'mp-slider';
        this.input.min = String(config.min);
        this.input.max = String(config.max);
        this.input.step = String(config.step);
        this.input.value = String(value);

        this.input.addEventListener('input', () => {
            // RAF 节流：同一帧内多次 input 仅触发一次更新
            if (!this._rafPending) {
                this._rafPending = true;
                requestAnimationFrame(() => {
                    this._rafPending = false;
                    const newValue = parseFloat(this.input.value);
                    if (this.valueDisplay) {
                        this.valueDisplay.textContent = this.formatValue(newValue);
                    }
                    this.updateSliderFill();
                    this.listeners.forEach(cb => { try { cb(newValue); } catch { /* ignore */ } });
                });
            }
        });

        inputContainer.appendChild(this.input);
        this.element.appendChild(labelRow);
        this.element.appendChild(inputContainer);

        this.updateSliderFill();
    }

    private formatValue(value: number): string {
        if (this.config.valueFormatter) {
            return this.config.valueFormatter(value);
        }
        // 智能精度：step < 1 时显示小数
        if (this.config.step < 1) {
            const decimals = Math.max(0, Math.ceil(-Math.log10(this.config.step)));
            return value.toFixed(decimals);
        }
        return String(Math.round(value));
    }

    getValue(): number {
        return parseFloat(this.input.value);
    }

    setValue(value: number): void {
        const clamped = clamp(value, this.config.min, this.config.max);
        this.input.value = String(clamped);
        if (this.valueDisplay) {
            this.valueDisplay.textContent = this.formatValue(clamped);
        }
        this.updateSliderFill();
    }

    configure(config: Partial<SliderConfig>): void {
        Object.assign(this.config, config);
        if (config.min !== undefined) { this._min = config.min; this.input.min = String(config.min); }
        if (config.max !== undefined) { this._max = config.max; this.input.max = String(config.max); }
        if (config.step !== undefined) this.input.step = String(config.step);
        if (config.value !== undefined) this.setValue(config.value);
    }

    onChange(callback: (value: number) => void): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    dispose(): void {
        this.listeners.clear();
        this._unsubscribeTheme?.();
        this._unsubscribeTheme = null;
        this.element.remove();
    }

    private injectStyles(): void {
        if (Slider.stylesInjected) return;
        injectStyles(sliderStyles, 'component-slider');
        Slider.stylesInjected = true;
    }

    private updateSliderFill(): void {
        const val = parseFloat(this.input.value);
        const percent = ((val - this._min) / (this._max - this._min)) * 100;
        this.input.style.background = `linear-gradient(to right, ${theme.accentColor} 0%, ${theme.accentColor} ${percent}%, ${theme.borderColor} ${percent}%, ${theme.borderColor} 100%)`;
    }
}
