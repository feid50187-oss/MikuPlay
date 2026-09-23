
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export class PluginStorage {
    private basePath: string;

    constructor(pluginId: string) {
        this.basePath = `plugins/_storage/${pluginId}`;
    }

    async set(key: string, value: unknown): Promise<void> {
        await Filesystem.writeFile({
            path: `${this.basePath}/${key}.json`,
            directory: Directory.Data,
            data: JSON.stringify(value),
            encoding: Encoding.UTF8,
            recursive: true,
        });
    }

    async get<T>(key: string): Promise<T | undefined> {
        try {
            const result = await Filesystem.readFile({
                path: `${this.basePath}/${key}.json`,
                directory: Directory.Data,
                encoding: Encoding.UTF8,
            });
            const data = typeof result.data === 'string' ? result.data : await this.blobToString(result.data);
            return JSON.parse(data) as T;
        } catch {
            return undefined;
        }
    }

    private blobToString(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
        });
    }

    async remove(key: string): Promise<void> {
        try {
            await Filesystem.deleteFile({
                path: `${this.basePath}/${key}.json`,
                directory: Directory.Data,
            });
        } catch {
        }
    }

    async clear(): Promise<void> {
        try {
            await Filesystem.rmdir({
                path: this.basePath,
                directory: Directory.Data,
                recursive: true,
            });
        } catch {
        }
    }
}
