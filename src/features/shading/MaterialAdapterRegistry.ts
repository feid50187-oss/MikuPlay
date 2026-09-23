
import type { Material } from '@babylonjs/core';
import { eventBus, Events } from '../../core';
import type { IMaterialAdapter } from '../../core/IMaterialAdapter';

export class MaterialAdapterRegistry {
    private adapters = new Map<string, IMaterialAdapter>();
    /** findAdapter 缓存：material.uniqueId -> adapter */
    private findAdapterCache = new Map<number, IMaterialAdapter>();
    /** getMaterialCreatingAdapters 缓存 */
    private materialCreatingAdaptersCache: IMaterialAdapter[] | null = null;

    /** 清除所有缓存 */
    private clearCache(): void {
        this.findAdapterCache.clear();
        this.materialCreatingAdaptersCache = null;
    }

    register(adapter: IMaterialAdapter): void {
        this.adapters.set(adapter.typeId, adapter);
        this.clearCache();
        eventBus.emit(Events.SHADING_ADAPTER_REGISTERED, { typeId: adapter.typeId });
    }

    unregister(typeId: string): void {
        this.adapters.delete(typeId);
        this.clearCache();
        eventBus.emit(Events.SHADING_ADAPTER_UNREGISTERED, { typeId });
    }

    get(typeId: string): IMaterialAdapter | undefined {
        return this.adapters.get(typeId);
    }

    /** 根据材质实例自动查找适配器 */
    findAdapter(material: Material): IMaterialAdapter | undefined {
        const uniqueId = material.uniqueId;
        const cached = this.findAdapterCache.get(uniqueId);
        if (cached !== undefined) {
            return cached;
        }
        for (const adapter of this.adapters.values()) {
            if (adapter.canHandle(material)) {
                this.findAdapterCache.set(uniqueId, adapter);
                return adapter;
            }
        }
        return undefined;
    }

    getAll(): IMaterialAdapter[] {
        return [...this.adapters.values()];
    }

    /** 是否存在任何 createsMaterial=true 的已注册适配器 */
    hasMaterialCreatingAdapters(): boolean {
        for (const adapter of this.adapters.values()) {
            if (adapter.createsMaterial) return true;
        }
        return false;
    }

    /** 获取所有 createsMaterial=true 的适配器（用于风格选择器） */
    getMaterialCreatingAdapters(): IMaterialAdapter[] {
        if (this.materialCreatingAdaptersCache !== null) {
            return this.materialCreatingAdaptersCache;
        }
        this.materialCreatingAdaptersCache = [...this.adapters.values()].filter(a => a.createsMaterial);
        return this.materialCreatingAdaptersCache;
    }
}

export const materialAdapterRegistry = new MaterialAdapterRegistry();
