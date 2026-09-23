/**
 * 表情/变形控制 API 服务
 * 插件可通过此服务控制模型的 morphs（表情变形）
 */
import type { MmdModel } from '@pixiv/mmd-viewer';

export interface MorphInfo {
    name: string;
    weight: number;
    min: number;
    max: number;
}

export class MorphApiService {
    private static instance: MorphApiService;

    private constructor() {}

    static getInstance(): MorphApiService {
        if (!MorphApiService.instance) {
            MorphApiService.instance = new MorphApiService();
        }
        return MorphApiService.instance;
    }

    /**
     * 获取模型所有 morph 列表
     */
    getMorphList(model: MmdModel): MorphInfo[] {
        const morphs: MorphInfo[] = [];
        if (model.morphManager && model.morphManager.morphRuntimeBones) {
            // 遍历所有 morph
            Object.keys(model.morphManager.morphRuntimeBones).forEach(name => {
                morphs.push({
                    name,
                    weight: 0,
                    min: 0,
                    max: 1
                });
            });
        }
        return morphs;
    }

    /**
     * 设置 morph 权重
     */
    setMorphWeight(model: MmdModel, morphName: string, weight: number): void {
        // 安全约束：权重范围 0-1
        const clampedWeight = Math.max(0, Math.min(1, weight));

        if (model.morphManager) {
            try {
                model.morphManager.setMorphWeight(morphName, clampedWeight);
            } catch (e) {
                console.warn('[MorphApi] 设置 morph 失败:', morphName, e);
            }
        }
    }

    /**
     * 获取 morph 权重
     */
    getMorphWeight(model: MmdModel, morphName: string): number {
        if (model.morphManager) {
            try {
                return model.morphManager.getMorphWeight(morphName) || 0;
            } catch {
                return 0;
            }
        }
        return 0;
    }

    /**
     * 重置所有 morph
     */
    resetAllMorphs(model: MmdModel): void {
        if (model.morphManager) {
            try {
                const morphs = this.getMorphList(model);
                morphs.forEach(m => {
                    this.setMorphWeight(model, m.name, 0);
                });
            } catch (e) {
                console.warn('[MorphApi] 重置 morph 失败:', e);
            }
        }
    }

    /**
     * 批量设置 morph 权重
     */
    setMorphWeights(model: MmdModel, weights: Record<string, number>): void {
        Object.entries(weights).forEach(([name, weight]) => {
            this.setMorphWeight(model, name, weight);
        });
    }
}

export const morphApiService = MorphApiService.getInstance();
