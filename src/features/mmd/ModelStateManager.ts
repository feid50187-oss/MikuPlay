
import { eventBus, Events } from '../../core';
import type { ModelInfo } from './ModelManager';

export interface PersistedModelData {
    id: string;
    name: string;
    filePath: string;
    fileType: 'pmx' | 'pmd' | 'bpmx';
    animations?: PersistedAnimationData[];
}

export interface PersistedAnimationData {
    filePath: string;
    fileName: string;
    appendMode: 'blend' | 'append';
}

export interface ImportPanelState {
    models: PersistedModelData[];
}

export class ModelStateManager {
    private static instance: ModelStateManager;
    private currentState: ImportPanelState;
    private stateChangeCallbacks: Set<(state: ImportPanelState) => void> = new Set();

    private constructor() {
        this.currentState = this.getDefaultState();
    }

    //region Singleton

    public static getInstance(): ModelStateManager {
        if (!ModelStateManager.instance) {
            ModelStateManager.instance = new ModelStateManager();
        }
        return ModelStateManager.instance;
    }

    public static resetInstance(): void {
        ModelStateManager.instance = undefined as any;
    }

    //endregion

    //region State Access

    private getDefaultState(): ImportPanelState {
        return {
            models: []
        };
    }

    public getState(): ImportPanelState {
        return { ...this.currentState };
    }

    public clearState(): void {
        this.currentState = this.getDefaultState();
        this.notifyStateChange();
    }

    //endregion

    //region Model Operations

    public addModel(model: ModelInfo): void {
        const persistedData: PersistedModelData = {
            id: model.id,
            name: model.name,
            filePath: model.filePath,
            fileType: model.fileType
        };

        const existingIndex = this.currentState.models.findIndex(m => m.id === model.id);
        if (existingIndex >= 0) {
            this.currentState.models[existingIndex] = persistedData;
        } else {
            this.currentState.models.push(persistedData);
        }

        this.notifyStateChange();
        eventBus.emit(Events.MODEL_LOADED, persistedData);
    }

    public removeModel(modelId: string): void {
        const index = this.currentState.models.findIndex(m => m.id === modelId);
        if (index >= 0) {
            this.currentState.models.splice(index, 1);
            this.notifyStateChange();
            eventBus.emit(Events.MODEL_REMOVED, { modelId });
        }
    }

    public getModels(): ReadonlyArray<PersistedModelData> {
        return this.currentState.models;
    }

    //endregion

    //region Animation Operations

    public addAnimation(modelId: string, animation: PersistedAnimationData): void {
        const model = this.currentState.models.find(m => m.id === modelId);
        if (model) {
            if (!model.animations) {
                model.animations = [];
            }
            model.animations.push(animation);
            this.notifyStateChange();
            eventBus.emit(Events.ANIMATION_LOADED, { modelId, animation });
        }
    }

    public removeAnimation(modelId: string, fileName?: string): void {
        const model = this.currentState.models.find(m => m.id === modelId);
        if (model && model.animations) {
            if (fileName) {
                model.animations = model.animations.filter(a => a.fileName !== fileName);
            } else {
                // 使用undefined替代delete，保持对象隐藏类稳定
                model.animations = undefined;
            }
            this.notifyStateChange();
            // fileName 为 undefined 表示清空该模型全部动画
            eventBus.emit(Events.ANIMATION_REMOVED, { modelId, fileName });
        }
    }

    public getAnimations(modelId: string): ReadonlyArray<PersistedAnimationData> {
        const model = this.currentState.models.find(m => m.id === modelId);
        return model?.animations ?? [];
    }

    /**
     * @deprecated 请使用 getAnimations
     */
    public getAnimation(modelId: string): PersistedAnimationData | undefined {
        const model = this.currentState.models.find(m => m.id === modelId);
        return model?.animations?.[0];
    }

    public hasAnimations(modelId: string): boolean {
        const model = this.currentState.models.find(m => m.id === modelId);
        return !!model?.animations && model.animations.length > 0;
    }

    //endregion

    //region State Change Callbacks

    public onStateChange(callback: (state: ImportPanelState) => void): void {
        this.stateChangeCallbacks.add(callback);
    }

    public offStateChange(callback: (state: ImportPanelState) => void): void {
        this.stateChangeCallbacks.delete(callback);
    }

    private notifyStateChange(): void {
        const state = this.getState();
        this.stateChangeCallbacks.forEach(callback => {
            try {
                callback(state);
            } catch (error) {
                console.error('状态变更回调执行失败:', error);
            }
        });
    }

    //endregion
}
