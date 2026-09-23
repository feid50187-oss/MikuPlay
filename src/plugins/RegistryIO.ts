import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import type { PluginRegistryData, RegistryEntry } from '../core/IPlugin';

const REGISTRY_PATH = 'plugins/registry.json';

/**
 * 插件注册表（registry.json）读写。
 * 职责单一：只负责注册表的持久化与内存缓存，不做任何插件逻辑。
 */
export class RegistryIO {
    // 内存缓存，避免每次操作从磁盘重新 JSON.parse
    private cache: PluginRegistryData | null = null;

    async read(): Promise<PluginRegistryData> {
        if (this.cache) return this.cache;
        try {
            const result = await Filesystem.readFile({
                path: REGISTRY_PATH,
                directory: Directory.Data,
                encoding: Encoding.UTF8,
            });
            const data = typeof result.data === 'string' ? result.data : await this.blobToString(result.data);
            this.cache = JSON.parse(data) as PluginRegistryData;
            return this.cache;
        } catch {
            this.cache = { plugins: {} };
            return this.cache;
        }
    }

    async write(data: PluginRegistryData): Promise<void> {
        this.cache = data;
        await Filesystem.writeFile({
            path: REGISTRY_PATH,
            directory: Directory.Data,
            data: JSON.stringify(data, null, 2),
            encoding: Encoding.UTF8,
            recursive: true,
        });
    }

    async update(pluginId: string, updates: Partial<RegistryEntry>): Promise<void> {
        const registry = await this.read();
        const existing = registry.plugins[pluginId] || ({} as RegistryEntry);
        registry.plugins[pluginId] = { ...existing, ...updates };
        await this.write(registry);
    }

    async remove(pluginId: string): Promise<void> {
        const registry = await this.read();
        // 用 delete 删除键：旧实现赋 undefined 会导致 Object.entries 遍历出值为 undefined 的条目，
        // loadFromDisk 里取 entry.enabled 时直接 TypeError。
        delete registry.plugins[pluginId];
        await this.write(registry);
    }

    private blobToString(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
        });
    }
}

export const registryIO = new RegistryIO();
