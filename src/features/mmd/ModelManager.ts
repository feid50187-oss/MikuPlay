
import { Scene, LoadAssetContainerAsync, AbstractMesh, Mesh, AssetContainer, FileToolsOptions } from '@babylonjs/core';
import { Capacitor } from '@capacitor/core';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import { MmdStandardMaterial } from 'babylon-mmd/esm/Loader/mmdStandardMaterial';
import { MmdPluginMaterialSphereTextureBlendMode } from 'babylon-mmd/esm/Loader/mmdPluginMaterial';
import { DownsampleMaterialBuilder } from './downsampleMaterialBuilder';
import { BoneManager } from './BoneManager';
import { disposeMmdModelResources } from './disposeUtils';
import { shadingStateManager } from '../state';
import { SceneManager } from '../scene/SceneManager';
import type { AnimationManager } from './AnimationManager';

export interface ModelInfo {
    id: string;
    name: string;
    filePath: string;
    fileType: 'pmx' | 'pmd' | 'bpmx';
    mesh: AbstractMesh | null;
    container: AssetContainer | null;
}

interface ModelLoadOptions {
    loggingEnabled?: boolean;
}

export class ModelManager {
    private scene: Scene;
    private materialBuilder: any | null = null;
    private downsampleMaterialBuilder: DownsampleMaterialBuilder | null = null;
    private enableTextureDownsample: boolean = false;
    private animationManagerProvider: (() => AnimationManager | null) | null = null;

    private models: Map<string, ModelInfo> = new Map();
    private loadQueue: Array<{ modelInfo: ModelInfo; resolve: (value: ModelInfo) => void; reject: (reason: Error) => void }> = [];
    private isLoading: boolean = false;

    /** 物理后付与计算开关全局状态，用于在模型加载时保持用户设置 */
    private _postPhysicsAppendEnabled: boolean = false;

    /** 模型新增/删除回调列表 */
    private modelChangedCallbacks: Array<(model: ModelInfo, added: boolean) => void> = [];

    constructor(scene: Scene) {
        this.scene = scene;
    }

    /**
     * 订阅模型新增/删除事件
     * @param callback 回调，参数为变化的模型与是否新增
     * @returns 取消订阅函数
     */
    public onModelChanged(callback: (model: ModelInfo, added: boolean) => void): () => void {
        this.modelChangedCallbacks.push(callback);
        return () => {
            const index = this.modelChangedCallbacks.indexOf(callback);
            if (index >= 0) {
                this.modelChangedCallbacks.splice(index, 1);
            }
        };
    }

    private notifyModelChanged(model: ModelInfo, added: boolean): void {
        for (const callback of this.modelChangedCallbacks) {
            try {
                callback(model, added);
            } catch (error) {
                console.warn('模型变更回调执行失败:', error);
            }
        }
    }

    public setAnimationManagerProvider(provider: () => AnimationManager | null): void {
        this.animationManagerProvider = provider;
    }

    private getAnimationManager(): AnimationManager | null {
        return this.animationManagerProvider ? this.animationManagerProvider() : null;
    }

    public setTextureDownsampleEnabled(enabled: boolean): void {
        this.enableTextureDownsample = enabled;
    }

    public isTextureDownsampleEnabled(): boolean {
        return this.enableTextureDownsample;
    }

    //region Material Builder

    private async initializeMaterialBuilder(): Promise<void> {
        if (this.materialBuilder) {
            return;
        }

        const { MmdStandardMaterialBuilder } = await import('babylon-mmd/esm/Loader/mmdStandardMaterialBuilder');
        await import('babylon-mmd/esm/Loader/mmdOutlineRenderer');
        this.materialBuilder = new MmdStandardMaterialBuilder();
    }

    private async initializeDownsampleMaterialBuilder(): Promise<void> {
        if (this.downsampleMaterialBuilder) {
            return;
        }

        this.downsampleMaterialBuilder = new DownsampleMaterialBuilder();
    }

    //endregion

    //region Model Loading

    public async loadModel(filePath: string, fileName: string, options: ModelLoadOptions = {}): Promise<ModelInfo> {
        const fileType = this.getFileType(fileName);

        if (!fileType) {
            throw new Error(`不支持的文件格式: ${fileName}。仅支持PMX、PMD和BPMX格式。`);
        }

        const modelId = this.generateModelId();
        const modelInfo: ModelInfo = {
            id: modelId,
            name: fileName,
            filePath,
            fileType,
            mesh: null,
            container: null
        };

        return new Promise((resolve, reject) => {
            this.loadQueue.push({ modelInfo, resolve, reject });
            this.processLoadQueue();
        });
    }

    private async processLoadQueue(): Promise<void> {
        if (this.isLoading || this.loadQueue.length === 0) {
            return;
        }

        this.isLoading = true;
        const { modelInfo, resolve, reject } = this.loadQueue.shift()!;

        try {
            const loadedModel = await this.loadModelInternal(modelInfo);
            this.models.set(loadedModel.id, loadedModel);
            
            // 应用全局设置到新加载的模型
            this.applyGlobalSettingsToModel(loadedModel.id);

            this.notifyModelChanged(loadedModel, true);
            resolve(loadedModel);
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
            this.isLoading = false;
            setTimeout(() => this.processLoadQueue(), 0);
        }
    }

    private async loadModelInternal(modelInfo: ModelInfo): Promise<ModelInfo> {
        await this.importLoader(modelInfo.fileType);

        if (this.enableTextureDownsample) {
            await this.initializeDownsampleMaterialBuilder();
        } else {
            await this.initializeMaterialBuilder();
        }

        const fileUrl = this.convertFilePathToUrl(modelInfo.filePath);

        await this.yieldToMainThread();

        // 禁用文件加载重试策略，避免纹理加载失败时长时间等待
        const originalRetryStrategy = FileToolsOptions.DefaultRetryStrategy;
        FileToolsOptions.DefaultRetryStrategy = () => -1;

        try {
            const container = await LoadAssetContainerAsync(
                fileUrl,
                this.scene,
                {
                    pluginOptions: {
                        mmdmodel: {
                            loggingEnabled: true,
                            materialBuilder: this.enableTextureDownsample
                                ? this.downsampleMaterialBuilder!
                                : this.materialBuilder!
                        }
                    },
                    pluginExtension: `.${modelInfo.fileType}`
                }
            );

            await this.yieldToMainThread();

            container.addAllToScene();

            const rootNode = container.rootNodes[0] as AbstractMesh;
            if (!rootNode) {
                throw new Error('模型加载失败：无法获取根节点');
            }

            modelInfo.mesh = rootNode;
            modelInfo.container = container;
            rootNode.name = `mmd_model_${modelInfo.id}`;

            this.saveAndDisableMaterialOutlines(rootNode, modelInfo.id);
            this.setupModelShadows(rootNode);

            return modelInfo;
        } finally {
            // 恢复原始重试策略
            FileToolsOptions.DefaultRetryStrategy = originalRetryStrategy;
        }
    }

    //endregion

    //region Model Query Methods

    public getAllModels(): ModelInfo[] {
        return Array.from(this.models.values());
    }

    public getModel(modelId: string): ModelInfo | undefined {
        return this.models.get(modelId);
    }

    public hasModel(modelId: string): boolean {
        return this.models.has(modelId);
    }

    /**
     * 获取指定模型的 MmdModel 运行时实例（用于访问骨骼等运行时数据）
     */
    public getMmdModel(modelId: string): MmdModel | undefined {
        return this.getAnimationManager()?.getMmdModel(modelId);
    }

    /**
     * 批量设置所有模型的物理后付与计算开关
     *
     * 对应 babylon-mmd 的 `MmdModel.enablePostPhysicsAppendTransform` 字段，
     * 用于调试/对比物理后付与对胸部、足部等部位摆动的影响。运行时切换安全。
     */
    public setPostPhysicsAppendTransformEnabled(enabled: boolean): number {
        // 更新全局状态，确保新模型加载时能保持此设置
        this._postPhysicsAppendEnabled = enabled;

        const animationManager = this.getAnimationManager();
        if (!animationManager) return 0; // 返回 0 表示没有模型被修改（因为还没加载）
        let count = 0;
        for (const [, mmdModel] of animationManager.getAllMmdModelEntries()) {
            mmdModel.enablePostPhysicsAppendTransform = enabled;
            ++count;
        }
        return count;
    }

    /**
     * 查询当前物理后付与计算开关状态
     *
     * 返回全局状态，而非依赖当前加载的模型。
     */
    public getPostPhysicsAppendTransformEnabled(): boolean {
        return this._postPhysicsAppendEnabled;
    }

    /**
     * 将全局设置应用到指定模型（用于模型加载后同步状态）
     */
    private applyGlobalSettingsToModel(modelId: string): void {
        const mmdModel = this.getMmdModel(modelId);
        if (mmdModel) {
            mmdModel.enablePostPhysicsAppendTransform = this._postPhysicsAppendEnabled;
        }
    }

    private saveAndDisableMaterialOutlines(rootNode: AbstractMesh, modelId: string): void {
        const materials = (rootNode as any).metadata?.materials;
        if (!materials) return;

        for (let i = 0; i < materials.length; i++) {
            const material = materials[i];
            if (material instanceof MmdStandardMaterial) {
                const existingProps = shadingStateManager.getOriginalOutlineProperties(modelId, i);
                if (!existingProps) {
                    shadingStateManager.setOriginalOutlineProperties(
                        modelId,
                        i,
                        material.renderOutline ? material.outlineWidth : 0,
                        { r: material.outlineColor.r, g: material.outlineColor.g, b: material.outlineColor.b },
                        material.outlineAlpha,
                        material.renderOutline
                    );
                    // 用实际的材质参数初始化状态，避免全部默认成 alphaBlend
                    shadingStateManager.setMaterialStateNew(modelId, i, {
                        adapterTypeId: 'mmd-standard',
                        params: this.readMmdMaterialParams(material),
                        isVisible: true
                    });
                }
                material.renderOutline = false;
            }
        }
    }

    /** 从 MmdStandardMaterial 读取实际材质参数（与 MmdStandardMaterialAdapter.readState 逻辑保持一致） */
    private readMmdMaterialParams(material: MmdStandardMaterial): Record<string, any> {
        let spaMode = 'off';
        if (material.sphereTexture !== null) {
            if (material.sphereTextureBlendMode === MmdPluginMaterialSphereTextureBlendMode.Multiply) {
                spaMode = 'multiply';
            } else if (material.sphereTextureBlendMode === MmdPluginMaterialSphereTextureBlendMode.Add) {
                spaMode = 'add';
            } else if (material.sphereTextureBlendMode === MmdPluginMaterialSphereTextureBlendMode.SubTexture) {
                spaMode = 'subTexture';
            }
        }

        let alphaBlendMode = 'opaque';
        if (material.transparencyMode === 1) { // MATERIAL_ALPHATEST
            alphaBlendMode = 'alphaTest';
        } else if (material.transparencyMode === 2) { // MATERIAL_ALPHABLEND
            alphaBlendMode = 'alphaBlend';
        } else if (material.transparencyMode === 3) { // MATERIAL_ALPHATESTANDBLEND
            alphaBlendMode = 'alphaTestAndBlend';
        }

        let cullMode = 'back';
        if (!material.backFaceCulling) {
            cullMode = 'doubleSided';
        } else if (material.sideOrientation === 1) { // ClockWiseSideOrientation
            cullMode = 'front';
        }

        // 反转 specularPower → shininess 映射
        const specularPower = material.specularPower ?? 63;
        let shininess: number;
        if (specularPower >= 10) {
            shininess = (100 - specularPower) / 90 * 50;
        } else {
            shininess = 50 + (10 - specularPower) / 9.9 * 50;
        }
        shininess = Math.max(0, Math.min(100, Math.round(shininess)));

        return {
            diffuse: { r: material.diffuseColor.r, g: material.diffuseColor.g, b: material.diffuseColor.b },
            ambient: { r: material.ambientColor.r, g: material.ambientColor.g, b: material.ambientColor.b },
            specular: { r: material.specularColor.r, g: material.specularColor.g, b: material.specularColor.b },
            emissive: { r: material.emissiveColor.r, g: material.emissiveColor.g, b: material.emissiveColor.b },
            emissiveIntensity: 1,
            shininess,
            alpha: material.alpha ?? 1,
            alphaBlendMode,
            cullMode,
            spaMode,
            useToonShadow: material.useToonShadow ? 'ToonShadow' : 'off',
            toonShadowSampleThreshold: material.toonShadowParams?.r ?? 0.05,
            toonShadowBlendThreshold: material.toonShadowParams?.g ?? 0.240
        };
    }

    /**
     * 设置模型阴影
     * @param rootNode 模型根节点
     */
    private setupModelShadows(rootNode: AbstractMesh): void {
        // 使用 SceneManager.getLightManager 获取 lightManager
        const lightManager = SceneManager.getLightManager(this.scene);
        const shadowGenerator = lightManager?.getShadowGenerator();

        if (!shadowGenerator) return;

        const childMeshes = rootNode.getChildMeshes();
        const allMeshes = [rootNode, ...childMeshes];

        for (const mesh of allMeshes) {
            // 模型投射阴影 - 通过 lightManager 统一管理
            if (lightManager?.addShadowCaster) {
                lightManager.addShadowCaster(mesh);
            } else {
                shadowGenerator.addShadowCaster(mesh);
            }
            // 模型接收阴影（自阴影）- 通过 lightManager 统一管理
            if (lightManager?.registerShadowReceiver) {
                lightManager.registerShadowReceiver(mesh);
            } else {
                mesh.receiveShadows = true;
            }
        }
    }

    //endregion

    //region Model Visibility

    /**
     * 设置模型可见性
     * @param modelId 模型ID
     * @param visible 是否可见
     * @returns 是否设置成功
     */
    public setModelVisible(modelId: string, visible: boolean): boolean {
        const model = this.models.get(modelId);
        if (!model || !model.mesh) {
            return false;
        }

        model.mesh.setEnabled(visible);
        return true;
    }

    /**
     * 获取模型可见性
     * @param modelId 模型ID
     * @returns 是否可见，如果模型不存在返回false
     */
    public isModelVisible(modelId: string): boolean {
        const model = this.models.get(modelId);
        if (!model || !model.mesh) {
            return false;
        }

        return model.mesh.isEnabled();
    }

    //endregion

    //region Model Deletion & Resource Management

    public async deleteModel(modelId: string): Promise<boolean> {
        const model = this.models.get(modelId);
        if (!model) {
            return false;
        }

        const animationManager = this.getAnimationManager();
        if (animationManager) {
            await disposeMmdModelResources({
                modelId,
                mesh: model.mesh,
                container: model.container,
                animationManager,
                lightManager: SceneManager.getLightManager(this.scene),
            });
        } else {
            // 降级路径：无 AnimationManager 时仅释放渲染资源
            await this.disposeModelResources(model);
        }

        this.models.delete(modelId);
        this.notifyModelChanged(model, false);
        return true;
    }

    /**
     * 清空所有模型
     * 通过 deleteModel 逐个释放场景中的 Mesh / AssetContainer / 纹理 / 阴影等渲染资源，并清空模型记录
     * 用于物理引擎切换等需要完全清空场景的场景
     */
    public async clearAllModels(): Promise<void> {
        const models = Array.from(this.models.values());
        for (const model of models) {
            try {
                await this.deleteModel(model.id);
            } catch (error) {
                console.warn(`清空模型 ${model.id} 失败:`, error);
            }
        }
        this.models.clear();
    }

    private async disposeModelResources(modelInfo: ModelInfo): Promise<void> {
        const mesh = modelInfo.mesh;
        const container = modelInfo.container;

        // 1. 先收集所有需要释放的纹理（必须在材质释放前完成）
        //    AssetContainer.dispose() 会释放 materials/geometries/meshes/skeletons/morphTargetManagers，
        //    但不会释放纹理（纹理可能被多个材质共享，因此不在容器内）。
        const texturesToDispose = new Set<any>();
        if (container) {
            for (const material of container.materials) {
                const mat = material as any;
                if (typeof mat.getActiveTextures === 'function') {
                    const textures = mat.getActiveTextures();
                    if (textures && Array.isArray(textures)) {
                        for (const texture of textures) {
                            if (texture) {
                                texturesToDispose.add(texture);
                            }
                        }
                    }
                }
            }
        }

        // 2. 解除阴影投射/接收关系（必须在 mesh.dispose 前，否则 ShadowGenerator 仍持有死引用）
        const lightManager = SceneManager.getLightManager(this.scene);
        if (mesh && lightManager) {
            const allMeshes: AbstractMesh[] = [mesh, ...mesh.getChildMeshes()];
            for (const m of allMeshes) {
                if (typeof lightManager.removeShadowCaster === 'function') {
                    try { lightManager.removeShadowCaster(m); } catch { /* ignore */ }
                }
                if (typeof lightManager.unregisterShadowReceiver === 'function') {
                    try { lightManager.unregisterShadowReceiver(m); } catch { /* ignore */ }
                }
            }
        }

        // 3. 释放纹理（仅释放不被场景中其他材质共享的纹理）
        //    MmdAsyncTextureLoader 的纹理缓存机制会导致同一模型多次导入时共享同一个 Texture 对象，
        //    必须检查纹理是否被其他材质引用，避免误释放共享纹理导致其他模型实例材质丢失。
        const containerMaterials = container ? new Set(container.materials) : new Set<any>();
        for (const texture of texturesToDispose) {
            const isUsedElsewhere = this.scene.materials.some((m: any) =>
                !containerMaterials.has(m) && m.getActiveTextures?.().includes(texture)
            );
            if (isUsedElsewhere) continue;
            try {
                texture.dispose();
            } catch (error) {
                console.warn('释放纹理失败:', error);
            }
        }

        // 4. 释放 AssetContainer 前，先保护被场景中其他材质共享的纹理
        if (container) {
            try {
                // 将共享纹理从 container.textures 中移除，避免 container.dispose() 释放它们
                const sharedTextures = new Set<any>();
                for (const material of container.materials) {
                    const mat = material as any;
                    if (typeof mat.getActiveTextures === 'function') {
                        for (const texture of mat.getActiveTextures()) {
                            if (!texture) continue;
                            const isUsedElsewhere = this.scene.materials.some((m: any) =>
                                !containerMaterials.has(m) && m.getActiveTextures?.().includes(texture)
                            );
                            if (isUsedElsewhere) {
                                sharedTextures.add(texture);
                            }
                        }
                    }
                }
                if (sharedTextures.size > 0) {
                    container.textures = container.textures.filter((t: any) => !sharedTextures.has(t));
                }

                container.removeAllFromScene();
                container.dispose();
            } catch (error) {
                console.warn('清理 AssetContainer 失败:', error);
            }
            modelInfo.container = null;
        }

        // 5. 清除 rootMesh.metadata（其上挂载了 bones/morphs/rigidBodies/joints 等大对象，必须显式释放）
        if (mesh) {
            try {
                mesh.metadata = null;
            } catch { /* ignore */ }
        }

        // 6. 清理 BoneManager 中缓存的骨骼原始位置与骨骼可视化 LinesMesh
        try {
            BoneManager.getInstance().clearModelData(modelInfo.id);
        } catch (error) {
            console.warn('清理 BoneManager 数据失败:', error);
        }

        modelInfo.mesh = null;

        // 让 GC 有时间回收
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    //endregion

    //region Utility Methods

    private yieldToMainThread(): Promise<void> {
        return new Promise(resolve => {
            requestAnimationFrame(() => resolve());
        });
    }

    private async importLoader(fileType: 'pmx' | 'pmd' | 'bpmx'): Promise<void> {
        if (fileType === 'pmx') {
            await import('babylon-mmd/esm/Loader/pmxLoader');
        } else if (fileType === 'pmd') {
            await import('babylon-mmd/esm/Loader/pmdLoader');
        } else {
            await import('babylon-mmd/esm/Loader/Optimized/bpmxLoader');
        }
    }

    private convertFilePathToUrl(filePath: string): string {
        return Capacitor.convertFileSrc(filePath);
    }

    private getFileType(fileName: string): 'pmx' | 'pmd' | 'bpmx' | null {
        const ext = fileName.toLowerCase().split('.').pop();
        if (ext === 'pmx') return 'pmx';
        if (ext === 'pmd') return 'pmd';
        if (ext === 'bpmx') return 'bpmx';
        return null;
    }

    private generateModelId(): string {
        return `model_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    //endregion

    //region Resource Cleanup

    public async dispose(): Promise<void> {
        this.loadQueue = [];

        // 1. 先清理运行时（AnimationManager 会释放所有 MmdModel / 物理 / 动画数据）
        const animationManager = this.getAnimationManager();
        if (animationManager) {
            await animationManager.dispose();
        }

        // 2. 再清理渲染资源
        const disposePromises: Promise<void>[] = [];
        for (const model of this.models.values()) {
            disposePromises.push(this.disposeModelResources(model));
        }
        await Promise.all(disposePromises);
        this.models.clear();

        // 3. 清理骨骼可视化与全局状态
        BoneManager.getInstance().setSkeletonVisible(false);

        // 4. 释放 builder 引用
        if (this.materialBuilder) {
            this.materialBuilder = null;
        }
        this.downsampleMaterialBuilder = null;
    }

    //endregion
}
