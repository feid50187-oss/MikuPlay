
import { Vector3, Color4 } from '@babylonjs/core';
import type { ParticlePresetConfig } from './types';

class ParticlePresetRegistry {
    private presets = new Map<string, ParticlePresetConfig>();

    register(preset: ParticlePresetConfig): void {
        this.presets.set(preset.type, preset);
    }

    unregister(type: string): void {
        this.presets.delete(type);
    }

    get(type: string): ParticlePresetConfig | undefined {
        return this.presets.get(type);
    }

    getAll(): ParticlePresetConfig[] {
        return [...this.presets.values()];
    }

    getTypes(): { value: string; label: string }[] {
        return [...this.presets.values()].map(p => ({ value: p.type, label: p.name }));
    }
}

export const particlePresetRegistry = new ParticlePresetRegistry();

// 注册内置的粒子预设
particlePresetRegistry.register({
    name: '雨滴',
    type: 'rain',
    defaultParams: {
        emitNormal: new Vector3(0, -1, 0),
        lifeTime: 7,
        minSize: 0.5,
        maxSize: 0.7,
        emitRate: 2000,
        minEmitPower: 3,
        maxEmitPower: 5,
        gravity: new Vector3(0, -13, 0),
        turbulence: 0.01,
        colorStart: new Color4(0.7, 0.8, 0.9, 0.8),
        colorEnd: new Color4(0.5, 0.6, 0.7, 0.4),
        emitterPosition: new Vector3(0, 30, 0),
        emitterSize: new Vector3(80, 1, 80),
        rotationSpeed: 0
    },
    adjustableParams: [
        'emitRate',
        'minSize',
        'maxSize',
        'emitterPosition',
        'emitterSize'
    ],
    textureSource: 'procedural',
    texture: 'rain',
    blendMode: 'standard',
    depthWrite: false,
    enableRotation: false,
    defaultMaxParticles: 25000
});

particlePresetRegistry.register({
    name: '樱花',
    type: 'sakura',
    defaultParams: {
        emitNormal: new Vector3(0, -1, 0),
        lifeTime: 8,
        minSize: 0.1,
        maxSize: 0.25,
        emitRate: 250,
        minEmitPower: 0.2,
        maxEmitPower: 0.5,
        gravity: new Vector3(0, -0.5, 0),
        turbulence: 0.2,
        colorStart: new Color4(1, 0.8, 0.9, 1),
        colorEnd: new Color4(1, 0.9, 0.95, 0.6),
        emitterPosition: new Vector3(0, 30, 0),
        emitterSize: new Vector3(60, 1, 60),
        rotationSpeed: 0.2
    },
    adjustableParams: [
        'emitRate',
        'minSize',
        'maxSize',
        //'turbulence',
        //'speed',
        //'rotationSpeed',
        'emitterPosition',
        'emitterSize'
    ],
    textureSource: 'procedural',
    texture: 'sakura',
    blendMode: 'standard',
    depthWrite: false,
    enableRotation: true,
    defaultMaxParticles: 25000
});

particlePresetRegistry.register({
    name: '雪花',
    type: 'snow',
    defaultParams: {
        emitNormal: new Vector3(0, -1, 0),
        lifeTime: 7,
        minSize: 0.4,
        maxSize: 0.6,
        emitRate: 500,
        minEmitPower: 1,
        maxEmitPower: 3,
        speed: 0.2,
        gravity: new Vector3(0, -1.5, 0),
        turbulence: 1,
        colorStart: new Color4(1, 1, 1, 0.9),
        colorEnd: new Color4(0.9, 0.95, 1, 0.5),
        emitterPosition: new Vector3(0, 40, 0),
        emitterSize: new Vector3(60, 1, 60),
        rotationSpeed: 1.0
    },
    adjustableParams: [
        'emitRate',
        'minSize',
        'maxSize',

        'emitterPosition',
        'emitterSize'
    ],
    textureSource: 'procedural',
    texture: 'snow',
    blendMode: 'standard',
    depthWrite: false,
    enableRotation: true,
    defaultMaxParticles: 35000
});

particlePresetRegistry.register({
    name: '基础',
    type: 'basic',
    defaultParams: {
        emitNormal: new Vector3(0, 1, 0),
        lifeTime: 2,
        minSize: 0.5,
        maxSize: 1.0,
        emitRate: 100,
        minEmitPower: 1,
        maxEmitPower: 3,
        speed: 2.0,
        gravity: new Vector3(0, 0, 0),
        turbulence: 0,
        colorStart: new Color4(1, 1, 1, 1),
        colorEnd: new Color4(1, 1, 1, 0),
        emitterPosition: new Vector3(0, 0, 0),
        emitterSize: new Vector3(1, 1, 1),
        rotationSpeed: 0
    },
    adjustableParams: [
        'emitRate',
        'minSize',
        'maxSize',
        'speed',
        'lifeTime',
        'minEmitPower',
        'maxEmitPower',
        'turbulence',
        'rotationSpeed',
        'emitterPosition',
        'emitterSize',
        'emitNormal',
        'gravity',
        'colorStart',
        'colorEnd'
    ],
    textureSource: 'external',
    texture: 'texture/flare.png',
    blendMode: 'oneOne',
    depthWrite: false,
    enableRotation: false,
    defaultMaxParticles: 10000
});

// Keep backward-compatible exports
export function getParticlePreset(type: string): ParticlePresetConfig | undefined {
    return particlePresetRegistry.get(type);
}

export function getAdjustableParams(type: string): string[] {
    return particlePresetRegistry.get(type)?.adjustableParams ?? [];
}
