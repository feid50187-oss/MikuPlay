
import type { SceneManager } from '../../../features/scene';
import { Dropdown } from '../../shared/Dropdown';
import { Slider } from '../../shared/Slider';
import { ToggleSwitch } from '../../shared/ToggleSwitch';
import { RGBColorPicker } from '../../shared/RGBColorPicker';
import { VectorInput } from '../../shared/VectorInput';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { Events, eventBus, pluginRegistry } from '../../../core';
import type { FunctionalPluginExports, ControlDeclaration, PluginPreset } from '../../../core/IPlugin';
import { ParticleStateManager } from '../../../features/state';
import { particlePresetRegistry } from '../../../features/particle/particlePresets';

import { Vector3, Color4 } from '@babylonjs/core';

type ParamConfig =
    | { type: 'slider'; label: string; initialValue: number; min: number; max: number; step: number }
    | { type: 'color'; label: string; initialValue: { r: number; g: number; b: number; a: number } }
    | { type: 'vector'; label: string; initialValue: { x: number; y: number; z: number } };

export class ParticleSection {
    readonly element: HTMLElement;
    private sceneManager: SceneManager | null;
    private particleManager: ParticleStateManager;
    private collapsible: CollapsibleSection | null = null;
    private dropdown: Dropdown | null = null;
    private sliders: Slider[] = [];
    private colorPickers: RGBColorPicker[] = [];
    private vectorInputs: VectorInput[] = [];
    private paramsContainer: HTMLElement;
    private particleToggle: ToggleSwitch | null = null;
    private currentType: string = 'rain';

    constructor(sceneManager: SceneManager | null) {
        this.sceneManager = sceneManager;
        this.particleManager = ParticleStateManager.getInstance();
        this.paramsContainer = document.createElement('div');
        this.paramsContainer.className = 'world-particle-params';
        this.element = this.create();
    }

    private getParticleTypeOptions(): Array<{ value: string; label: string }> {
        const particlePlugins = pluginRegistry.getByTarget('particle');
        return particlePlugins.map(p => ({
            value: p.manifest.id,
            label: p.manifest.name,
        }));
    }

    private migrateLegacyParticleType(type: string): string {
        const legacyMap: Record<string, string> = {
            'rain': 'builtin.particle.rain',
            'sakura': 'builtin.particle.sakura',
            'snow': 'builtin.particle.snow',
            'basic': 'builtin.particle.basic',
        };
        return legacyMap[type] || type;
    }

    private getBuiltinTypeFromId(id: string): string {
        const prefix = 'builtin.particle.';
        if (id.startsWith(prefix)) {
            return id.slice(prefix.length);
        }
        return id;
    }

    private create(): HTMLElement {
        this.collapsible = new CollapsibleSection({ title: '粒子效果', initiallyExpanded: false });
        this.collapsible.element.classList.add('world-item');
        const inner = this.collapsible.getContentContainer();
        inner.style.padding = '0 20px 16px 20px';
        inner.style.display = 'flex';
        inner.style.flexDirection = 'column';
        inner.style.gap = '12px';
        this.collapsible.element.querySelector('.mp-collapsible-header')!.classList.add('world-item-header');

        const particleTypes = this.getParticleTypeOptions();

        this.currentType = this.migrateLegacyParticleType(this.particleManager.getState().currentType);

        this.dropdown = new Dropdown({
            options: particleTypes,
            selectedValue: this.currentType
        });
        this.dropdown.onChange((selectedType) => {
            this.currentType = selectedType;
            this.particleManager.setSystem(selectedType);
            this.renderParamsArea();
        });

        this.particleToggle = new ToggleSwitch({
            label: '启用粒子',
            initialState: false
        });
        this.particleToggle.onChange((isActive) => {
            this.handleToggle(isActive);
        });

        this.renderParamsArea();

        this.collapsible.getContentContainer().appendChild(this.dropdown.element);
        this.collapsible.getContentContainer().appendChild(this.particleToggle.element);
        this.collapsible.getContentContainer().appendChild(this.paramsContainer);

        return this.collapsible.element;
    }

    private handleToggle(isActive: boolean): void {
        const particleManager = this.sceneManager?.getParticleManager();
        if (!particleManager) return;

        this.particleManager.setEnabled(this.currentType, isActive);

        if (isActive) {
            const savedParams = this.particleManager.getParams(this.currentType);
            const initialParams: any = {};

            Object.entries(savedParams).forEach(([key, value]) => {
                if (typeof value === 'number') {
                    initialParams[key] = value;
                } else if ('x' in value && 'y' in value && 'z' in value) {
                    initialParams[key] = new Vector3(value.x, value.y, value.z);
                } else if ('r' in value && 'g' in value && 'b' in value) {
                    initialParams[key] = new Color4(value.r, value.g, value.b, (value as any).a ?? 1);
                }
            });

            const entry = pluginRegistry.get(this.currentType);
            if (entry && entry.builtIn) {
                const builtinType = this.getBuiltinTypeFromId(this.currentType);
                particleManager.createPreset(builtinType, `particle_${this.currentType}`, initialParams);
            } else if (entry && !entry.builtIn) {
                const funcData = entry.data as FunctionalPluginExports;
                if (funcData.preset.renderConfig) {
                    particleManager.createPluginPreset(
                        this.currentType,
                        `particle_${this.currentType}`,
                        initialParams,
                        funcData.preset.renderConfig
                    );
                }
            }
            eventBus.emit(Events.PARTICLE_SYSTEM_CHANGED, { type: this.currentType, enabled: true });
        } else {
            particleManager.removeSystem(`particle_${this.currentType}`);
            eventBus.emit(Events.PARTICLE_SYSTEM_CHANGED, { type: this.currentType, enabled: false });
        }
    }

    private renderParamsArea(): void {
        this.sliders.forEach(s => s.dispose());
        this.colorPickers.forEach(c => c.dispose());
        this.vectorInputs.forEach(v => v.dispose());
        this.sliders = [];
        this.colorPickers = [];
        this.vectorInputs = [];
        this.paramsContainer.innerHTML = '';

        const entry = pluginRegistry.get(this.currentType);
        if (!entry) return;

        const funcData = entry.data as FunctionalPluginExports;
        const preset = funcData.preset;

        const isActive = this.particleManager.isEnabled(this.currentType);
        if (this.particleToggle) {
            this.particleToggle.setValue(isActive);
        }

        const savedParams = this.particleManager.getParams(this.currentType);

        if (entry.builtIn) {
            const builtinType = this.getBuiltinTypeFromId(this.currentType);
            const builtinPreset = particlePresetRegistry.get(builtinType);
            if (!builtinPreset) return;

            builtinPreset.adjustableParams.forEach(paramName => {
                const paramConfig = this.getParamConfig(paramName, builtinPreset.defaultParams);
                if (!paramConfig) return;

                let initialValue: any = paramConfig.initialValue;
                const savedValue = savedParams[paramName];
                if (savedValue !== undefined) {
                    initialValue = savedValue;
                }

                this.createParamControl(paramConfig, initialValue, paramName);
            });
        } else {
            this.renderPluginParams(preset, savedParams);
        }
    }

    private renderPluginParams(preset: PluginPreset, savedParams: Record<string, any>): void {
        for (const control of preset.controls) {
            let initialValue = preset.defaultParams[control.param];
            const savedValue = savedParams[control.param];
            if (savedValue !== undefined) {
                initialValue = savedValue;
            }
            this.createControlFromDeclaration(control, initialValue);
        }
    }

    private createControlFromDeclaration(control: ControlDeclaration, initialValue: any): void {
        switch (control.type) {
            case 'slider': {
                const slider = new Slider({
                    label: control.label,
                    min: control.min,
                    max: control.max,
                    step: control.step,
                    value: initialValue as number
                });
                slider.onChange((value) => {
                    this.handleParamChange(control.param, value);
                });
                this.sliders.push(slider);
                this.paramsContainer.appendChild(slider.element);
                break;
            }
            case 'color': {
                const colorPicker = new RGBColorPicker({
                    label: control.label,
                    color: initialValue as { r: number; g: number; b: number; a: number },
                    mode: 'popup',
                    showAlpha: true
                });
                colorPicker.onChange(({ r, g, b, a }) => {
                    this.handleParamChange(control.param, { r, g, b, a });
                });
                this.colorPickers.push(colorPicker);
                this.paramsContainer.appendChild(colorPicker.element);
                break;
            }
            case 'vector': {
                const vec = initialValue as { x: number; y: number; z: number };
                const vectorInput = new VectorInput({
                    label: control.label,
                    components: [
                        { name: 'X', value: vec.x, min: -100, max: 100, step: 0.1 },
                        { name: 'Y', value: vec.y, min: -100, max: 100, step: 0.1 },
                        { name: 'Z', value: vec.z, min: -100, max: 100, step: 0.1 }
                    ]
                });
                vectorInput.onChange((values) => {
                    this.handleParamChange(control.param, { x: values[0], y: values[1], z: values[2] });
                });
                this.vectorInputs.push(vectorInput);
                this.paramsContainer.appendChild(vectorInput.element);
                break;
            }
        }
    }

    private createParamControl(paramConfig: ParamConfig, initialValue: any, paramName: string): void {
        if (paramConfig.type === 'slider') {
            const slider = new Slider({
                label: paramConfig.label,
                min: paramConfig.min,
                max: paramConfig.max,
                step: paramConfig.step,
                value: initialValue as number
            });
            slider.onChange((value) => {
                this.handleParamChange(paramName, value);
            });
            this.sliders.push(slider);
            this.paramsContainer.appendChild(slider.element);
        } else if (paramConfig.type === 'color') {
            const colorPicker = new RGBColorPicker({
                label: paramConfig.label,
                color: initialValue as { r: number; g: number; b: number; a: number },
                mode: 'popup',
                showAlpha: true
            });
            colorPicker.onChange(({ r, g, b, a }) => {
                this.handleParamChange(paramName, { r, g, b, a });
            });
            this.colorPickers.push(colorPicker);
            this.paramsContainer.appendChild(colorPicker.element);
        } else if (paramConfig.type === 'vector') {
            const vec = initialValue as { x: number; y: number; z: number };
            const vectorInput = new VectorInput({
                label: paramConfig.label,
                components: [
                    { name: 'X', value: vec.x, min: -100, max: 100, step: 0.1 },
                    { name: 'Y', value: vec.y, min: -100, max: 100, step: 0.1 },
                    { name: 'Z', value: vec.z, min: -100, max: 100, step: 0.1 }
                ]
            });
            vectorInput.onChange((values) => {
                this.handleParamChange(paramName, { x: values[0], y: values[1], z: values[2] });
            });
            this.vectorInputs.push(vectorInput);
            this.paramsContainer.appendChild(vectorInput.element);
        }
    }

    private handleParamChange(paramName: string, value: any): void {
        const particleManager = this.sceneManager?.getParticleManager();
        if (!particleManager) return;

        this.particleManager.setParam(this.currentType, paramName, value);

        const systemName = `particle_${this.currentType}`;
        if (this.particleManager.isEnabled(this.currentType)) {
            const params: any = {};
            if (typeof value === 'number') {
                params[paramName] = value;
            } else if ('x' in value && 'y' in value && 'z' in value) {
                params[paramName] = new Vector3(value.x, value.y, value.z);
            } else if ('r' in value && 'g' in value && 'b' in value) {
                params[paramName] = new Color4(value.r, value.g, value.b, value.a ?? 1);
            }
            particleManager.updateParams(systemName, params);
            eventBus.emit(Events.PARTICLE_PARAMS_CHANGED, { type: this.currentType, paramName, value });
        }
    }

    private getParamConfig(paramName: string, defaultParams: any): ParamConfig | null {
        const builtinType = this.getBuiltinTypeFromId(this.currentType);
        const emitRateMax = builtinType === 'basic' ? 1000 : 3000;
        const configs: Record<string, ParamConfig> = {
            emitRate: { type: 'slider', label: '发射率', initialValue: defaultParams.emitRate ?? 100, min: 0, max: emitRateMax, step: 10 },
            minSize: { type: 'slider', label: '最小尺寸', initialValue: defaultParams.minSize ?? 0.1, min: 0.01, max: 2, step: 0.01 },
            maxSize: { type: 'slider', label: '最大尺寸', initialValue: defaultParams.maxSize ?? 0.5, min: 0.01, max: 2, step: 0.01 },
            speed: { type: 'slider', label: '速度', initialValue: defaultParams.speed ?? 1, min: 0.1, max: 20, step: 0.1 },
            turbulence: { type: 'slider', label: '扰动强度', initialValue: defaultParams.turbulence ?? 0, min: 0, max: 2, step: 0.01 },
            rotationSpeed: { type: 'slider', label: '旋转速度', initialValue: defaultParams.rotationSpeed ?? 0, min: 0, max: 5, step: 0.1 },
            lifeTime: { type: 'slider', label: '生命周期', initialValue: defaultParams.lifeTime ?? 2, min: 0.1, max: 10, step: 0.1 },
            minEmitPower: { type: 'slider', label: '最小发射力度', initialValue: defaultParams.minEmitPower ?? 1, min: 0, max: 20, step: 0.1 },
            maxEmitPower: { type: 'slider', label: '最大发射力度', initialValue: defaultParams.maxEmitPower ?? 3, min: 0, max: 20, step: 0.1 },
            colorStart: { type: 'color', label: '起始颜色', initialValue: defaultParams.colorStart ?? { r: 1, g: 1, b: 1, a: 1 } },
            colorEnd: { type: 'color', label: '结束颜色', initialValue: defaultParams.colorEnd ?? { r: 1, g: 1, b: 1, a: 0 } },
            emitNormal: { type: 'vector', label: '发射方向', initialValue: defaultParams.emitNormal ? { x: defaultParams.emitNormal.x, y: defaultParams.emitNormal.y, z: defaultParams.emitNormal.z } : { x: 0, y: 1, z: 0 } },
            gravity: { type: 'vector', label: '重力', initialValue: defaultParams.gravity ? { x: defaultParams.gravity.x, y: defaultParams.gravity.y, z: defaultParams.gravity.z } : { x: 0, y: 0, z: 0 } },
            emitterPosition: { type: 'vector', label: '发射器位置', initialValue: defaultParams.emitterPosition ? { x: defaultParams.emitterPosition.x, y: defaultParams.emitterPosition.y, z: defaultParams.emitterPosition.z } : { x: 0, y: 0, z: 0 } },
            emitterSize: { type: 'vector', label: '发射器大小', initialValue: defaultParams.emitterSize ? { x: defaultParams.emitterSize.x, y: defaultParams.emitterSize.y, z: defaultParams.emitterSize.z } : { x: 1, y: 1, z: 1 } }
        };

        return configs[paramName] ?? null;
    }

    dispose(): void {
        this.sliders.forEach(s => s.dispose());
        this.colorPickers.forEach(c => c.dispose());
        this.vectorInputs.forEach(v => v.dispose());
        this.dropdown?.dispose();
        this.particleToggle?.dispose();
        this.sliders = [];
        this.colorPickers = [];
        this.vectorInputs = [];
        this.particleToggle = null;
        this.collapsible?.dispose();
        this.collapsible = null;
    }
}
