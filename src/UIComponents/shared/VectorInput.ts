
import type { ISharedComponent } from './types';
import { injectStyles } from '../../styles/mainWindow.css';
import { vectorInputStyles } from '../../styles/shared/vector-input.css';

export interface VectorInputConfig {
    label: string;
    components: { name: string; value: number; min: number; max: number; step: number }[];
}

export class VectorInput implements ISharedComponent<VectorInputConfig, number[]> {
    readonly element: HTMLElement;
    private config: VectorInputConfig;
    private componentInputs: HTMLInputElement[] = [];
    private listeners = new Set<(value: number[]) => void>();
    private static stylesInjected = false;

    constructor(config: VectorInputConfig) {
        this.injectStyles();
        this.config = config;

        this.element = document.createElement('div');
        this.element.className = 'mp-vector-input';

        const label = document.createElement('span');
        label.className = 'mp-vector-input-label';
        label.textContent = config.label;
        this.element.appendChild(label);

        const inputsRow = document.createElement('div');
        inputsRow.className = 'mp-vector-input-row';

        for (const comp of config.components) {
            const compContainer = document.createElement('div');
            compContainer.className = 'mp-vector-component';

            const compLabel = document.createElement('span');
            compLabel.className = 'mp-vector-comp-label';
            compLabel.textContent = comp.name;
            compLabel.setAttribute('data-axis', comp.name.toLowerCase());

            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'mp-vector-comp-input';
            input.value = String(comp.value);
            input.step = String(comp.step);
            input.min = String(comp.min);
            input.max = String(comp.max);
            input.addEventListener('input', () => {
                this.notifyListeners();
            });

            compContainer.appendChild(compLabel);
            compContainer.appendChild(input);
            inputsRow.appendChild(compContainer);
            this.componentInputs.push(input);
        }

        this.element.appendChild(inputsRow);
    }

    private notifyListeners(): void {
        const values = this.componentInputs.map(inp => parseFloat(inp.value) || 0);
        this.listeners.forEach(cb => { try { cb(values); } catch { /* ignore */ } });
    }

    getValue(): number[] {
        return this.componentInputs.map(inp => parseFloat(inp.value) || 0);
    }

    setValue(values: number[]): void {
        for (let i = 0; i < this.componentInputs.length && i < values.length; i++) {
            this.componentInputs[i].value = String(values[i]);
        }
    }

    configure(config: Partial<VectorInputConfig>): void {
        if (config.components) {
            this.config = { ...this.config, ...config };
            for (let i = 0; i < config.components.length && i < this.componentInputs.length; i++) {
                const comp = config.components[i];
                this.componentInputs[i].value = String(comp.value);
                this.componentInputs[i].min = String(comp.min);
                this.componentInputs[i].max = String(comp.max);
                this.componentInputs[i].step = String(comp.step);
            }
        }
    }

    onChange(callback: (value: number[]) => void): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    dispose(): void {
        this.listeners.clear();
        this.element.remove();
    }

    private injectStyles(): void {
        if (VectorInput.stylesInjected) return;
        injectStyles(vectorInputStyles, 'component-vectorinput');
        VectorInput.stylesInjected = true;
    }
}
