
import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from './PluginRegistry';
import type { PluginEntry, FunctionalPluginExports, UIPluginExports } from './IPlugin';

describe('PluginRegistry', () => {
    let registry: PluginRegistry;

    beforeEach(() => {
        registry = new PluginRegistry();
    });

    describe('register', () => {
        it('should register a functional plugin', () => {
            const entry: PluginEntry = {
                manifest: {
                    id: 'test.plugin',
                    name: 'Test Plugin',
                    version: '1.0.0',
                    type: 'functional',
                    target: 'ground',
                },
                data: {
                    preset: { name: 'Test', defaultParams: {}, controls: [] },
                } as FunctionalPluginExports,
                enabled: true,
            };

            registry.register(entry);

            expect(registry.get('test.plugin')).toBe(entry);
        });

        it('should register a UI plugin', () => {
            const entry: PluginEntry = {
                manifest: {
                    id: 'ui.plugin',
                    name: 'UI Plugin',
                    version: '1.1.5',
                    type: 'ui',
                    mount: 'tab',
                },
                data: {
                    createPanel: () => document.createElement('div'),
                } as UIPluginExports,
                enabled: true,
            };

            registry.register(entry);

            expect(registry.get('ui.plugin')).toBe(entry);
        });

        it('should overwrite existing plugin with same id', () => {
            const entry1: PluginEntry = {
                manifest: { id: 'test.plugin', name: 'Plugin 1', version: '1.0', type: 'functional' },
                data: { preset: { name: 'P1', defaultParams: {}, controls: [] } } as FunctionalPluginExports,
                enabled: true,
            };

            const entry2: PluginEntry = {
                manifest: { id: 'test.plugin', name: 'Plugin 2', version: '2.0', type: 'functional' },
                data: { preset: { name: 'P2', defaultParams: {}, controls: [] } } as FunctionalPluginExports,
                enabled: false,
            };

            registry.register(entry1);
            registry.register(entry2);

            const result = registry.get('test.plugin');
            expect(result?.manifest.version).toBe('2.0');
            expect(result?.enabled).toBe(false);
        });
    });

    describe('unregister', () => {
        it('should remove a registered plugin', () => {
            const entry: PluginEntry = {
                manifest: { id: 'test.plugin', name: 'Test', version: '1.1.5', type: 'functional' },
                data: { preset: { name: 'Test', defaultParams: {}, controls: [] } } as FunctionalPluginExports,
                enabled: true,
            };

            registry.register(entry);
            registry.unregister('test.plugin');

            expect(registry.get('test.plugin')).toBeUndefined();
        });

        it('should call dispose when unregistering', async () => {
            let disposed = false;
            const entry: PluginEntry = {
                manifest: { id: 'test.plugin', name: 'Test', version: '1.1.5', type: 'functional' },
                data: {
                    preset: { name: 'Test', defaultParams: {}, controls: [] },
                    dispose: () => { disposed = true; },
                } as FunctionalPluginExports,
                enabled: true,
            };

            registry.register(entry);
            registry.unregister('test.plugin');

            expect(disposed).toBe(true);
        });

        it('should not throw when unregistering non-existent plugin', () => {
            expect(() => registry.unregister('non.existent')).not.toThrow();
        });
    });

    describe('get', () => {
        it('should return undefined for non-existent plugin', () => {
            expect(registry.get('non.existent')).toBeUndefined();
        });
    });

    describe('getByTarget', () => {
        beforeEach(() => {
            registry.register({
                manifest: { id: 'ground.1', name: 'Ground 1', version: '1.0', type: 'functional', target: 'ground' },
                data: { preset: { name: 'G1', defaultParams: {}, controls: [] } } as FunctionalPluginExports,
                enabled: true,
            });
            registry.register({
                manifest: { id: 'ground.2', name: 'Ground 2', version: '1.1.5', type: 'functional', target: 'ground' },
                data: { preset: { name: 'G2', defaultParams: {}, controls: [] } } as FunctionalPluginExports,
                enabled: true,
            });
            registry.register({
                manifest: { id: 'particle.1', name: 'Particle 1', version: '1.1.5', type: 'functional', target: 'particle' },
                data: { preset: { name: 'P1', defaultParams: {}, controls: [] } } as FunctionalPluginExports,
                enabled: true,
            });
            registry.register({
                manifest: { id: 'ui.1', name: 'UI 1', version: '1.1.5', type: 'ui' },
                data: { createPanel: () => document.createElement('div') } as UIPluginExports,
                enabled: true,
            });
        });

        it('should return plugins by target', () => {
            const grounds = registry.getByTarget('ground');
            expect(grounds).toHaveLength(2);
            expect(grounds.map(p => p.manifest.id)).toContain('ground.1');
            expect(grounds.map(p => p.manifest.id)).toContain('ground.2');
        });

        it('should return empty array for non-existent target', () => {
            const result = registry.getByTarget('nonexistent');
            expect(result).toHaveLength(0);
        });

        it('should not include UI plugins', () => {
            const grounds = registry.getByTarget('ground');
            expect(grounds.find(p => p.manifest.id === 'ui.1')).toBeUndefined();
        });
    });

    describe('getByType', () => {
        beforeEach(() => {
            registry.register({
                manifest: { id: 'func.1', name: 'Func 1', version: '1.0', type: 'functional', target: 'ground' },
                data: { preset: { name: 'F1', defaultParams: {}, controls: [] } } as FunctionalPluginExports,
                enabled: true,
            });
            registry.register({
                manifest: { id: 'ui.1', name: 'UI 1', version: '1.0', type: 'ui' },
                data: { createPanel: () => document.createElement('div') } as UIPluginExports,
                enabled: true,
            });
            registry.register({
                manifest: { id: 'ui.2', name: 'UI 2', version: '1.0', type: 'ui', mount: 'overlay' },
                data: { createPanel: () => document.createElement('div') } as UIPluginExports,
                enabled: true,
            });
        });

        it('should return functional plugins', () => {
            const functional = registry.getByType('functional');
            expect(functional).toHaveLength(1);
            expect(functional[0].manifest.id).toBe('func.1');
        });

        it('should return UI plugins', () => {
            const ui = registry.getByType('ui');
            expect(ui).toHaveLength(2);
        });
    });

    describe('getByMount', () => {
        beforeEach(() => {
            registry.register({
                manifest: { id: 'ui.tab', name: 'Tab UI', version: '1.0', type: 'ui', mount: 'tab' },
                data: { createPanel: () => document.createElement('div') } as UIPluginExports,
                enabled: true,
            });
            registry.register({
                manifest: { id: 'ui.overlay', name: 'Overlay UI', version: '1.0', type: 'ui', mount: 'overlay' },
                data: { createPanel: () => document.createElement('div') } as UIPluginExports,
                enabled: true,
            });
            registry.register({
                manifest: { id: 'ui.default', name: 'Default UI', version: '1.0', type: 'ui' },
                data: { createPanel: () => document.createElement('div') } as UIPluginExports,
                enabled: true,
            });
        });

        it('should return tab mounted plugins', () => {
            const tabs = registry.getByMount('tab');
            expect(tabs).toHaveLength(2);
            expect(tabs.map(p => p.manifest.id)).toContain('ui.tab');
            expect(tabs.map(p => p.manifest.id)).toContain('ui.default');
        });

        it('should return overlay mounted plugins', () => {
            const overlays = registry.getByMount('overlay');
            expect(overlays).toHaveLength(1);
            expect(overlays[0].manifest.id).toBe('ui.overlay');
        });
    });

    describe('getAll', () => {
        it('should return all registered plugins', () => {
            registry.register({
                manifest: { id: 'p1', name: 'P1', version: '1.0', type: 'functional', target: 'ground' },
                data: { preset: { name: 'P1', defaultParams: {}, controls: [] } } as FunctionalPluginExports,
                enabled: true,
            });
            registry.register({
                manifest: { id: 'p2', name: 'P2', version: '1.0', type: 'ui' },
                data: { createPanel: () => document.createElement('div') } as UIPluginExports,
                enabled: true,
            });

            const all = registry.getAll();
            expect(all).toHaveLength(2);
        });

        it('should return empty array when no plugins registered', () => {
            expect(registry.getAll()).toHaveLength(0);
        });
    });

    describe('safeCall', () => {
        it('should call function successfully', async () => {
            let called = false;
            await registry.safeCall('test', () => { called = true; }, 'test');
            expect(called).toBe(true);
        });

        it('should handle async functions', async () => {
            let called = false;
            await registry.safeCall('test', async () => {
                await new Promise(r => setTimeout(r, 10));
                called = true;
            }, 'test');
            expect(called).toBe(true);
        });

        it('should not throw on error', async () => {
            await expect(
                registry.safeCall('test', () => { throw new Error('test error'); }, 'test')
            ).resolves.not.toThrow();
        });

        it('should handle undefined function', async () => {
            await expect(
                registry.safeCall('test', undefined, 'test')
            ).resolves.not.toThrow();
        });
    });

    describe('onHostRefresh / notifyHosts', () => {
        it('should notify registered callbacks', () => {
            let notified = false;
            registry.onHostRefresh(() => { notified = true; });
            registry.notifyHosts();
            expect(notified).toBe(true);
        });

        it('should support multiple callbacks', () => {
            let count = 0;
            registry.onHostRefresh(() => { count++; });
            registry.onHostRefresh(() => { count++; });
            registry.notifyHosts();
            expect(count).toBe(2);
        });
    });
});
