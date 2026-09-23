import type { PluginContext } from '../core/IPlugin';
import type { ModelInfo } from '../features/mmd/ModelManager';

/** mp.model 便利读取层的 API 形态 */
export interface PluginModelApi {
    /** 返回当前全部模型（黑名单模式下包含 mesh/container 等内部引用） */
    list(): ModelInfo[];
    /** 按 ModelId 查询单个模型，不存在返回 undefined */
    get(id: string): ModelInfo | undefined;
    /** 当前模型数量 */
    count(): number;
    /** 订阅模型增删，返回取消订阅函数 */
    onChanged(cb: (model: ModelInfo, added: boolean) => void): () => void;
}

/**
 * 模型读取便利层（mp.model）。
 * 黑名单模式下不再做"只读 DTO 伪装"——插件通过 getAnimationManager/getModelManager
 * 本就能拿到完整 mesh 引用，这里只提供更便捷的"模型列表 + 变更订阅"封装。
 */
export class ModelReadBridge {
    build(context: PluginContext): PluginModelApi {
        return {
            list(): ModelInfo[] {
                return context.app.getModelManager()?.getAllModels() ?? [];
            },
            get(id: string): ModelInfo | undefined {
                return context.app.getModelManager()?.getModel(id);
            },
            count(): number {
                return context.app.getModelManager()?.getAllModels().length ?? 0;
            },
            onChanged(cb: (model: ModelInfo, added: boolean) => void): () => void {
                const mm = context.app.getModelManager();
                return mm ? mm.onModelChanged(cb) : () => {};
            },
        };
    }
}
