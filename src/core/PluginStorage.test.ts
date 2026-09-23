
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockWriteFile, mockReadFile, mockDeleteFile, mockRmdir } = vi.hoisted(() => ({
    mockWriteFile: vi.fn(),
    mockReadFile: vi.fn(),
    mockDeleteFile: vi.fn(),
    mockRmdir: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        writeFile: mockWriteFile,
        readFile: mockReadFile,
        deleteFile: mockDeleteFile,
        rmdir: mockRmdir,
    },
    Directory: { Data: 'Data' },
    Encoding: { UTF8: 'utf8' },
}));

import { PluginStorage } from './PluginStorage';

describe('PluginStorage', () => {
    let storage: PluginStorage;

    beforeEach(() => {
        vi.clearAllMocks();
        storage = new PluginStorage('test-plugin');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should create storage with correct base path', () => {
            const storage1 = new PluginStorage('plugin-a');
            expect(storage1).toBeDefined();
        });
    });

    describe('set', () => {
        it('should write JSON data to file', async () => {
            const data = { name: 'test', value: 123 };
            await storage.set('config', data);

            expect(mockWriteFile).toHaveBeenCalledWith({
                path: 'plugins/_storage/test-plugin/config.json',
                directory: 'Data',
                data: JSON.stringify(data),
                encoding: 'utf8',
                recursive: true,
            });
        });

        it('should handle complex objects', async () => {
            const data = {
                nested: { deep: { value: 'test' } },
                array: [1, 2, 3],
            };
            await storage.set('complex', data);

            expect(mockWriteFile).toHaveBeenCalled();
            const call = mockWriteFile.mock.calls[0][0];
            expect(JSON.parse(call.data)).toEqual(data);
        });

        it('should handle primitive values', async () => {
            await storage.set('number', 42);
            await storage.set('string', 'hello');
            await storage.set('boolean', true);

            expect(mockWriteFile).toHaveBeenCalledTimes(3);
        });
    });

    describe('get', () => {
        it('should read and parse JSON data', async () => {
            const data = { name: 'test', value: 123 };
            mockReadFile.mockResolvedValueOnce({ data: JSON.stringify(data) });

            const result = await storage.get<typeof data>('config');

            expect(result).toEqual(data);
            expect(mockReadFile).toHaveBeenCalledWith({
                path: 'plugins/_storage/test-plugin/config.json',
                directory: 'Data',
                encoding: 'utf8',
            });
        });

        it('should return undefined when file does not exist', async () => {
            mockReadFile.mockRejectedValueOnce(new Error('File not found'));

            const result = await storage.get('nonexistent');

            expect(result).toBeUndefined();
        });
    });

    describe('remove', () => {
        it('should delete the file', async () => {
            await storage.remove('config');

            expect(mockDeleteFile).toHaveBeenCalledWith({
                path: 'plugins/_storage/test-plugin/config.json',
                directory: 'Data',
            });
        });

        it('should not throw when file does not exist', async () => {
            mockDeleteFile.mockRejectedValueOnce(new Error('File not found'));

            await expect(storage.remove('nonexistent')).resolves.not.toThrow();
        });
    });

    describe('clear', () => {
        it('should remove the entire storage directory', async () => {
            await storage.clear();

            expect(mockRmdir).toHaveBeenCalledWith({
                path: 'plugins/_storage/test-plugin',
                directory: 'Data',
                recursive: true,
            });
        });

        it('should not throw when directory does not exist', async () => {
            mockRmdir.mockRejectedValueOnce(new Error('Directory not found'));

            await expect(storage.clear()).resolves.not.toThrow();
        });
    });

    describe('integration', () => {
        it('should support set-get-remove cycle', async () => {
            const data = { key: 'value', nested: { a: 1 } };

            mockReadFile.mockResolvedValueOnce({ data: JSON.stringify(data) });

            await storage.set('test-key', data);
            const result = await storage.get<typeof data>('test-key');
            await storage.remove('test-key');

            expect(mockWriteFile).toHaveBeenCalled();
            expect(result).toEqual(data);
            expect(mockDeleteFile).toHaveBeenCalled();
        });
    });
});
