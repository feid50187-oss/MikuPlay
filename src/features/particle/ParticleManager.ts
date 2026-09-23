
import {
    Scene,
    ParticleSystem,
    MeshBuilder,
    Mesh,
    Vector3,
    Color4,
    Texture
} from '@babylonjs/core';
import type {
    ParticleParams,
    ParticleSystemState,
    IParticleManager,
    ParticleEventType,
    ParticleEventCallback
} from './types';
import { getParticlePreset } from './particlePresets';
import type { ParticlePresetConfig } from './types';
import { ProceduralTextureManager } from './ProceduralTextureManager';
import type { ParticleRenderConfig } from '../../core/IPlugin';

class TextureRegistry {
    private textures = new Map<string, string>();

    register(name: string, path: string): void {
        this.textures.set(name, path);
    }

    get(name: string): string | undefined {
        return this.textures.get(name);
    }
}

export const textureRegistry = new TextureRegistry();
textureRegistry.register('flare', 'textures/flare.png');
textureRegistry.register('fire', 'textures/fire.png');
textureRegistry.register('smoke', 'textures/smoke.png');
textureRegistry.register('spark', 'textures/spark.png');

export class ParticleManager implements IParticleManager {
    private scene: Scene;
    private activeSystems: Map<string, ParticleSystem> = new Map();
    private emitterMeshes: Map<string, Mesh> = new Map();
    private proceduralTextureManager: ProceduralTextureManager;
    private eventListeners: Map<ParticleEventType, Set<ParticleEventCallback>> = new Map();
    private systemTypes: Map<string, string> = new Map();
    private _textureCache: Map<string, Texture> = new Map();

    constructor(scene: Scene) {
        this.scene = scene;
        this.proceduralTextureManager = ProceduralTextureManager.getInstance(scene);
    }

    public createPreset(
        type: string,
        name: string,
        initialParams?: Partial<ParticleParams>
    ): void {
        if (this.activeSystems.has(name)) {
            console.warn(`粒子系统 "${name}" 已存在，移除旧的`);
            this.removeSystem(name);
        }

        const preset = getParticlePreset(type);
        if (!preset) {
            console.error(`未知的粒子预设类型: ${type}`);
            return;
        }

        const params = { ...preset.defaultParams, ...initialParams };

        this.systemTypes.set(name, type);

        const emitter = MeshBuilder.CreateBox(
            `emitter_${name}`,
            { size: 1 },
            this.scene
        );
        emitter.isVisible = false;

        if (params.emitterPosition) {
            emitter.position = params.emitterPosition.clone();
        }
        if (params.emitterSize) {
            emitter.scaling = params.emitterSize.clone();
        }

        this.emitterMeshes.set(name, emitter);

        const maxParticles = params.maxParticles ?? preset.defaultMaxParticles;

        const particleSystem = new ParticleSystem(
            `particles_${name}`,
            maxParticles,
            this.scene
        );

        particleSystem.emitter = emitter;

        this.configureTexture(particleSystem, preset);

        this.applyParams(particleSystem, params, preset.enableRotation);

        this.configureBlendMode(particleSystem, preset.blendMode);
        particleSystem.renderingGroupId = 1;

        this.activeSystems.set(name, particleSystem);
        particleSystem.start();

        this.emit('systemCreated', { name, type, params });
    }

    public createPluginPreset(
        pluginId: string,
        name: string,
        initialParams: Partial<ParticleParams>,
        renderConfig: ParticleRenderConfig
    ): void {
        if (this.activeSystems.has(name)) {
            console.warn(`粒子系统 "${name}" 已存在，移除旧的`);
            this.removeSystem(name);
        }

        const params = { ...initialParams } as ParticleParams;

        this.systemTypes.set(name, pluginId);

        const emitter = MeshBuilder.CreateBox(
            `emitter_${name}`,
            { size: 1 },
            this.scene
        );
        emitter.isVisible = false;

        if (params.emitterPosition) {
            emitter.position = params.emitterPosition.clone();
        }
        if (params.emitterSize) {
            emitter.scaling = params.emitterSize.clone();
        }

        this.emitterMeshes.set(name, emitter);

        const maxParticles = params.maxParticles ?? renderConfig.defaultMaxParticles;

        const particleSystem = new ParticleSystem(
            `particles_${name}`,
            maxParticles,
            this.scene
        );

        particleSystem.emitter = emitter;

        this.configureTextureFromConfig(particleSystem, renderConfig);

        this.applyParams(particleSystem, params, renderConfig.enableRotation);

        this.configureBlendMode(particleSystem, renderConfig.blendMode as 'oneOne' | 'standard' | 'multiply');
        particleSystem.renderingGroupId = 1;

        this.activeSystems.set(name, particleSystem);
        particleSystem.start();

        this.emit('systemCreated', { name, type: pluginId, params });
    }

    private configureTextureFromConfig(
        particleSystem: ParticleSystem,
        config: ParticleRenderConfig
    ): void {
        switch (config.textureSource) {
            case 'procedural':
                const procTexture = this.proceduralTextureManager.getTexture(
                    config.texture as 'rain' | 'sakura' | 'snow'
                );
                particleSystem.particleTexture = procTexture;
                break;

            case 'builtin':
                const texturePath = textureRegistry.get(config.texture) ?? 'textures/flare.png';
                let cachedTexture = this._textureCache.get(texturePath);
                if (!cachedTexture) {
                    cachedTexture = new Texture(texturePath, this.scene);
                    this._textureCache.set(texturePath, cachedTexture);
                }
                particleSystem.particleTexture = cachedTexture;
                break;

            case 'external':
                particleSystem.particleTexture = new Texture(config.texture, this.scene);
                break;
        }
    }

    private configureTexture(
        particleSystem: ParticleSystem,
        preset: ParticlePresetConfig
    ): void {
        switch (preset.textureSource) {
            case 'procedural':
                const procTexture = this.proceduralTextureManager.getTexture(
                    preset.texture as 'rain' | 'sakura' | 'snow'
                );
                particleSystem.particleTexture = procTexture;
                break;

            case 'builtin':
                const texturePath = textureRegistry.get(preset.texture) ?? 'textures/flare.png';
                let cachedTexture = this._textureCache.get(texturePath);
                if (!cachedTexture) {
                    cachedTexture = new Texture(texturePath, this.scene);
                    this._textureCache.set(texturePath, cachedTexture);
                }
                particleSystem.particleTexture = cachedTexture;
                break;

            case 'external':
                particleSystem.particleTexture = new Texture(preset.texture, this.scene);
                break;
        }
    }

    private configureBlendMode(
        particleSystem: ParticleSystem,
        mode: 'oneOne' | 'standard' | 'multiply'
    ): void {
        switch (mode) {
            case 'oneOne':
                particleSystem.blendMode = ParticleSystem.BLENDMODE_ONEONE;
                break;
            case 'multiply':
                particleSystem.blendMode = ParticleSystem.BLENDMODE_MULTIPLY;
                break;
            case 'standard':
            default:
                particleSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
                break;
        }
    }

    private applyParams(
        particleSystem: ParticleSystem,
        params: ParticleParams,
        enableRotation: boolean
    ): void {
        if (params.emitNormal) {
            const spread = params.turbulence ?? 0;
            // 扰动只影响水平方向（X、Z轴），不影响垂直方向（Y轴）
            particleSystem.direction1 = new Vector3(
                params.emitNormal.x - spread,
                params.emitNormal.y,
                params.emitNormal.z - spread
            );
            particleSystem.direction2 = new Vector3(
                params.emitNormal.x + spread,
                params.emitNormal.y,
                params.emitNormal.z + spread
            );
        }

        if (params.lifeTime !== undefined) {
            particleSystem.minLifeTime = params.lifeTime * 0.8;
            particleSystem.maxLifeTime = params.lifeTime * 1.2;
        }

        if (params.minSize !== undefined) {
            particleSystem.minSize = params.minSize;
        }
        if (params.maxSize !== undefined) {
            particleSystem.maxSize = params.maxSize;
        }

        if (params.emitRate !== undefined) {
            particleSystem.emitRate = params.emitRate;
        }

        if (params.speed !== undefined) {
            particleSystem.minEmitPower = params.speed * 0.8;
            particleSystem.maxEmitPower = params.speed * 1.2;
        } else {
            if (params.minEmitPower !== undefined) {
                particleSystem.minEmitPower = params.minEmitPower;
            }
            if (params.maxEmitPower !== undefined) {
                particleSystem.maxEmitPower = params.maxEmitPower;
            }
        }

        if (params.gravity) {
            particleSystem.gravity = params.gravity;
        }

        if (enableRotation && params.rotationSpeed !== undefined) {
            particleSystem.minAngularSpeed = -params.rotationSpeed;
            particleSystem.maxAngularSpeed = params.rotationSpeed;
        }

        if (params.colorStart) {
            particleSystem.color1 = params.colorStart;
        }
        if (params.colorEnd) {
            const colorEndCloned = params.colorEnd.clone();
            particleSystem.color2 = colorEndCloned;
            particleSystem.colorDead = colorEndCloned.clone();
        }
    }

    public updateParams(name: string, params: Partial<ParticleParams>): void {
        const particleSystem = this.activeSystems.get(name);
        const emitter = this.emitterMeshes.get(name);
        const type = this.systemTypes.get(name);

        if (!particleSystem || !type) {
            console.warn(`未找到粒子系统 "${name}"`);
            return;
        }

        const preset = getParticlePreset(type);
        if (!preset) {
            console.warn(`未知的粒子预设类型: ${type}`);
            return;
        }

        if (emitter) {
            if (params.emitterPosition) {
                emitter.position = params.emitterPosition.clone();
            }
            if (params.emitterSize) {
                emitter.scaling = params.emitterSize.clone();
            }
        }

        this.applyParams(particleSystem, params, preset.enableRotation);

        this.emit('paramsUpdated', { name, type, params });
    }

    public removeSystem(name: string): void {
        const particleSystem = this.activeSystems.get(name);
        const emitter = this.emitterMeshes.get(name);
        const type = this.systemTypes.get(name);

        if (!particleSystem) {
            console.warn(`未找到粒子系统 "${name}"`);
            return;
        }

        particleSystem.stop();
        particleSystem.dispose();
        this.activeSystems.delete(name);
        this.systemTypes.delete(name);

        if (emitter) {
            emitter.dispose();
            this.emitterMeshes.delete(name);
        }

        if (type) {
            this.emit('systemRemoved', { name, type });
        }
    }

    public setEnabled(name: string, enabled: boolean): void {
        const particleSystem = this.activeSystems.get(name);
        const type = this.systemTypes.get(name);

        if (!particleSystem || !type) {
            console.warn(`未找到粒子系统 "${name}"`);
            return;
        }

        if (enabled) {
            particleSystem.start();
        } else {
            particleSystem.stop();
        }

        this.emit(enabled ? 'systemEnabled' : 'systemDisabled', { name, type });
    }

    public getSystemState(name: string): ParticleSystemState | null {
        const particleSystem = this.activeSystems.get(name);
        const type = this.systemTypes.get(name);

        if (!particleSystem || !type) return null;

        return {
            name,
            presetType: type,
            currentParams: this.extractParams(particleSystem),
            enabled: particleSystem.isStarted()
        };
    }

    private extractParams(particleSystem: ParticleSystem): ParticleParams {
        return {
            emitNormal: particleSystem.direction1,
            lifeTime: (particleSystem.minLifeTime + particleSystem.maxLifeTime) / 2,
            minSize: particleSystem.minSize,
            maxSize: particleSystem.maxSize,
            emitRate: particleSystem.emitRate,
            minEmitPower: particleSystem.minEmitPower,
            maxEmitPower: particleSystem.maxEmitPower,
            gravity: particleSystem.gravity,
            rotationSpeed: Math.abs(particleSystem.minAngularSpeed),
            colorStart: particleSystem.color1,
            colorEnd: particleSystem.color2
        };
    }

    public getAllSystems(): ParticleSystemState[] {
        const systems: ParticleSystemState[] = [];
        for (const name of this.activeSystems.keys()) {
            const state = this.getSystemState(name);
            if (state) systems.push(state);
        }
        return systems;
    }

    public on(event: ParticleEventType, callback: ParticleEventCallback): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(callback);
    }

    public off(event: ParticleEventType, callback: ParticleEventCallback): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.delete(callback);
        }
    }

    private emit(event: ParticleEventType, data: any): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`粒子事件监听器错误 ${event}:`, error);
                }
            });
        }
    }

    public dispose(): void {
        for (const [name] of this.activeSystems) {
            this.removeSystem(name);
        }

        this.activeSystems.clear();
        this.emitterMeshes.clear();
        this.systemTypes.clear();
        this.eventListeners.clear();

        // 清理纹理缓存
        for (const texture of this._textureCache.values()) {
            texture.dispose();
        }
        this._textureCache.clear();

        this.proceduralTextureManager.dispose();
    }
}
