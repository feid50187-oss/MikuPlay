
import type { SceneManager } from '../../../features/scene';
import { Dropdown } from '../../shared/Dropdown';
import { Slider } from '../../shared/Slider';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { Events, eventBus, pluginRegistry } from '../../../core';
import type { FunctionalPluginExports } from '../../../core/IPlugin';
import { GroundStateManager } from '../../../features/state';
import type { Scene } from '@babylonjs/core';

interface IGroundInstance {
    create(scene: Scene, scale: number, height: number): void;
    dispose(): void;
    setScale(scale: number): void;
    setHeight(height: number): void;
    createPrivateParams(): HTMLElement;
}

export class GroundSection {
    readonly element: HTMLElement;
    private sceneManager: SceneManager | null;
    private groundManager: GroundStateManager;
    private collapsible: CollapsibleSection | null = null;
    private dropdown: Dropdown | null = null;
    private sliders: Slider[] = [];
    private paramsContainer: HTMLElement;
    private currentGround: IGroundInstance | null = null;

    constructor(sceneManager: SceneManager | null) {
        this.sceneManager = sceneManager;
        this.groundManager = GroundStateManager.getInstance();
        this.paramsContainer = document.createElement('div');
        this.paramsContainer.className = 'world-ground-params';
        this.element = this.create();
    }

    private createGroundInstance(type: string): IGroundInstance | null {
        const entry = pluginRegistry.get(type);
        if (!entry || entry.manifest.type !== 'functional') return null;

        const funcData = entry.data as FunctionalPluginExports;
        if (funcData.createInstance) {
            return funcData.createInstance() as IGroundInstance;
        }
        return null;
    }

    private getGroundTypeOptions(): Array<{ value: string; label: string }> {
        const groundPlugins = pluginRegistry.getByTarget('ground');
        return [
            { value: 'none', label: '无' },
            ...groundPlugins.map(p => ({
                value: p.manifest.id,
                label: p.manifest.name,
            })),
        ];
    }

    private migrateLegacyGroundType(type: string): string {
        const legacyMap: Record<string, string> = {
            'basic': 'builtin.ground.basic',
            'water': 'builtin.ground.water',
            'reflective': 'builtin.ground.reflective',
        };
        return legacyMap[type] || type;
    }

    private create(): HTMLElement {
        this.collapsible = new CollapsibleSection({ title: '地面', initiallyExpanded: false });
        this.collapsible.element.classList.add('world-item');
        const inner = this.collapsible.getContentContainer();
        inner.style.padding = '0 20px 16px 20px';
        inner.style.display = 'flex';
        inner.style.flexDirection = 'column';
        inner.style.gap = '12px';
        this.collapsible.element.querySelector('.mp-collapsible-header')!.classList.add('world-item-header');

        // 展开时允许内容溢出（下拉框等）
        this.collapsible.onChange((expanded) => {
            this.collapsible!.element.classList.toggle('overflow-visible', expanded);
        });

        const groundTypes = this.getGroundTypeOptions();

        const groundState = this.groundManager.getState();
        const migratedType = this.migrateLegacyGroundType(groundState.type);

        this.dropdown = new Dropdown({
            options: groundTypes,
            selectedValue: migratedType
        });
        this.dropdown.onChange((selectedType) => {
            this.groundManager.setGroundType(selectedType);
            this.renderParamsArea();
        });

        this.collapsible.getContentContainer().appendChild(this.dropdown.element);
        this.collapsible.getContentContainer().appendChild(this.paramsContainer);

        this.renderParamsArea();

        return this.collapsible.element;
    }

    private renderParamsArea(): void {
        this.sliders.forEach(s => s.dispose());
        this.sliders = [];
        this.paramsContainer.innerHTML = '';

        const state = this.groundManager.getState();
        const migratedType = this.migrateLegacyGroundType(state.type);

        if (migratedType === 'none') {
            this.disposeCurrentGround();
            return;
        }

        this.disposeCurrentGround();

        const heightSlider = new Slider({
            label: '高度',
            min: -10,
            max: 10,
            step: 0.1,
            value: state.height
        });
        heightSlider.onChange((value) => {
            this.groundManager.setHeight(value);
            this.currentGround?.setHeight(value);
            eventBus.emit(Events.GROUND_HEIGHT_CHANGED, { height: value });
        });
        this.sliders.push(heightSlider);

        this.paramsContainer.appendChild(heightSlider.element);

        const scene = this.sceneManager?.getScene();

        this.currentGround = this.createGroundInstance(migratedType);
        if (this.currentGround && scene) {
            this.currentGround.create(scene, state.scale, state.height);
            const privateParams = this.currentGround.createPrivateParams();
            this.paramsContainer.appendChild(privateParams);
        }
    }

    private disposeCurrentGround(): void {
        this.currentGround?.dispose();
        this.currentGround = null;
    }

    dispose(): void {
        this.disposeCurrentGround();
        this.sliders.forEach(s => s.dispose());
        this.dropdown?.dispose();
        this.sliders = [];
        this.collapsible?.dispose();
        this.collapsible = null;
    }
}
