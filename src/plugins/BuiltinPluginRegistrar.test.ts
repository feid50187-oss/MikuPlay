import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetAll, mockRegister, mockUnregister } = vi.hoisted(() => ({
    mockGetAll: vi.fn(),
    mockRegister: vi.fn(),
    mockUnregister: vi.fn(),
}));

vi.mock('../core/PluginRegistry', () => ({
    pluginRegistry: {
        register: mockRegister,
        unregister: mockUnregister,
        getAll: mockGetAll,
    },
    PluginRegistry: class {
        register = mockRegister;
        unregister = mockUnregister;
        getAll = mockGetAll;
    },
}));

vi.mock('../features/particle/particlePresets', () => ({
    particlePresetRegistry: {
        getAll: mockGetAll,
    },
}));

vi.mock('../features/ground/basicGround', () => ({
    BasicGround: class BasicGround {
        create = vi.fn();
        dispose = vi.fn();
        setScale = vi.fn();
        setHeight = vi.fn();
    },
}));

vi.mock('../features/ground/waterGround', () => ({
    WaterGround: class WaterGround {
        create = vi.fn();
        dispose = vi.fn();
        setScale = vi.fn();
        setHeight = vi.fn();
    },
}));

vi.mock('../features/ground/reflectiveGround', () => ({
    ReflectiveGround: class ReflectiveGround {
        create = vi.fn();
        dispose = vi.fn();
        setScale = vi.fn();
        setHeight = vi.fn();
    },
}));

import { registerBuiltinPlugins } from './BuiltinPluginRegistrar';
import type { PluginEntry, FunctionalPluginExports } from '../core/IPlugin';

describe('BuiltinPluginRegistrar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('registerBuiltinPlugins', () => {
        it('should register ground plugins', async () => {
            mockGetAll.mockReturnValue([]);

            registerBuiltinPlugins();

            const groundCalls = mockRegister.mock.calls.filter(
                (call) => call[0]?.manifest?.target === 'ground'
            );

            expect(groundCalls.length).toBe(3);

            const groundIds = groundCalls.map((call) => call[0].manifest.id);
            expect(groundIds).toContain('builtin.ground.basic');
            expect(groundIds).toContain('builtin.ground.reflective');
            expect(groundIds).toContain('builtin.ground.water');
        });

        it('should register ground plugins with correct manifest', async () => {
            mockGetAll.mockReturnValue([]);

            registerBuiltinPlugins();

            const basicGroundCall = mockRegister.mock.calls.find(
                (call) => call[0]?.manifest?.id === 'builtin.ground.basic'
            );

            expect(basicGroundCall).toBeDefined();
            if (!basicGroundCall) return;
            const entry = basicGroundCall[0] as PluginEntry;

            expect(entry.manifest.name).toBe('基础地面');
            expect(entry.manifest.version).toBe('1.0');
            expect(entry.manifest.type).toBe('functional');
            expect(entry.manifest.target).toBe('ground');
            expect(entry.enabled).toBe(true);
            expect(entry.builtIn).toBe(true);
        });

        it('should register ground plugins with createInstance', async () => {
            mockGetAll.mockReturnValue([]);

            registerBuiltinPlugins();

            const basicGroundCall = mockRegister.mock.calls.find(
                (call) => call[0]?.manifest?.id === 'builtin.ground.basic'
            );

            expect(basicGroundCall).toBeDefined();
            if (!basicGroundCall) return;
            const entry = basicGroundCall[0] as PluginEntry;
            const funcData = entry.data as FunctionalPluginExports;

            expect(funcData.createInstance).toBeDefined();
            expect(typeof funcData.createInstance).toBe('function');
        });

        it('should register particle plugins from preset registry', async () => {
            mockGetAll.mockReturnValue([
                {
                    type: 'rain',
                    name: '雨滴',
                    defaultParams: { emitRate: 100 },
                    textureSource: 'procedural',
                    texture: 'rain',
                    blendMode: 'standard',
                    depthWrite: false,
                    enableRotation: false,
                    defaultMaxParticles: 5000,
                },
                {
                    type: 'sakura',
                    name: '樱花',
                    defaultParams: { emitRate: 50 },
                    textureSource: 'procedural',
                    texture: 'sakura',
                    blendMode: 'standard',
                    depthWrite: false,
                    enableRotation: true,
                    defaultMaxParticles: 2000,
                },
            ]);

            registerBuiltinPlugins();

            const particleCalls = mockRegister.mock.calls.filter(
                (call) => call[0]?.manifest?.target === 'particle'
            );

            expect(particleCalls.length).toBe(2);

            const particleIds = particleCalls.map((call) => call[0].manifest.id);
            expect(particleIds).toContain('builtin.particle.rain');
            expect(particleIds).toContain('builtin.particle.sakura');
        });

        it('should register particle plugins with renderConfig', async () => {
            mockGetAll.mockReturnValue([
                {
                    type: 'snow',
                    name: '雪花',
                    defaultParams: {},
                    textureSource: 'procedural',
                    texture: 'snow',
                    blendMode: 'standard',
                    depthWrite: true,
                    enableRotation: true,
                    defaultMaxParticles: 3000,
                },
            ]);

            registerBuiltinPlugins();

            const snowCall = mockRegister.mock.calls.find(
                (call) => call[0]?.manifest?.id === 'builtin.particle.snow'
            );

            expect(snowCall).toBeDefined();
            if (!snowCall) return;
            const entry = snowCall[0] as PluginEntry;
            const funcData = entry.data as FunctionalPluginExports;

            expect(funcData.preset.renderConfig).toBeDefined();
            expect(funcData.preset.renderConfig?.textureSource).toBe('procedural');
            expect(funcData.preset.renderConfig?.texture).toBe('snow');
            expect(funcData.preset.renderConfig?.depthWrite).toBe(true);
            expect(funcData.preset.renderConfig?.enableRotation).toBe(true);
            expect(funcData.preset.renderConfig?.defaultMaxParticles).toBe(3000);
        });

        it('should register particle plugins with correct manifest', async () => {
            mockGetAll.mockReturnValue([
                {
                    type: 'basic',
                    name: '基础粒子',
                    defaultParams: {},
                    textureSource: 'builtin',
                    texture: 'flare',
                    blendMode: 'oneOne',
                    depthWrite: false,
                    enableRotation: false,
                    defaultMaxParticles: 1000,
                },
            ]);

            registerBuiltinPlugins();

            const basicCall = mockRegister.mock.calls.find(
                (call) => call[0]?.manifest?.id === 'builtin.particle.basic'
            );

            expect(basicCall).toBeDefined();
            if (!basicCall) return;
            const entry = basicCall[0] as PluginEntry;

            expect(entry.manifest.name).toBe('基础粒子');
            expect(entry.manifest.version).toBe('1.0');
            expect(entry.manifest.type).toBe('functional');
            expect(entry.manifest.target).toBe('particle');
            expect(entry.enabled).toBe(true);
            expect(entry.builtIn).toBe(true);
        });

        it('should set empty controls for builtin particles', async () => {
            mockGetAll.mockReturnValue([
                {
                    type: 'test',
                    name: 'Test',
                    defaultParams: {},
                    textureSource: 'procedural',
                    texture: 'test',
                    blendMode: 'standard',
                    depthWrite: false,
                    enableRotation: false,
                    defaultMaxParticles: 1000,
                },
            ]);

            registerBuiltinPlugins();

            const testCall = mockRegister.mock.calls.find(
                (call) => call[0]?.manifest?.id === 'builtin.particle.test'
            );

            expect(testCall).toBeDefined();
            if (!testCall) return;
            const entry = testCall[0] as PluginEntry;
            const funcData = entry.data as FunctionalPluginExports;

            expect(funcData.preset.controls).toEqual([]);
        });

        it('should handle empty particle preset registry', async () => {
            mockGetAll.mockReturnValue([]);

            registerBuiltinPlugins();

            const particleCalls = mockRegister.mock.calls.filter(
                (call) => call[0]?.manifest?.target === 'particle'
            );

            expect(particleCalls.length).toBe(0);
        });
    });
});