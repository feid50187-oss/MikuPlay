
import type {
    PluginEntry,
    PluginExports,
} from './IPlugin';

export class PluginRegistry {
    private plugins = new Map<string, PluginEntry>();
    private hostRefreshCallbacks: (() => void)[] = [];

    register(entry: PluginEntry): void {
        this.plugins.set(entry.manifest.id, entry);
    }

    unregister(id: string): void {
        const entry = this.plugins.get(id);
        if (entry) {
            this.safeCall(id, entry.data.dispose, 'dispose');
            this.plugins.delete(id);
        }
    }

    get(id: string): PluginEntry | undefined {
        return this.plugins.get(id);
    }

    getByTarget(target: string): PluginEntry[] {
        return [...this.plugins.values()]
            .filter(p => p.enabled && p.manifest.type === 'functional' && p.manifest.target === target);
    }

    getByType(type: 'functional' | 'ui'): PluginEntry[] {
        return [...this.plugins.values()]
            .filter(p => p.enabled && p.manifest.type === type);
    }

    getByMount(mount: 'tab' | 'overlay'): PluginEntry[] {
        return [...this.plugins.values()]
            .filter(p => p.enabled && p.manifest.type === 'ui' && (p.manifest.mount ?? 'tab') === mount);
    }

    getAll(): PluginEntry[] {
        return [...this.plugins.values()];
    }

    /** 释放全部已注册插件（应用退出 / 场景销毁时调用），逐个 safeCall dispose */
    async disposeAll(): Promise<void> {
        for (const entry of this.plugins.values()) {
            await this.safeCall(entry.manifest.id, entry.data.dispose, 'dispose');
        }
    }

    async safeCall(
        pluginId: string,
        fn: (() => void | Promise<void>) | undefined,
        method: string
    ): Promise<void> {
        if (!fn) return;
        try {
            await fn();
        } catch (error) {
            console.error(`[Plugin:${pluginId}] ${method} 执行失败:`, error);
        }
    }

    onHostRefresh(callback: () => void): void {
        this.hostRefreshCallbacks.push(callback);
    }

    notifyHosts(): void {
        this.hostRefreshCallbacks.forEach(cb => cb());
    }
}

export const pluginRegistry = new PluginRegistry();
