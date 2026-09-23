/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginExecutor } from './PluginExecutor';
import type { PluginManifest } from '../core/IPlugin';

function makeManifest(partial: Partial<PluginManifest>): PluginManifest {
    return { id: 'test.plugin', name: 'Test', version: '1.0', type: 'ui', ...partial };
}

describe('PluginExecutor', () => {
    let executor: PluginExecutor;

    beforeEach(() => {
        executor = new PluginExecutor();
    });

    afterEach(() => {
        // 清理黑名单模式下挂载的全局命名空间
        delete (globalThis as any).mp;
        delete (globalThis as any).BABYLON;
    });

    it('should execute plugin code and return exports', async () => {
        const code = `
            var exports = { preset: { name: 'Test', defaultParams: {}, controls: [] } };
        `;
        const manifest = makeManifest({ type: 'functional', target: 'ground' });

        const result = await executor.evaluate(code, {} as any, manifest) as any;

        expect(result.preset.name).toBe('Test');
    });

    it('should expose BABYLON as a global for plugin code', async () => {
        const code = `
            var exports = { hasBabylon: typeof BABYLON !== 'undefined', preset: { name: 'Test', defaultParams: {}, controls: [] } };
        `;
        const manifest = makeManifest({ type: 'functional', target: 'ground' });

        const result = await executor.evaluate(code, {} as any, manifest) as any;

        expect(result.hasBabylon).toBe(true);
    });

    it('should expose mp as a global for plugin code', async () => {
        const code = `
            var exports = { hasMp: typeof mp !== 'undefined', preset: { name: 'Test', defaultParams: {}, controls: [] } };
        `;
        const manifest = makeManifest({ type: 'functional', target: 'ground' });

        const result = await executor.evaluate(code, {} as any, manifest) as any;

        expect(result.hasMp).toBe(true);
    });

    it('should reject ui plugin missing createPanel', async () => {
        const code = `var exports = {};`;
        const manifest = makeManifest({ type: 'ui' });

        await expect(executor.evaluate(code, {} as any, manifest)).rejects.toThrow(/createPanel/);
    });

    it('should reject shading plugin missing adapter', async () => {
        const code = `var exports = {};`;
        const manifest = makeManifest({ type: 'functional', target: 'shading' });

        await expect(executor.evaluate(code, {} as any, manifest)).rejects.toThrow(/adapter/);
    });

    it('should return empty object when no exports defined and no target validation', async () => {
        const code = `var x = 1;`;
        const manifest = makeManifest({ type: 'functional' });

        const result = await executor.evaluate(code, {} as any, manifest);

        expect(result).toEqual({});
    });
});
