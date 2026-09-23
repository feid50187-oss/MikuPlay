/**
 * 骨骼操作 API 服务
 * 插件可通过此服务控制模型骨骼的平移、旋转、缩放
 */
import { BoneManager } from '../mmd/BoneManager';

export type AxisType = 'x' | 'y' | 'z';

export interface BoneTransform {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
}

export class BoneApiService {
    private static instance: BoneApiService;
    private boneManager: BoneManager;

    private constructor() {
        this.boneManager = BoneManager.getInstance();
    }

    static getInstance(): BoneApiService {
        if (!BoneApiService.instance) {
            BoneApiService.instance = new BoneApiService();
        }
        return BoneApiService.instance;
    }

    /**
     * 获取骨骼实例
     */
    getBone(modelId: string, boneName: string) {
        return this.boneManager.getBone(modelId, boneName);
    }

    /**
     * 平移骨骼
     */
    applyTranslation(modelId: string, boneName: string, axis: AxisType, value: number): void {
        this.boneManager.applyBoneTranslation(modelId, boneName, axis, value);
    }

    /**
     * 旋转骨骼
     */
    applyRotation(modelId: string, boneName: string, axis: AxisType, value: number): void {
        this.boneManager.applyBoneRotation(modelId, boneName, axis, value);
    }

    /**
     * 缩放骨骼
     */
    applyScale(modelId: string, boneName: string, axis: AxisType, value: number): void {
        this.boneManager.applyBoneScale(modelId, boneName, axis, value);
    }

    /**
     * 应用当前骨骼变换
     */
    applyCurrentTransform(): void {
        this.boneManager.applyCurrentBoneTransform();
    }

    /**
     * 恢复骨骼变换（恢复到动画状态）
     */
    restoreTransform(modelId: string, boneName: string): void {
        this.boneManager.restoreBoneTransform(modelId, boneName);
    }

    /**
     * 重置骨骼变换
     */
    resetTransform(modelId: string, boneName: string): void {
        this.boneManager.resetBoneTransform(modelId, boneName);
    }

    /**
     * 获取骨骼有效缩放
     */
    getEffectiveScale(modelId: string, boneName: string) {
        return this.boneManager.getBoneEffectiveScale(modelId, boneName);
    }

    /**
     * 设置是否传播缩放到子骨骼
     */
    setPropagateScaleToChildren(modelId: string, enabled: boolean): void {
        this.boneManager.setPropagateScaleToChildren(modelId, enabled);
    }

    /**
     * 获取是否传播缩放到子骨骼
     */
    getPropagateScaleToChildren(modelId: string): boolean {
        return this.boneManager.getPropagateScaleToChildren(modelId);
    }

    /**
     * 清除模型骨骼数据
     */
    clearModelData(modelId: string): void {
        this.boneManager.clearModelData(modelId);
    }
}

export const boneApiService = BoneApiService.getInstance();
