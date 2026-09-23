
import type { ISharedComponent, ToggleConfig } from './types';
import { injectStyles } from '../../styles/mainWindow.css';
import { toggleSwitchStyles } from '../../styles/shared/toggle-switch.css';

export class ToggleSwitch implements ISharedComponent<ToggleConfig, boolean> {
    readonly element: HTMLElement;
    private toggleSwitch: HTMLElement;
    private labelElement: HTMLElement;
    private value: boolean;
    private listeners = new Set<(value: boolean) => void>();
    private static stylesInjected = false;

    constructor(config: ToggleConfig) {
        this.injectStyles();
        this.value = config.initialState ?? false;

        this.element = document.createElement('div');
        this.element.className = 'mp-toggle-item';

        this.labelElement = document.createElement('span');
        this.labelElement.className = 'mp-toggle-label';
        this.labelElement.textContent = config.label;

        this.toggleSwitch = document.createElement('div');
        this.toggleSwitch.className = 'mp-toggle-switch';
        if (this.value) {
            this.toggleSwitch.classList.add('active');
        }

        this.element.appendChild(this.labelElement);
        this.element.appendChild(this.toggleSwitch);

        this.toggleSwitch.addEventListener('click', () => {
            this.toggle();
        });
    }

    getValue(): boolean {
        return this.value;
    }

    setValue(value: boolean): void {
        if (this.value === value) return;
        this.value = value;
        this.toggleSwitch.classList.toggle('active', value);
        this.listeners.forEach(cb => { try { cb(value); } catch { /* ignore */ } });
    }

    toggle(): void {
        this.setValue(!this.value);
    }

    configure(config: Partial<ToggleConfig>): void {
        if (config.label !== undefined) {
            this.labelElement.textContent = config.label;
        }
        if (config.initialState !== undefined) {
            this.setValue(config.initialState);
        }
    }

    onChange(callback: (value: boolean) => void): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    dispose(): void {
        this.listeners.clear();
        this.element.remove();
    }

    private injectStyles(): void {
        if (ToggleSwitch.stylesInjected) return;
        injectStyles(toggleSwitchStyles, 'component-toggleswitch');
        ToggleSwitch.stylesInjected = true;
    }
}
