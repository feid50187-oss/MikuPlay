
import { eventBus, Events } from '../../core';
import type { IPostProcessAdapter } from '../../core/IPostProcessAdapter';

/**
 * 后处理适配器注册表
 *
 * 管理所有后处理适配器的注册、注销和查询。
 * 适配器按 order 排序返回，确保管线执行顺序正确。
 */
export class PostProcessAdapterRegistry {
    private adapters = new Map<string, IPostProcessAdapter>();
    private _cachedAll: IPostProcessAdapter[] | null = null;
    private _cacheDirty: boolean = true;

    register(adapter: IPostProcessAdapter): void {
        if (this.adapters.has(adapter.typeId)) {
            console.warn(`[PostProcessAdapterRegistry] 适配器 "${adapter.typeId}" 已注册，将被覆盖`);
        }
        this.adapters.set(adapter.typeId, adapter);
        this._cacheDirty = true;
        eventBus.emit(Events.POSTPROC_ADAPTER_REGISTERED, { typeId: adapter.typeId });
    }

    unregister(typeId: string): void {
        this.adapters.delete(typeId);
        this._cacheDirty = true;
        eventBus.emit(Events.POSTPROC_ADAPTER_UNREGISTERED, { typeId });
    }

    get(typeId: string): IPostProcessAdapter | undefined {
        return this.adapters.get(typeId);
    }

    /** 获取所有适配器，按 order 升序排列 */
    getAll(): IPostProcessAdapter[] {
        if (!this._cacheDirty && this._cachedAll !== null) {
            return this._cachedAll;
        }
        this._cachedAll = Array.from(this.adapters.values()).sort((a, b) => a.order - b.order);
        this._cacheDirty = false;
        return this._cachedAll;
    }

    hasAdapters(): boolean {
        return this.adapters.size > 0;
    }
}

export const postProcessAdapterRegistry = new PostProcessAdapterRegistry();
