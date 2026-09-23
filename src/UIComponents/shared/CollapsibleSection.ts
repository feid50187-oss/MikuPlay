
import type { ISharedComponent, CollapsibleConfig } from './types';
import { icons } from './IconRegistry';
import { injectStyles } from '../../styles/mainWindow.css';
import { collapsibleStyles } from '../../styles/shared/collapsible.css';

export class CollapsibleSection implements ISharedComponent<CollapsibleConfig, boolean> {
    readonly element: HTMLElement;
    private header: HTMLElement;
    private arrowIcon: SVGElement;
    private contentContainer: HTMLElement;
    private contentInner: HTMLElement;
    private isExpanded: boolean;
    private listeners = new Set<(value: boolean) => void>();
    private static stylesInjected = false;

    constructor(config: CollapsibleConfig) {
        this.injectStyles();
        this.isExpanded = config.initiallyExpanded ?? false;

        // 外层容器
        this.element = document.createElement('div');
        this.element.className = 'mp-collapsible-section';
        if (this.isExpanded) {
            this.element.classList.add('expanded');
        }

        // 头部（可点击）
        this.header = document.createElement('div');
        this.header.className = 'mp-collapsible-header';

        this.arrowIcon = icons.chevronRight({ size: 20, color: 'var(--color-accent)' });
        this.arrowIcon.classList.add('mp-collapsible-arrow');
        if (this.isExpanded) {
            this.arrowIcon.style.transform = 'rotate(90deg)';
        }

        const title = document.createElement('span');
        title.className = 'mp-collapsible-title';
        title.textContent = config.title;

        this.header.appendChild(title);
        this.header.appendChild(this.arrowIcon);

        // 内容容器（grid 外层，控制 grid-template-rows 动画）
        this.contentContainer = document.createElement('div');
        this.contentContainer.className = 'mp-collapsible-content';

        // 内容内层（min-height: 0 保证 grid 0fr 可收缩到 0）
        this.contentInner = document.createElement('div');
        this.contentInner.className = 'mp-collapsible-inner';
        this.contentContainer.appendChild(this.contentInner);

        this.element.appendChild(this.header);
        this.element.appendChild(this.contentContainer);

        this.header.addEventListener('click', () => {
            this.toggle();
        });
    }

    /** 获取内容容器，向其中添加子元素 */
    getContentContainer(): HTMLElement {
        return this.contentInner;
    }

    getValue(): boolean {
        return this.isExpanded;
    }

    setValue(expanded: boolean): void {
        if (this.isExpanded === expanded) return;
        this.isExpanded = expanded;
        this.updateUI();
        this.listeners.forEach(cb => { try { cb(expanded); } catch { /* ignore */ } });
    }

    toggle(): void {
        this.setValue(!this.isExpanded);
    }

    private updateUI(): void {
        if (this.isExpanded) {
            this.element.classList.add('expanded');
            this.arrowIcon.style.transform = 'rotate(90deg)';
        } else {
            this.element.classList.remove('expanded');
            this.arrowIcon.style.transform = 'rotate(0deg)';
        }
    }

    configure(config: Partial<CollapsibleConfig>): void {
        if (config.title !== undefined) {
            const titleEl = this.header.querySelector('.mp-collapsible-title');
            if (titleEl) titleEl.textContent = config.title;
        }
        if (config.initiallyExpanded !== undefined) {
            this.setValue(config.initiallyExpanded);
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
        if (CollapsibleSection.stylesInjected) return;
        injectStyles(collapsibleStyles, 'component-collapsible');
        CollapsibleSection.stylesInjected = true;
    }
}
