/**
 * 设置持久化 API 服务
 * 插件可通过此服务保存和读取自己的设置
 * 每个插件有独立的命名空间，不会互相干扰
 */

export class SettingsApiService {
    private static instance: SettingsApiService;
    private pluginId: string = 'default';
    private cache: Map<string, unknown> = new Map();

    private constructor() {}

    static getInstance(): SettingsApiService {
        if (!SettingsApiService.instance) {
            SettingsApiService.instance = new SettingsApiService();
        }
        return SettingsApiService.instance;
    }

    /**
     * 设置当前插件 ID（每个插件初始化时调用）
     */
    setPluginId(pluginId: string): void {
        this.pluginId = pluginId;
        this.cache.clear();
    }

    /**
     * 保存设置
     */
    async set<T>(key: string, value: T): Promise<void> {
        const fullKey = this.getFullKey(key);
        this.cache.set(fullKey, value);

        // 持久化到 localStorage
        localStorage.setItem(fullKey, JSON.stringify({ value }));
    }

    /**
     * 读取设置
     */
    async get<T>(key: string, defaultValue?: T): Promise<T | undefined> {
        const fullKey = this.getFullKey(key);

        // 先从缓存读取
        if (this.cache.has(fullKey)) {
            return this.cache.get(fullKey) as T;
        }

        // 从 localStorage 读取
        try {
            const raw = localStorage.getItem(fullKey);
            if (raw) {
                const data = JSON.parse(raw);
                this.cache.set(fullKey, data.value);
                return data.value as T;
            }
        } catch (e) {
            console.warn('[SettingsApi] 读取设置失败:', key, e);
        }

        return defaultValue;
    }

    /**
     * 删除设置
     */
    async remove(key: string): Promise<void> {
        const fullKey = this.getFullKey(key);
        this.cache.delete(fullKey);
        localStorage.removeItem(fullKey);
    }

    /**
     * 清空当前插件的所有设置
     */
    async clear(): Promise<void> {
        const prefix = this.getFullKey('');
        const keysToRemove: string[] = [];

        // 找出所有当前插件的 key
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                keysToRemove.push(key);
            }
        }

        keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            this.cache.delete(key);
        });
    }

    /**
     * 获取所有设置的 key 列表
     */
    async getAllKeys(): Promise<string[]> {
        const prefix = this.getFullKey('');
        const keys: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                // 去掉前缀
                keys.push(key.slice(prefix.length));
            }
        }

        return keys;
    }

    /**
     * 获取完整 key（带插件前缀）
     */
    private getFullKey(key: string): string {
        return `plugin_settings_${this.pluginId}_${key}`;
    }
}

export const settingsApiService = SettingsApiService.getInstance();
