import type { ISharedComponent, DropdownConfig } from './types';
import { icons } from './IconRegistry';
import { injectStyles } from '../../styles/mainWindow.css';
import { dropdownStyles } from '../../styles/shared/dropdown.css';

export class Dropdown implements ISharedComponent<DropdownConfig, string> {
    readonly element: HTMLElement;
    private display: HTMLElement;
    private displayText: HTMLElement;
    private arrowIcon: SVGElement;
    private optionsContainer: HTMLElement;
    private options: { label: string; value: string }[] = [];
    private value: string;
    private placeholder: string;
    private label: string | undefined;
    private isOpen = false;
    private listeners = new Set<(value: string) => void>();
    private static stylesInjected = false;
    private documentClickHandler: () => void;

    constructor(config: DropdownConfig) {
        this.injectStyles();
        this.options = config.options;
        this.value = config.selectedValue;
        this.placeholder = config.placeholder ?? '请选择';
        this.label = config.label;

        // 如果有 label，创建外层容器
        if (this.label) {
            this.element = document.createElement('div');
            this.element.className = 'mp-dropdown-item';

            const labelEl = document.createElement('span');
            labelEl.className = 'mp-dropdown-label';
            labelEl.textContent = this.label;
            this.element.appendChild(labelEl);

            const dropdownContainer = document.createElement('div');
            dropdownContainer.className = 'mp-dropdown';
            this.element.appendChild(dropdownContainer);
        } else {
            this.element = document.createElement('div');
            this.element.className = 'mp-dropdown';
        }

        const container = this.label ? this.element.querySelector('.mp-dropdown') as HTMLElement : this.element;

        this.display = document.createElement('div');
        this.display.className = 'mp-dropdown-display';

        this.displayText = document.createElement('span');
        this.displayText.className = 'mp-dropdown-text';
        this.syncDisplayText();

        this.arrowIcon = icons.chevronRight({ size: 20 });
        this.arrowIcon.setAttribute('class', 'mp-dropdown-arrow');

        this.display.appendChild(this.displayText);
        this.display.appendChild(this.arrowIcon);

        this.optionsContainer = document.createElement('div');
        this.optionsContainer.className = 'mp-dropdown-options';
        this.renderOptions();

        container.appendChild(this.display);
        container.appendChild(this.optionsContainer);

        // 点击展示区切换下拉
        this.display.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // 全局点击关闭
        this.documentClickHandler = () => {
            if (this.isOpen) this.close();
        };
        document.addEventListener('click', this.documentClickHandler);
    }

    private syncDisplayText(): void {
        const selected = this.options.find(o => o.value === this.value);
        this.displayText.textContent = selected ? selected.label : this.placeholder;
    }

    private renderOptions(): void {
        this.optionsContainer.innerHTML = '';
        for (const option of this.options) {
            const item = document.createElement('div');
            item.className = 'mp-dropdown-option';
            item.textContent = option.label;
            if (option.value === this.value) {
                item.classList.add('selected');
            }
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.select(option.value);
            });
            this.optionsContainer.appendChild(item);
        }
    }

    private select(value: string): void {
        if (this.value === value) return;
        this.value = value;
        this.syncDisplayText();
        this.renderOptions();
        this.close();
        this.listeners.forEach(cb => { try { cb(value); } catch { /* ignore */ } });
    }

    private open(): void {
        // 关闭其他打开的 dropdown（在最近的面板容器内查询，避免全局DOM扫描）
        const scope = this.element.closest('.panel-content, .side-panel-content, .render-ui-panel') || this.element.parentElement;
        const queryRoot = scope || document;
        queryRoot.querySelectorAll('.mp-dropdown.open').forEach(openDropdown => {
            if (openDropdown !== this.getDropdownContainer()) {
                openDropdown.classList.remove('open');
            }
        });
        this.getDropdownContainer().classList.add('open');
        this.isOpen = true;
    }

    private close(): void {
        this.getDropdownContainer().classList.remove('open');
        this.isOpen = false;
    }

    private getDropdownContainer(): HTMLElement {
        return this.label ? this.element.querySelector('.mp-dropdown') as HTMLElement : this.element;
    }

    toggle(): void {
        if (this.isOpen) this.close();
        else this.open();
    }

    getValue(): string {
        return this.value;
    }

    setValue(value: string): void {
        this.value = value;
        this.syncDisplayText();
        this.renderOptions();
    }

    setOptions(options: { label: string; value: string }[]): void {
        this.options = options;
        this.renderOptions();
    }

    configure(config: Partial<DropdownConfig>): void {
        if (config.options) {
            this.options = config.options;
            this.renderOptions();
        }
        if (config.selectedValue !== undefined) {
            this.setValue(config.selectedValue);
        }
        if (config.placeholder !== undefined) {
            this.placeholder = config.placeholder;
            this.syncDisplayText();
        }
    }

    onChange(callback: (value: string) => void): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    dispose(): void {
        document.removeEventListener('click', this.documentClickHandler);
        this.listeners.clear();
        this.element.remove();
    }

    private injectStyles(): void {
        if (Dropdown.stylesInjected) return;
        injectStyles(dropdownStyles, 'component-dropdown');
        Dropdown.stylesInjected = true;
    }
}
