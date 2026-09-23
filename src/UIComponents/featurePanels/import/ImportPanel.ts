
import type { IPanel } from '../../../core';
import type { ImportPanelServices, FrameControlCallbacks } from './ImportPanelServices';
import { injectStyles } from '../../../styles/mainWindow.css';
import { importPanelStyles } from '../../../styles/panels/importPanel.css';
import { ModelSection } from './ModelSection';
import { AnimationSection } from './AnimationSection';
import { MusicSection } from './MusicSection';
import { CameraSection } from './CameraSection';
import { FrameController } from './FrameController';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

export class ImportPanel implements IPanel {
    readonly id = 'import';
    readonly tabLabel = '导入';
    readonly tabIcon = TAB_ICON;
    readonly element: HTMLElement;

    private services: ImportPanelServices;
    private callbacks: FrameControlCallbacks | null = null;
    private modelSection: ModelSection | null = null;
    private animationSection: AnimationSection | null = null;
    private musicSection: MusicSection | null = null;
    private cameraSection: CameraSection | null = null;
    private frameController: FrameController | null = null;

    constructor(services: ImportPanelServices, callbacks?: FrameControlCallbacks) {
        this.services = services;
        this.callbacks = callbacks || null;
        injectStyles(importPanelStyles, 'panel-import');
        this.element = this.create();
    }

    private create(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'import-panel';

        const contentContainer = document.createElement('div');
        contentContainer.className = 'import-panel-content';

        this.modelSection = new ModelSection(
            this.services.modelManager,
            this.services.stateManager,
            this.services.animationManager,
            () => this.onModelChange()
        );

        this.animationSection = new AnimationSection(
            this.services.modelManager,
            this.services.stateManager,
            this.services.animationManager
        );

        this.musicSection = new MusicSection(
            this.services.musicManager
        );

        this.cameraSection = new CameraSection(
            this.services.cameraManager,
            this.services.modelManager
        );

        this.frameController = new FrameController(
            this.services.animationManager,
            this.services.cameraManager,
            this.callbacks?.onFrameChange
        );

        contentContainer.appendChild(this.modelSection.element);
        contentContainer.appendChild(this.animationSection.element);
        contentContainer.appendChild(this.musicSection.element);
        contentContainer.appendChild(this.cameraSection.element);

        panel.appendChild(contentContainer);
        panel.appendChild(this.frameController.element);

        return panel;
    }

    private onModelChange(): void {
        this.animationSection?.updateMotionCardState();
    }

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        this.element.remove();
    }

    getFrameController(): FrameController | null {
        return this.frameController;
    }

    getModelSection(): ModelSection | null {
        return this.modelSection;
    }

    getAnimationSection(): AnimationSection | null {
        return this.animationSection;
    }

    getMusicSection(): MusicSection | null {
        return this.musicSection;
    }

    getCameraSection(): CameraSection | null {
        return this.cameraSection;
    }

    dispose(): void {
        this.modelSection?.dispose();
        this.animationSection?.dispose();
        this.musicSection?.dispose();
        this.cameraSection?.dispose();
        this.frameController?.dispose();

        this.modelSection = null;
        this.animationSection = null;
        this.musicSection = null;
        this.cameraSection = null;
        this.frameController = null;

        this.element.remove();
    }
}
