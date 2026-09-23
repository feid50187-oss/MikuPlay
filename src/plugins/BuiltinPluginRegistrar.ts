import { pluginRegistry } from '../core/PluginRegistry';
import type { PluginEntry, FunctionalPluginExports, ShadingPluginExports } from '../core/IPlugin';

import { BasicGround } from '../features/ground/basicGround';
import { WaterGround } from '../features/ground/waterGround';
import { ReflectiveGround } from '../features/ground/reflectiveGround';

import { particlePresetRegistry } from '../features/particle/particlePresets';
import { MmdStandardMaterialAdapter } from '../features/shading/MmdStandardMaterialAdapter';
import { PbrMaterialAdapter } from '../features/shading/PbrMaterialAdapter';
import { ToonShadingMaterialAdapter } from '../features/shading/ToonShadingMaterialAdapter';
import { materialAdapterRegistry } from '../features/shading/MaterialAdapterRegistry';
import { Events, eventBus } from '../core/index';

export function registerBuiltinPlugins(): void {
    registerBuiltinGrounds();
    registerBuiltinParticles();
    registerBuiltinShadings();
}

function registerBuiltinGrounds(): void {
    const groundTypes: Array<{
        id: string;
        name: string;
        factory: () => BasicGround | WaterGround | ReflectiveGround;
    }> = [
        { id: 'builtin.ground.basic', name: '基础地面', factory: () => new BasicGround() },
        { id: 'builtin.ground.reflective', name: '反射地面', factory: () => new ReflectiveGround() },
        { id: 'builtin.ground.water', name: '水面', factory: () => new WaterGround() },
    ];

    for (const g of groundTypes) {
        pluginRegistry.register({
            manifest: {
                id: g.id,
                name: g.name,
                version: '1.0',
                type: 'functional',
                target: 'ground',
            },
            data: {
                preset: { name: g.name, defaultParams: {}, controls: [] },
                createInstance: g.factory,
            } as FunctionalPluginExports,
            enabled: true,
            builtIn: true,
        });
    }
}

function registerBuiltinParticles(): void {
    const presets = particlePresetRegistry.getAll();

    for (const preset of presets) {
        pluginRegistry.register({
            manifest: {
                id: `builtin.particle.${preset.type}`,
                name: preset.name,
                version: '1.0',
                type: 'functional',
                target: 'particle',
            },
            data: {
                preset: {
                    name: preset.name,
                    defaultParams: preset.defaultParams as Record<string, unknown>,
                    controls: [],
                    renderConfig: {
                        textureSource: preset.textureSource,
                        texture: preset.texture,
                        blendMode: preset.blendMode,
                        depthWrite: preset.depthWrite,
                        enableRotation: preset.enableRotation,
                        defaultMaxParticles: preset.defaultMaxParticles,
                    },
                },
            } as FunctionalPluginExports,
            enabled: true,
            builtIn: true,
        });
    }
}

function registerBuiltinShadings(): void {
    const adapter = new MmdStandardMaterialAdapter();

    // 注册适配器到注册表
    materialAdapterRegistry.register(adapter);

    // 注册为内置插件
    pluginRegistry.register({
        manifest: {
            id: 'builtin.shading.mmd-standard',
            name: 'MMD 标准材质',
            version: '1.0',
            type: 'functional',
            target: 'shading',
        },
        data: {
            adapter,
        } as ShadingPluginExports,
        enabled: true,
        builtIn: true,
    });

    // 内置适配器不需要触发事件（UI 尚未初始化）
    // 但为保持一致性，仍然发出事件
    eventBus.emit(Events.SHADING_ADAPTER_REGISTERED, { typeId: adapter.typeId });

    // ===== PBR 材质适配器 =====
    const pbrAdapter = new PbrMaterialAdapter();

    materialAdapterRegistry.register(pbrAdapter);

    pluginRegistry.register({
        manifest: {
            id: 'builtin.shading.pbr',
            name: 'PBR 材质',
            version: '1.0',
            type: 'functional',
            target: 'shading',
        },
        data: {
            adapter: pbrAdapter,
        } as ShadingPluginExports,
        enabled: true,
        builtIn: true,
    });

    eventBus.emit(Events.SHADING_ADAPTER_REGISTERED, { typeId: pbrAdapter.typeId });

    // ===== Toon 卡通材质适配器（Phase 1） =====
    const toonAdapter = new ToonShadingMaterialAdapter();

    materialAdapterRegistry.register(toonAdapter);

    pluginRegistry.register({
        manifest: {
            id: 'builtin.shading.toon',
            name: 'Toon 卡通',
            version: '1.0',
            type: 'functional',
            target: 'shading',
        },
        data: {
            adapter: toonAdapter,
        } as ShadingPluginExports,
        enabled: true,
        builtIn: true,
    });

    eventBus.emit(Events.SHADING_ADAPTER_REGISTERED, { typeId: toonAdapter.typeId });
}