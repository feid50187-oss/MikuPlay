
import type { IPanel } from '../../../core';
import type { SceneManager } from '../../../features/scene';
import { injectStyles } from '../../../styles/mainWindow.css';
import { worldPanelStyles } from '../../../styles/panels/worldPanel.css';
import { ToggleSwitch } from '../../shared/ToggleSwitch';
import { LightingSection } from './LightingSection';
import { BackgroundSection } from './BackgroundSection';
import { GroundSection } from './GroundSection';
import { ParticleSection } from './ParticleSection';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

export class WorldPanel implements IPanel {
    readonly id = 'world';
    readonly tabLabel = '环境';
    readonly tabIcon = TAB_ICON;
    readonly element: HTMLElement;

    private sceneManager: SceneManager | null;
    private gridVisible: boolean;
    private onGridToggle?: (visible: boolean) => void;

    private lightingSection: LightingSection | null = null;
    private backgroundSection: BackgroundSection | null = null;
    private groundSection: GroundSection | null = null;
    private particleSection: ParticleSection | null = null;

    private gridToggle: ToggleSwitch | null = null;

    constructor(options: {
        sceneManager: SceneManager | null;
        gridVisible: boolean;
        onGridToggle?: (visible: boolean) => void;
    }) {
        this.sceneManager = options.sceneManager;
        this.gridVisible = options.gridVisible;
        this.onGridToggle = options.onGridToggle;

        injectStyles(worldPanelStyles, 'panel-world');
        this.element = this.create();
    }

    private create(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'world-panel';

        const gridToggle = this.createGridToggle();

        this.lightingSection = new LightingSection(this.sceneManager);
        this.backgroundSection = new BackgroundSection(this.sceneManager);
        this.groundSection = new GroundSection(this.sceneManager);
        this.particleSection = new ParticleSection(this.sceneManager);

        panel.appendChild(gridToggle.element);
        panel.appendChild(this.lightingSection.element);
        panel.appendChild(this.backgroundSection.element);
        panel.appendChild(this.groundSection.element);
        panel.appendChild(this.particleSection.element);

        this.setupGridVisibilityListener();

        return panel;
    }

    private createGridToggle(): ToggleSwitch {
        this.gridToggle = new ToggleSwitch({
            label: '坐标网',
            initialState: this.gridVisible
        });
        this.gridToggle.onChange((visible) => {
            this.gridVisible = visible;
            this.onGridToggle?.(visible);
        });
        return this.gridToggle;
    }

    private setupGridVisibilityListener(): void {
        if (this.sceneManager) {
            this.sceneManager.on('gridVisibilityChanged', (visible: boolean) => {
                if (this.gridToggle) {
                    this.gridToggle.setValue(visible);
                }
            });
        }
    }

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        this.element.remove();
    }

    dispose(): void {
        this.lightingSection?.dispose();
        this.backgroundSection?.dispose();
        this.groundSection?.dispose();
        this.particleSection?.dispose();
        this.gridToggle?.dispose();

        this.lightingSection = null;
        this.backgroundSection = null;
        this.groundSection = null;
        this.particleSection = null;
        this.gridToggle = null;

        this.element.remove();
    }
}
