
import type { IPanel } from '../../core/IPanel';
import type { PluginEntry, UIPluginExports, PluginContext } from '../../core/IPlugin';
import type { FrameControlCallbacks } from './import/ImportPanelServices';
import { injectStyles } from '../../styles/mainWindow.css';
import { navBarStyles } from '../../styles/components/navBar.css';
import { MainWindow } from '../MainWindow';

interface NavItem {
    id: string;
    label: string;
}

interface PanelModuleWithDefault {
    default?: new (...args: any[]) => IPanel;
}

interface PanelContext {
    mainWindow: MainWindow | null;
}

interface PanelRegistration {
    id: string;
    label: string;
    moduleLoader: () => Promise<PanelModuleWithDefault>;
    factory: (module: PanelModuleWithDefault, context: PanelContext) => IPanel | null;
}

export class NavBar {
    private container: HTMLElement;
    private navBarWrapper: HTMLElement;
    private navItemsContainer: HTMLElement;
    private expandButton: HTMLElement;
    private panelContainer: HTMLElement;
    private panelContent: HTMLElement;

    private currentActiveIndex: number = 0;
    private isExpanded: boolean = false;
    private panelRegistry: Map<string, IPanel> = new Map();
    private panelRegistrations: Map<string, PanelRegistration> = new Map();
    private navItems: NavItem[] = [];
    private currentPanelId: string | undefined = undefined;
    private mainWindow: MainWindow | null = null;
    private frameControlCallbacks: FrameControlCallbacks | null = null;

    constructor(mainWindow?: MainWindow, frameControlCallbacks?: FrameControlCallbacks) {
        injectStyles(navBarStyles, 'component-navbar');

        this.mainWindow = mainWindow || null;
        this.frameControlCallbacks = frameControlCallbacks || null;

        this.container = this.createContainer();
        this.navBarWrapper = this.createNavBarWrapper();
        this.navItemsContainer = this.createNavItemsContainer();
        this.expandButton = this.createExpandButton();
        this.panelContainer = this.createPanelContainer();
        this.panelContent = this.createPanelContent();

        this.navBarWrapper.appendChild(this.navItemsContainer);
        this.navBarWrapper.appendChild(this.expandButton);
        this.container.appendChild(this.panelContainer);
        this.container.appendChild(this.navBarWrapper);

        // 注册内置面板
        const ctx: PanelContext = { mainWindow: this.mainWindow };

        this.registerPanel({
            id: 'import',
            label: '导入',
            moduleLoader: () => import('./import'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                const services = ctx.mainWindow?.getImportPanelServices();
                return services ? new module.default(services, this.frameControlCallbacks) : null;
            }
        });

        this.registerPanel({
            id: 'world',
            label: '环境',
            moduleLoader: () => import('./world'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                return new module.default({
                    sceneManager: ctx.mainWindow?.getSceneManager() ?? null,
                    gridVisible: ctx.mainWindow?.getGridVisible() ?? true,
                    onGridToggle: (visible: boolean) => { ctx.mainWindow?.setGridVisible(visible); }
                });
            }
        });

        this.registerPanel({
            id: 'model',
            label: '模型',
            moduleLoader: () => import('./model'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                return new module.default({ mainWindow: ctx.mainWindow ?? undefined });
            }
        });

        this.registerPanel({
            id: 'shading',
            label: '着色',
            moduleLoader: () => import('./shading'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                return new module.default({ mainWindow: ctx.mainWindow ?? undefined });
            }
        });

        this.registerPanel({
            id: 'library',
            label: '内容库',
            moduleLoader: () => import('./contentLibrary'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                return new module.default({ mainWindow: ctx.mainWindow ?? undefined });
            }
        });

        this.registerPanel({
            id: 'postprocess',
            label: '后处理',
            moduleLoader: () => import('./postProcPanel'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                return new module.default({
                    mainWindow: ctx.mainWindow ?? undefined,
                    sceneManager: ctx.mainWindow?.getSceneManager() ?? null
                });
            }
        });

        this.registerPanel({
            id: 'lights',
            label: '灯光',
            moduleLoader: () => import('./lights'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                return new module.default({ mainWindow: ctx.mainWindow ?? undefined });
            }
        });

        this.registerPanel({
            id: 'director',
            label: '导演模式',
            moduleLoader: () => import('./director'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                return new module.default({ mainWindow: ctx.mainWindow ?? undefined });
            }
        });

        
        this.registerPanel({
            id: 'shortcut',
            label: '杂项',
            moduleLoader: () => import('./shortcut'),
            factory: (module, ctx) => {
                if (!module.default) return null;
                return new module.default({ mainWindow: ctx.mainWindow ?? undefined });
            }
        });

        this.updateActiveItem(0);
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'nav-bar-container';
        return container;
    }

    private createNavBarWrapper(): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'nav-bar-wrapper';
        return wrapper;
    }

    private createNavItemsContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'nav-items-container';
        return container;
    }

    private createExpandButton(): HTMLElement {
        const button = document.createElement('div');
        button.className = 'expand-button';
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
        `;
        button.addEventListener('click', () => this.togglePanel());
        return button;
    }

    private createPanelContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'panel-container';
        return container;
    }

    private createPanelContent(): HTMLElement {
        const content = document.createElement('div');
        content.className = 'panel-content';
        this.panelContainer.appendChild(content);
        return content;
    }

    public registerPanel(registration: PanelRegistration): void {
        this.panelRegistrations.set(registration.id, registration);

        const index = this.navItems.length;
        const navItem: NavItem = { id: registration.id, label: registration.label };
        this.navItems.push(navItem);

        const navButton = document.createElement('div');
        navButton.className = 'nav-item';
        navButton.dataset.index = index.toString();

        const label = document.createElement('span');
        label.className = 'nav-item-label';
        label.textContent = registration.label;

        const indicator = document.createElement('div');
        indicator.className = 'nav-indicator';

        navButton.appendChild(label);
        navButton.appendChild(indicator);

        // 用 registration.id 查找索引而非闭包捕获，避免 reindex 时克隆 DOM
        const panelId = registration.id;
        navButton.addEventListener('click', () => {
            const idx = this.navItems.findIndex(item => item.id === panelId);
            if (idx !== -1) this.handleNavItemClick(idx);
        });

        this.navItemsContainer.appendChild(navButton);
    }

    public unregisterPanel(id: string): void {
        this.panelRegistrations.delete(id);
        const index = this.navItems.findIndex(item => item.id === id);
        if (index !== -1) {
            this.navItems.splice(index, 1);
            // 移除对应的导航按钮 DOM 元素
            const navButtons = this.navItemsContainer.querySelectorAll('.nav-item');
            navButtons[index]?.remove();
            // 重新计算剩余按钮的 index
            this.reindexNavButtons();
            // 调整活跃索引
            if (this.currentActiveIndex >= this.navItems.length) {
                this.currentActiveIndex = Math.max(0, this.navItems.length - 1);
            }
            this.updateActiveItem(this.currentActiveIndex);
        }
        // 销毁已加载的面板
        const panel = this.panelRegistry.get(id);
        if (panel) {
            panel.unmount();
            panel.dispose();
            this.panelRegistry.delete(id);
        }
        if (this.currentPanelId === id) {
            this.currentPanelId = undefined;
        }
    }

    /**
     * 注册 UI 型插件为新的导航选项卡
     */
    public registerPluginTab(entry: PluginEntry, mainWindow: MainWindow): void {
        if (entry.manifest.type !== 'ui') return;

        const adapter = new PluginPanelAdapter(entry, mainWindow);
        
        this.registerPanel({
            id: entry.manifest.id,
            label: entry.manifest.name,
            moduleLoader: async () => ({ default: adapter as unknown as new () => IPanel }),
            factory: (module) => {
                const panel = (module as unknown as { default: IPanel }).default;
                return panel;
            },
        });
    }

    private reindexNavButtons(): void {
        const navButtons = this.navItemsContainer.querySelectorAll<HTMLElement>('.nav-item');
        navButtons.forEach((button, i) => {
            button.dataset.index = i.toString();
        });
    }

    private handleNavItemClick(index: number): void {
        if (this.currentActiveIndex === index) {
            this.togglePanel();
        } else {
            this.updateActiveItem(index);
            if (!this.isExpanded) {
                this.expandPanel();
            }
            this.loadPanelContent(index);
        }
    }

    private updateActiveItem(index: number): void {
        this.currentActiveIndex = index;

        const navItems = this.navItemsContainer.querySelectorAll('.nav-item');
        navItems.forEach((item, i) => {
            if (i === index) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    private togglePanel(): void {
        if (this.isExpanded) {
            this.collapsePanel();
        } else {
            this.expandPanel();
            this.loadPanelContent(this.currentActiveIndex);
        }
    }

    private expandPanel(): void {
        this.isExpanded = true;
        this.panelContainer.classList.add('expanded');
        this.expandButton.classList.add('expanded');
    }

    private collapsePanel(): void {
        this.isExpanded = false;
        this.panelContainer.classList.remove('expanded');
        this.expandButton.classList.remove('expanded');
    }

    private async loadPanelContent(index: number): Promise<void> {
        const navItem = this.navItems[index];
        if (!navItem) return;

        try {
            let panel = this.panelRegistry.get(navItem.id);

            if (!panel) {
                const reg = this.panelRegistrations.get(navItem.id);
                if (!reg) {
                    console.error(`面板 ${navItem.id} 未注册`);
                    return;
                }
                const module = await reg.moduleLoader();
                const ctx: PanelContext = { mainWindow: this.mainWindow };
                const newPanel = reg.factory(module, ctx);
                if (!newPanel) {
                    console.error(`面板 ${navItem.id} 实例化失败`);
                    return;
                }
                this.panelRegistry.set(navItem.id, newPanel);
                panel = newPanel;
            }

            this.switchToPanel(panel, navItem.id);
        } catch (error) {
            console.error(`面板 ${navItem.id} 加载失败`, error);
        }
    }

    private switchToPanel(newPanel: IPanel, newPanelId: string): void {
        // 隐藏旧面板（仅切换可见性，不销毁 DOM）
        if (this.currentPanelId && this.currentPanelId !== newPanelId) {
            const oldPanel = this.panelRegistry.get(this.currentPanelId);
            if (oldPanel) {
                oldPanel.element.style.display = 'none';
                oldPanel.onHidden?.();
            }
        }

        // 显示新面板：若未挂载则挂载，否则仅取消隐藏
        if (!newPanel.element.parentElement) {
            newPanel.mount(this.panelContent);
        }
        newPanel.element.style.display = '';
        newPanel.onShown?.();
        this.currentPanelId = newPanelId;
    }

    public getElement(): HTMLElement {
        return this.container;
    }

    public getCurrentActiveIndex(): number {
        return this.currentActiveIndex;
    }

    public isPanelExpanded(): boolean {
        return this.isExpanded;
    }

    public setActiveItem(index: number): void {
        if (index >= 0 && index < this.navItems.length) {
            this.updateActiveItem(index);
            if (this.isExpanded) {
                this.loadPanelContent(index);
            }
        }
    }

    public expand(): void {
        if (!this.isExpanded) {
            this.expandPanel();
            this.loadPanelContent(this.currentActiveIndex);
        }
    }

    public collapse(): void {
        if (this.isExpanded) {
            this.collapsePanel();
        }
    }

    public getPanel(panelId: string): IPanel | undefined {
        return this.panelRegistry.get(panelId);
    }

    public dispose(): void {
        this.panelRegistry.forEach(panel => {
            panel.unmount();
            panel.dispose();
        });
        this.panelRegistry.clear();
        this.currentPanelId = undefined;
    }
}

/**
 * 将 UI 型插件的 createPanel 返回值适配为 IPanel 接口
 */
class PluginPanelAdapter implements IPanel {
    readonly id: string;
    readonly tabLabel: string;
    readonly tabIcon = 'extension';
    readonly element: HTMLElement;
    private entry: PluginEntry;
    private mainWindow: MainWindow;
    private mounted = false;

    constructor(entry: PluginEntry, mainWindow: MainWindow) {
        this.entry = entry;
        this.mainWindow = mainWindow;
        this.id = entry.manifest.id;
        this.tabLabel = entry.manifest.name;
        this.element = document.createElement('div');
    }

    mount(container: HTMLElement): void {
        if (!this.mounted) {
            const uiData = this.entry.data as UIPluginExports;
            const context = this.mainWindow.createPluginContext(this.entry.manifest.id);
            const panelElement = uiData.createPanel(context);
            if (panelElement) {
                this.element.appendChild(panelElement);
            }
            this.mounted = true;
        }
        container.appendChild(this.element);
    }

    unmount(): void {
        this.element.remove();
    }

    onShown(): void {
        const uiData = this.entry.data as UIPluginExports;
        uiData.onShown?.();
    }

    onHidden(): void {
        const uiData = this.entry.data as UIPluginExports;
        uiData.onHidden?.();
    }

    dispose(): void {
        const uiData = this.entry.data as UIPluginExports;
        uiData.dispose?.();
    }
}
