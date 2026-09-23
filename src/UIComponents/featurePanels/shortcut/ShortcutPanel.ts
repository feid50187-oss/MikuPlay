import type { IPanel } from '../../../core/IPanel';
import type { MainWindow } from '../../MainWindow';
import { injectStyles } from '../../../styles/mainWindow.css';
import { shortcutPanelStyles } from '../../../styles/panels/shortcutPanel.css';
import { ShadingSection } from './ShadingSection';
import { BoneParentingSection } from './BoneParentingSection';
import { showSafeAreaTuner } from '../../../utils/safeArea';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

interface ShortcutPanelOptions {
    mainWindow?: MainWindow;
}

export class ShortcutPanel implements IPanel {
    readonly id = 'shortcut';
    readonly tabLabel = '杂项';
    readonly tabIcon = TAB_ICON;
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private shadingSection: ShadingSection | null = null;
    private parentingSection: BoneParentingSection | null = null;

    constructor(options: ShortcutPanelOptions = {}) {
        this.mainWindow = options.mainWindow ?? null;
        injectStyles(shortcutPanelStyles, 'panel-shortcut');
        this.element = this.create();
    }

    private create(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'shortcut-panel';

        this.shadingSection = new ShadingSection({ mainWindow: this.mainWindow });
        panel.appendChild(this.shadingSection.element);

        this.parentingSection = new BoneParentingSection({ mainWindow: this.mainWindow });
        panel.appendChild(this.parentingSection.element);

        // 安全区校准入口
        const safeAreaSection = this.createSafeAreaSection();
        panel.appendChild(safeAreaSection);

        return panel;
    }

    private createSafeAreaSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'shortcut-section';
        section.style.cssText = 'padding: 12px 16px;';

        const title = document.createElement('div');
        title.className = 'shortcut-section-title';
        title.textContent = '安全区';
        title.style.cssText = `
            font-size: 13px;
            color: var(--color-text-secondary);
            margin-bottom: 4px;
            font-weight: 500;
        `;

        const btn = document.createElement('button');
        btn.className = 'shortcut-safe-area-btn';
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" style="margin-right:8px;">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M12 8v4"/>
                <path d="M12 16h.01"/>
            </svg>
            校准显示区域
        `;
        btn.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            padding: 12px;
            margin-top: 8px;
            background-color: var(--color-accent);
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
            transition: transform 0.2s ease;
        `;
        btn.addEventListener('click', () => showSafeAreaTuner());

        section.appendChild(title);
        section.appendChild(btn);
        return section;
    }

    //region IPanel Lifecycle

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        this.element.remove();
    }

    dispose(): void {
        this.shadingSection?.dispose();
        this.shadingSection = null;
        this.parentingSection?.dispose();
        this.parentingSection = null;
        this.element.remove();
    }

    onShown(): void {
        this.shadingSection?.syncOutlineFromState();
    }

    onHidden(): void {
        // no-op
    }

    //endregion
}