/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
    mockReadFile,
    mockWriteFile,
    mockRmdir,
    mockGetUri,
    mockRegister,
    mockUnregister,
    mockConvertFileSrc,
} = vi.hoisted(() => ({
    mockReadFile: vi.fn(),
    mockWriteFile: vi.fn(),
    mockRmdir: vi.fn(),
    mockGetUri: vi.fn(),
    mockRegister: vi.fn(),
    mockUnregister: vi.fn(),
    mockConvertFileSrc: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        readFile: mockReadFile,
        writeFile: mockWriteFile,
        rmdir: mockRmdir,
        getUri: mockGetUri,
    },
    Directory: { Data: 'Data' },
    Encoding: { UTF8: 'utf8' },
}));

vi.mock('@capacitor/core', () => ({
    Capacitor: {
        convertFileSrc: mockConvertFileSrc,
    },
}));

vi.mock('../core/PluginRegistry', () => ({
    pluginRegistry: {
        register: mockRegister,
        unregister: mockUnregister,
        get: vi.fn(),
    },
}));

vi.mock('./PluginInstaller', () => ({
    pluginInstaller: {
        install: vi.fn(),
    },
}));

import { PluginLoader } from './PluginLoader';
import type { PluginRegistryData } from '../core/IPlugin';

describe('PluginLoader', () => {
    let loader: PluginLoader;

    beforeEach(() => {
        vi.clearAllMocks();
        loader = new PluginLoader();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('readRegistry', () => {
        it('should return parsed registry data', async () => {
            const registryData: PluginRegistryData = {
                plugins: {
                    'test.plugin': {
                        version: '1.0',
                        enabled: true,
                        installedAt: '2024-01-01T00:00:00Z',
                    },
                },
            };
            mockReadFile.mockResolvedValueOnce({ data: JSON.stringify(registryData) });

            const result = await loader.readRegistry();

            expect(result).toEqual(registryData);
        });

        it('should return empty registry when file does not exist', async () => {
            mockReadFile.mockRejectedValueOnce(new Error('File not found'));

            const result = await loader.readRegistry();

            expect(result).toEqual({ plugins: {} });
        });
    });

    describe('writeRegistry', () => {
        it('should write formatted JSON to file', async () => {
            const data: PluginRegistryData = {
                plugins: {
                    'new.plugin': {
                        version: '1.0',
                        enabled: true,
                        installedAt: '2024-01-01T00:00:00Z',
                    },
                },
            };

            await loader.writeRegistry(data);

            expect(mockWriteFile).toHaveBeenCalledWith({
                path: 'plugins/registry.json',
                directory: 'Data',
                data: JSON.stringify(data, null, 2),
                encoding: 'utf8',
                recursive: true,
            });
        });
    });

    describe('updateRegistryEntry', () => {
        it('should add new entry to registry', async () => {
            mockReadFile.mockResolvedValueOnce({ data: JSON.stringify({ plugins: {} }) });

            await loader.updateRegistryEntry('new.plugin', {
                version: '1.0',
                enabled: true,
                installedAt: '2024-01-01T00:00:00Z',
            });

            const writeCall = mockWriteFile.mock.calls[0][0];
            const writtenData = JSON.parse(writeCall.data);

            expect(writtenData.plugins['new.plugin']).toEqual({
                version: '1.0',
                enabled: true,
                installedAt: '2024-01-01T00:00:00Z',
            });
        });

        it('should update existing entry', async () => {
            mockReadFile.mockResolvedValueOnce({
                data: JSON.stringify({
                    plugins: {
                        'existing.plugin': {
                            version: '1.0',
                            enabled: true,
                            installedAt: '2024-01-01T00:00:00Z',
                        },
                    },
                }),
            });

            await loader.updateRegistryEntry('existing.plugin', {
                enabled: false,
            });

            const writeCall = mockWriteFile.mock.calls[0][0];
            const writtenData = JSON.parse(writeCall.data);

            expect(writtenData.plugins['existing.plugin']).toEqual({
                version: '1.0',
                enabled: false,
                installedAt: '2024-01-01T00:00:00Z',
            });
        });
    });

    describe('removeRegistryEntry', () => {
        it('should remove entry from registry', async () => {
            mockReadFile.mockResolvedValueOnce({
                data: JSON.stringify({
                    plugins: {
                        'to.remove': { version: '1.0', enabled: true, installedAt: '' },
                        'to.keep': { version: '1.0', enabled: true, installedAt: '' },
                    },
                }),
            });

            await loader.removeRegistryEntry('to.remove');

            const writeCall = mockWriteFile.mock.calls[0][0];
            const writtenData = JSON.parse(writeCall.data);

            expect(writtenData.plugins['to.remove']).toBeUndefined();
            expect(writtenData.plugins['to.keep']).toBeDefined();
            // 键应被删除而非置为 undefined，避免后续 Object.entries 遍历出空条目
            expect(Object.keys(writtenData.plugins)).toEqual(['to.keep']);
        });
    });

    describe('setPluginEnabled', () => {
        it('should update enabled status', async () => {
            mockReadFile.mockResolvedValueOnce({
                data: JSON.stringify({
                    plugins: {
                        'test.plugin': { version: '1.0', enabled: true, installedAt: '' },
                    },
                }),
            });

            await loader.setPluginEnabled('test.plugin', false);

            const writeCall = mockWriteFile.mock.calls[0][0];
            const writtenData = JSON.parse(writeCall.data);

            expect(writtenData.plugins['test.plugin'].enabled).toBe(false);
        });
    });

    describe('uninstallPlugin', () => {
        it('should remove plugin directory, storage and registry entry', async () => {
            mockGetUri.mockResolvedValueOnce({ uri: 'file:///data/plugins' });
            await loader.uninstallPlugin('test.plugin');

            expect(mockRmdir).toHaveBeenCalledWith({
                path: 'plugins/test.plugin',
                directory: 'Data',
                recursive: true,
            });

            expect(mockRmdir).toHaveBeenCalledWith({
                path: 'plugins/_storage/test.plugin',
                directory: 'Data',
                recursive: true,
            });

            // 卸载时应从内存注册表移除
            expect(mockUnregister).toHaveBeenCalledWith('test.plugin');
        });

        it('should handle missing storage directory', async () => {
            mockRmdir
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('Directory not found'));

            await expect(loader.uninstallPlugin('test.plugin')).resolves.not.toThrow();
        });
    });

    describe('loadFromDisk', () => {
        it('should skip disabled plugins without executing code', async () => {
            mockReadFile
                .mockResolvedValueOnce({
                    data: JSON.stringify({
                        plugins: {
                            'disabled.plugin': {
                                version: '1.0',
                                enabled: false,
                                installedAt: '',
                            },
                        },
                    }),
                })
                .mockResolvedValueOnce({
                    data: JSON.stringify({
                        id: 'disabled.plugin',
                        name: 'Disabled',
                        type: 'ui',
                    }),
                });

            const contextFactory = vi.fn();
            await loader.loadFromDisk(contextFactory);

            // 只读 registry + manifest，不读 index.js，不执行代码
            expect(mockReadFile).toHaveBeenCalledTimes(2);
            expect(contextFactory).not.toHaveBeenCalled();
            expect(mockRegister).toHaveBeenCalledTimes(1);
        });

        it('should skip plugins with invalid manifest', async () => {
            mockReadFile
                .mockResolvedValueOnce({
                    data: JSON.stringify({
                        plugins: {
                            'invalid.plugin': {
                                version: '1.0',
                                enabled: true,
                                installedAt: '',
                            },
                        },
                    }),
                })
                .mockResolvedValueOnce({
                    data: JSON.stringify({
                        name: 'Invalid Plugin',
                    }),
                });

            const contextFactory = vi.fn();
            await loader.loadFromDisk(contextFactory);

            expect(mockRegister).not.toHaveBeenCalled();
        });

        it('should handle load errors gracefully', async () => {
            mockReadFile
                .mockResolvedValueOnce({
                    data: JSON.stringify({
                        plugins: {
                            'error.plugin': {
                                version: '1.0',
                                enabled: true,
                                installedAt: '',
                            },
                        },
                    }),
                })
                .mockRejectedValueOnce(new Error('Read error'));

            const contextFactory = vi.fn();

            await expect(loader.loadFromDisk(contextFactory)).resolves.not.toThrow();
            expect(mockRegister).not.toHaveBeenCalled();
        });
    });
});
