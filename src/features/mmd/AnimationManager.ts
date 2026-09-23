import { Scene, Mesh } from '@babylonjs/core';
import type { MmdMesh } from 'babylon-mmd/esm/Runtime/mmdMesh';
import type { MmdRuntime } from 'babylon-mmd/esm/Runtime/mmdRuntime';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { VmdLoader } from 'babylon-mmd/esm/Loader/vmdLoader';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';
import type { MultiPhysicsRuntime } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/Impl/multiPhysicsRuntime';
import type { MmdCompositeAnimation } from 'babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation';
import type { CameraManager } from './CameraManager';
import type { ModelManager } from './ModelManager';
import { ModelStateManager } from './ModelStateManager';
import { eventBus } from '../../core';
import { Events } from '../../core';
import { ModelOptStateManager } from '../state/ModelOptStateManager';
import { shadingStateManager } from '../state/ShadingStateManager';
import { BoneManager } from './BoneManager';
import { PhysicsManager } from './PhysicsManager';
import { PhysicsEngineFactory } from './PhysicsEngineFactory';
import { PhysicsEngineType } from './PhysicsEngineTypes';
import { detectVmdType, VmdType } from '../../utils/fileValidation';
import { fetchFileAsArrayBuffer } from '../../utils/platform';
import { toast } from '../../UIComponents/shared/Toast';

//动画与MMD运行时管理。物理引擎初始化已迁移到PhysicsManager，此处通过PhysicsManager获取物理运行时。

export interface AnimationInfo {
    id: string;
    name: string;
    filePath: string;
    modelId: string;
    mmdAnimation: MmdAnimation | null;
}

export class AnimationManager {
    private scene: Scene;
    private mmdRuntime: MmdRuntime | null = null;
    private vmdLoader: VmdLoader | null = null;
    private physicsRuntime: MultiPhysicsRuntime | null = null;
    private initializationPromise: Promise<void> | null = null;
    private cameraManager: CameraManager | null = null;
    private sidePanel: any | null = null; // SidePanel 引用，用于获取物理开关状态
    private modelManagerProvider: (() => ModelManager | null) | null = null; // ModelManager 提供者，用于切换物理引擎时释放场景中的 Mesh

    private animations: Map<string, AnimationInfo> = new Map();
    private mmdModels: Map<string, MmdModel> = new Map();
    private runtimeAnimations: Map<string, any> = new Map();
    private modelCompositeAnimations: Map<string, MmdCompositeAnimation> = new Map();
    /** 每个模型的运行时动画句柄（首次创建后复用，避免重复订阅 observable） */
    private modelRuntimeAnimationHandles: Map<string, any> = new Map();

    private _animationEndCheckObserver: any | null = null;
    private _onAnimationEndCallback: (() => void) | null = null;
    private _cachedMaxFrames = 0;

    /** 模型级 IK 开关（默认禁用）。key=modelId, value=true=启用IK, false=禁用IK */
    private _modelIkEnabled: Map<string, boolean> = new Map();

    /** 每个模型 morph 的 category 信息（在 metadata 被修剪前捕获）。key=modelId, value=category数组 */
    private _morphCategories: Map<string, number[]> = new Map();

    constructor(scene: Scene) {
        this.scene = scene;
        this.initializationPromise = this.initialize();
    }

    /**
     * 设置相机管理器
     * @param cameraManager 相机管理器实例
     */
    public setCameraManager(cameraManager: CameraManager): void {
        this.cameraManager = cameraManager;
    }

    /**
     * 设置 SidePanel 引用
     * @param sidePanel SidePanel 实例
     */
    public setSidePanel(sidePanel: any): void {
        this.sidePanel = sidePanel;
    }

    /**
     * 设置 ModelManager 提供者
     * 用于切换物理引擎时通过 ModelManager 释放场景中的 Mesh / AssetContainer 等渲染资源
     * @param provider ModelManager 提供函数
     */
    public setModelManagerProvider(provider: () => ModelManager | null): void {
        this.modelManagerProvider = provider;
    }

    public async waitForInitialization(): Promise<void> {
        if (this.initializationPromise) {
            await this.initializationPromise;
        }
    }

    //region Initialization

    private async initialize(): Promise<void> {
        const { SdefInjector } = await import('babylon-mmd/esm/Loader/sdefInjector');
        SdefInjector.Enabled = false;

        const { VmdLoader } = await import('babylon-mmd/esm/Loader/vmdLoader');
        const { MmdRuntime } = await import('babylon-mmd/esm/Runtime/mmdRuntime');

        await import('babylon-mmd/esm/Runtime/Animation/mmdRuntimeCameraAnimation');
        await import('babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation');
        await import('babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation');

        const physicsManager = PhysicsManager.getInstance();
        await physicsManager.waitForInitialization();
        this.physicsRuntime = physicsManager.getPhysicsRuntime();

        // 通过工厂创建物理引擎实例（支持 SPR / RezePhysics 双引擎）
        const engineFactory = PhysicsEngineFactory.getInstance();
        const mmdPhysics = await engineFactory.createPhysics(this.scene, this.physicsRuntime);

        this.mmdRuntime = new MmdRuntime(this.scene, mmdPhysics);
        this.mmdRuntime.loggingEnabled = false;
        this.mmdRuntime.register(this.scene);

        // 注册动画后偏移校正 + 模型级 IK 状态覆盖：
        // 每帧动画计算完成后重新应用用户偏移，并确保 IK 开关状态不被 _needStateReset 冲掉
        this.mmdRuntime.onAnimationTickObservable.add(() => {
            // 阶段 1：覆盖模型级 IK 开关
            for (const [modelId, mmdModel] of this.mmdModels) {
                const enabled = this._modelIkEnabled.get(modelId);
                if (enabled !== undefined) {
                    mmdModel.ikSolverStates.fill(enabled ? 1 : 0);
                }
            }

            // 阶段 2：骨骼偏移校正
            const stateManager = ModelOptStateManager.getInstance();
            const allCorrections = stateManager.getAllBoneCorrections();
            if (allCorrections.length === 0) return;
            const boneManager = BoneManager.getInstance();
            for (const { modelId, boneName, offsets } of allCorrections) {
                boneManager.applyBoneRotationOffsetsSync(modelId, boneName, offsets, true);
            }
        });

        this.vmdLoader = new VmdLoader(this.scene);
        this.vmdLoader.loggingEnabled = false;

        await this.mmdRuntime.playAnimation();
    }

    //endregion

    //region Physics Engine Switching

    /**
     * 切换物理引擎
     * 清空所有状态并重新初始化，不保留任何模型/动画数据
     * @param type 目标物理引擎类型
     */
    public async switchPhysicsEngine(type: PhysicsEngineType): Promise<void> {
        // 1. 完全清空场景：
        //    - 通过 ModelManager 释放场景中的 Mesh / AssetContainer / 纹理 / 阴影等渲染资源（否则 Mesh 会残留在场景中）
        //    - 清空 UI 与全局状态（模型列表、动作列表、材质状态、骨骼状态等），避免界面残留
        const modelIds = new Set<string>([
            ...Array.from(this.mmdModels.keys()),
            ...ModelStateManager.getInstance().getModels().map(m => m.id)
        ]);
        const modelManager = this.modelManagerProvider ? this.modelManagerProvider() : null;
        if (modelManager) {
            await modelManager.clearAllModels();
        }
        this.clearSceneState(modelIds);

        // 2. 完全清空当前状态（此时 mmdModels 已为空，dispose 仅负责运行时清理）
        await this.dispose();

        // 3. 重置 PhysicsManager（销毁旧的 WASM 运行时或 RezePhysics 状态）
        PhysicsManager.resetInstance();

        // 4. 更新引擎类型
        PhysicsEngineFactory.getInstance().setType(type);

        // 5. 创建新的 PhysicsManager（根据新引擎类型初始化）
        const physicsManager = PhysicsManager.getInstance(this.scene);
        await physicsManager.waitForInitialization();
        this.physicsRuntime = physicsManager.getPhysicsRuntime();

        // 6. 重新初始化 MmdRuntime
        const { SdefInjector } = await import('babylon-mmd/esm/Loader/sdefInjector');
        SdefInjector.Enabled = false;

        const { VmdLoader } = await import('babylon-mmd/esm/Loader/vmdLoader');
        const { MmdRuntime } = await import('babylon-mmd/esm/Runtime/mmdRuntime');

        await import('babylon-mmd/esm/Runtime/Animation/mmdRuntimeCameraAnimation');
        await import('babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation');
        await import('babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation');

        const engineFactory = PhysicsEngineFactory.getInstance();
        const mmdPhysics = await engineFactory.createPhysics(this.scene, this.physicsRuntime);

        this.mmdRuntime = new MmdRuntime(this.scene, mmdPhysics);
        this.mmdRuntime.loggingEnabled = false;
        this.mmdRuntime.register(this.scene);

        // 重新注册动画后偏移校正 + IK 覆盖
        this.mmdRuntime.onAnimationTickObservable.add(() => {
            for (const [modelId, mmdModel] of this.mmdModels) {
                const enabled = this._modelIkEnabled.get(modelId);
                if (enabled !== undefined) {
                    mmdModel.ikSolverStates.fill(enabled ? 1 : 0);
                }
            }
            const allC = ModelOptStateManager.getInstance().getAllBoneCorrections();
            if (allC.length === 0) return;
            const boneManager = BoneManager.getInstance();
            for (const { modelId, boneName, offsets } of allC) {
                boneManager.applyBoneRotationOffsetsSync(modelId, boneName, offsets, true);
            }
        });

        this.vmdLoader = new VmdLoader(this.scene);
        this.vmdLoader.loggingEnabled = false;

        // 7. 重置初始化 promise 并开始播放
        this.initializationPromise = Promise.resolve();
        await this.mmdRuntime.playAnimation();

        console.log(`物理引擎已切换为: ${type}`);
    }

    /**
     * 清空 UI 与全局状态管理器中的场景数据
     * （模型列表、动作列表、材质状态、骨骼/表情/可见性状态、骨骼校正与绑定、选中状态）
     * @param modelIds 需要清理的模型 ID 集合
     */
    private clearSceneState(modelIds: Set<string>): void {
        // 清空 UI 模型/动作列表（clearState 同时清除每个模型下的动作数据）
        ModelStateManager.getInstance().clearState();

        // 清空各模型相关的全局状态
        const modelOpt = ModelOptStateManager.getInstance();
        for (const modelId of modelIds) {
            shadingStateManager.removeModel(modelId);
            modelOpt.removeModelMorphs(modelId);
            modelOpt.removeModelBones(modelId);
            modelOpt.removeModelEnabledState(modelId);
            modelOpt.removeModelBoneCorrections(modelId);
            modelOpt.removeModelBoneParentingBindings(modelId);
        }
        modelOpt.selectModel(null);
    }

    //endregion

    //region MMD Model Management

    private extractMorphCategories(mesh: Mesh): number[] | undefined {
        const metadata = (mesh as any).metadata;
        if (!metadata || !metadata.morphs || !Array.isArray(metadata.morphs)) return undefined;

        const categories: number[] = [];
        for (const morphMeta of metadata.morphs) {
            const cat = (morphMeta as any).category;
            categories.push(typeof cat === 'number' ? cat : 4);
        }
        return categories.length > 0 ? categories : undefined;
    }

    public async createMmdModel(modelId: string, mmdMesh: MmdMesh): Promise<MmdModel> {
        await this.waitForInitialization();

        if (!this.mmdRuntime) {
            throw new Error('动画管理器初始化失败');
        }

        let mmdModel = this.mmdModels.get(modelId);
        if (!mmdModel) {
            const mesh = mmdMesh as Mesh;
            const { MmdStandardMaterialProxy } = await import('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy');

            // 在 createMmdModel 修剪 metadata 前，捕获 morph 的 category 信息
            const morphCategories = this.extractMorphCategories(mesh);
            if (morphCategories) {
                this._morphCategories.set(modelId, morphCategories);
            }

            const buildPhysics: Record<string, any> = {
                disableOffsetForConstraintFrame: true
            };
            // 共享物理世界：所有模型使用 worldId=0（可互相碰撞）；独立物理世界：不指定 worldId（自动递增，互相隔离）
            if (this.sidePanel?.isSharedPhysicsWorldEnabled()) {
                buildPhysics.worldId = 0;
            }

            mmdModel = this.mmdRuntime.createMmdModel(mesh, {
                materialProxyConstructor: MmdStandardMaterialProxy,
                buildPhysics
            });
            this.mmdModels.set(modelId, mmdModel);

            // 默认启用 IK（模型级别）
            this._modelIkEnabled.set(modelId, true);
            mmdModel.ikSolverStates.fill(1);

            // 检查物理开关状态，如果关闭则立即禁用物理
            if (this.sidePanel && !this.sidePanel.isPhysicsEnabled()) {
                console.log(`物理开关已关闭，禁用模型 ${modelId} 的物理`);
                mmdModel.rigidBodyStates.fill(0);
                if (this.physicsRuntime && 'commitBodyStates' in this.physicsRuntime) {
                    (this.physicsRuntime as any).commitBodyStates(mmdModel.rigidBodyStates);
                }
            }
        }

        return mmdModel;
    }

    public destroyMmdModel(modelId: string): void {
        const mmdModel = this.mmdModels.get(modelId);
        if (!mmdModel || !this.mmdRuntime) {
            return;
        }

        // 1. 先解绑运行时动画，避免销毁过程中动画系统仍在写入骨骼
        mmdModel.setRuntimeAnimation(null);

        // 2. 将所有刚体标记为 Kinematic，防止销毁过程中物理引擎继续驱动
        this.clearAllRigidBodies(mmdModel);

        // 3. 复位 morph 权重（必须在 mmdRuntime.destroyMmdModel 之前，否则对象已失效）
        this.resetAllMorphWeights(mmdModel);

        // 4. 释放物理 / WASM 资源（在清理 JS 端引用之前完成，确保不再有外部访问）
        this.mmdRuntime.destroyMmdModel(mmdModel);

        // 5. 清理动画记录
        for (const [animId, animInfo] of this.animations.entries()) {
            if (animInfo.modelId === modelId) {
                this.animations.delete(animId);
                this.runtimeAnimations.delete(animId);
            }
        }

        // 6. 清理复合动画与 span
        const compositeAnimation = this.modelCompositeAnimations.get(modelId);
        if (compositeAnimation) {
            while (compositeAnimation.spans.length > 0) {
                compositeAnimation.removeSpanFromIndex(0);
            }
            this.modelCompositeAnimations.delete(modelId);
        }
        this.modelRuntimeAnimationHandles.delete(modelId);

        // 7. 清理 IK 状态记录
        this._modelIkEnabled.delete(modelId);

        // 8. 清理 morph 分类记录
        this._morphCategories.delete(modelId);

        this.mmdModels.delete(modelId);
    }

    private resetAllMorphWeights(mmdModel: MmdModel): void {
        const morphCount = mmdModel.morph.morphs.length;
        for (let i = 0; i < morphCount; i++) {
            mmdModel.morph.setMorphWeightFromIndex(i, 0);
        }
    }

    private clearAllRigidBodies(mmdModel: MmdModel): void {
        if (mmdModel.rigidBodyStates.length > 0) {
            mmdModel.rigidBodyStates.fill(0);
            const physicsRuntime = this.physicsRuntime;
            if (physicsRuntime && 'commitBodyStates' in physicsRuntime) {
                (physicsRuntime as any).commitBodyStates(mmdModel.rigidBodyStates);
            }
        }
    }

    public getMorphCategories(modelId: string): number[] | undefined {
        return this._morphCategories.get(modelId);
    }

    public hasMmdModel(modelId: string): boolean {
        return this.mmdModels.has(modelId);
    }

    public getMmdModel(modelId: string): MmdModel | undefined {
        return this.mmdModels.get(modelId);
    }

    /**
     * 获取所有 MmdModel 实例及其模型 ID
     * 用于需要对所有加载模型执行批量操作的场景（如快捷操作面板）
     * @returns [modelId, MmdModel] 迭代器（避免每次创建新数组）
     */
    public getAllMmdModelEntries(): IterableIterator<[string, MmdModel]> {
        return this.mmdModels.entries();
    }

    //endregion

    //region Animation Loading & Binding

    public async loadAnimation(
        filePath: string,
        fileName: string,
        modelId: string,
        mmdMesh: MmdMesh,
        appendMode: 'blend' | 'append' = 'blend'
    ): Promise<AnimationInfo> {
        await this.waitForInitialization();

        if (!this.vmdLoader || !this.mmdRuntime) {
            throw new Error('动画管理器初始化失败');
        }

        if (!this.isValidVmdFile(fileName)) {
            throw new Error(`不支持的文件格式: ${fileName}。仅支持VMD格式。`);
        }

        const animationId = this.generateAnimationId();
        const animationInfo: AnimationInfo = {
            id: animationId,
            name: fileName,
            filePath,
            modelId,
            mmdAnimation: null
        };

        const buffer = await fetchFileAsArrayBuffer(filePath);

        const vmdType = detectVmdType(buffer);
        if (vmdType === VmdType.Camera) {
            throw new Error('所选文件为镜头动画，请使用「镜头导入」功能');
        }

        const mmdAnimation = await this.vmdLoader.loadFromBufferAsync(
            `animation_${animationId}`,
            buffer
        );

        animationInfo.mmdAnimation = mmdAnimation;

        // 检测 VMD 是否包含 IK 控制信息（无 ikBoneNames = 动捕类 VMD，无需 IK）
        const hasIkControl = mmdAnimation.propertyTrack.ikBoneNames.length > 0;

        let mmdModel = this.mmdModels.get(modelId);
        if (!mmdModel) {
            const mesh = mmdMesh as Mesh;
            const { MmdStandardMaterialProxy } = await import('babylon-mmd/esm/Runtime/mmdStandardMaterialProxy');

            // 在 createMmdModel 修剪 metadata 前，捕获 morph 的 category 信息
            if (!this._morphCategories.has(modelId)) {
                const morphCategories = this.extractMorphCategories(mesh);
                if (morphCategories) {
                    this._morphCategories.set(modelId, morphCategories);
                }
            }

            const buildPhysics: Record<string, any> = {
                disableOffsetForConstraintFrame: true
            };
            if (this.sidePanel?.isSharedPhysicsWorldEnabled()) {
                buildPhysics.worldId = 0;
            }

            mmdModel = this.mmdRuntime.createMmdModel(mesh, {
                materialProxyConstructor: MmdStandardMaterialProxy,
                buildPhysics
            });
            this.mmdModels.set(modelId, mmdModel);

            // 默认启用 IK（模型级别）
            this._modelIkEnabled.set(modelId, true);
            mmdModel.ikSolverStates.fill(1);

            // 检查物理开关状态，如果关闭则立即禁用物理
            if (this.sidePanel && !this.sidePanel.isPhysicsEnabled()) {
                console.log(`物理开关已关闭，禁用模型 ${modelId} 的物理`);
                mmdModel.rigidBodyStates.fill(0);
                if (this.physicsRuntime && 'commitBodyStates' in this.physicsRuntime) {
                    (this.physicsRuntime as any).commitBodyStates(mmdModel.rigidBodyStates);
                }
            }
        }

        // 根据 VMD 检测结果自动覆写 IK 状态
        if (!hasIkControl) {
            this._modelIkEnabled.set(modelId, false);
            mmdModel.ikSolverStates.fill(0);
            toast.show('已自动禁用IK，如有问题请到「模型」页面开启', 'info', 4000);
        }

        let compositeAnimation = this.modelCompositeAnimations.get(modelId);
        if (!compositeAnimation) {
            const { MmdCompositeAnimation } = await import('babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation');
            compositeAnimation = new MmdCompositeAnimation(`composite_${modelId}`);
            this.modelCompositeAnimations.set(modelId, compositeAnimation);
        }

        const { MmdAnimationSpan } = await import('babylon-mmd/esm/Runtime/Animation/mmdCompositeAnimation');

        // 计算新动画的 offset：混合模式 offset=0，向后追加模式 offset=已有动画末尾帧
        const spanOffset = appendMode === 'append' && compositeAnimation.spans.length > 0
            ? compositeAnimation.endFrame
            : 0;

        const animationSpan = new MmdAnimationSpan(
            mmdAnimation,
            undefined,
            undefined,
            spanOffset,
            1
        );

        compositeAnimation.addSpan(animationSpan);

        // 首次加载：创建 runtimeAnimationHandle 并设置到模型
        // 后续加载：只 addSpan（onSpanAdded 回调自动添加 runtimeAnimation），手动通知时长变更
        const isFirstAnimation = !this.modelRuntimeAnimationHandles.has(modelId);
        if (isFirstAnimation) {
            const runtimeAnimationHandle = mmdModel.createRuntimeAnimation(compositeAnimation);
            mmdModel.setRuntimeAnimation(runtimeAnimationHandle);
            this.modelRuntimeAnimationHandles.set(modelId, runtimeAnimationHandle);
            this.runtimeAnimations.set(animationId, runtimeAnimationHandle);
        } else {
            // addSpan 已通过 onSpanAdded 回调自动添加了 runtimeAnimation
            // 但 setRuntimeAnimation 的 endFrame 比较逻辑无法检测到同对象的 endFrame 变化
            // 需要手动通知 MmdRuntime 动画时长变更
            (mmdModel as any).onAnimationDurationChangedObservable.notifyObservers(compositeAnimation.endFrame);
            const existingHandle = this.modelRuntimeAnimationHandles.get(modelId);
            this.runtimeAnimations.set(animationId, existingHandle);
        }

        this.animations.set(animationId, animationInfo);
        this._updateMaxFramesCache();

        await this.mmdRuntime.seekAnimation(0, true);

        return animationInfo;
    }

    //endregion

    //region Animation Playback Control

    public async playAnimation(): Promise<void> {
        await this.waitForInitialization();
        if (!this.mmdRuntime) return;

        if (!this.mmdRuntime.isAnimationPlaying) {
            await this.mmdRuntime.playAnimation();
            this.cameraManager?.startAnimation();
            this._startAnimationEndCheck();
        }
    }

    public async pauseAnimation(): Promise<void> {
        await this.waitForInitialization();
        if (!this.mmdRuntime) return;

        if (this.mmdRuntime.isAnimationPlaying) {
            await this.mmdRuntime.pauseAnimation();
            this._stopAnimationEndCheck();
            this.cameraManager?.pauseAnimation();
        }
    }

    public async stopAnimation(): Promise<void> {
        await this.waitForInitialization();
        if (!this.mmdRuntime) return;

        if (this.mmdRuntime.isAnimationPlaying) {
            await this.mmdRuntime.pauseAnimation();
        }

        this._stopAnimationEndCheck();
        await this.mmdRuntime.seekAnimation(0, true);
        this.cameraManager?.stopAnimation();
    }

    public isAnimationPlaying(): boolean {
        return this.mmdRuntime?.isAnimationPlaying ?? false;
    }

    /**
     * 获取当前动画帧数
     */
    public getCurrentAnimationTime(): number {
        return this.mmdRuntime?.currentFrameTime ?? 0;
    }

    /**
     * 跳转到指定帧
     * @param frameTime 帧数（不是秒数）
     */
    public async seekAnimation(frameTime: number): Promise<void> {
        await this.waitForInitialization();
        if (!this.mmdRuntime) return;
        await this.mmdRuntime.seekAnimation(frameTime, true);
    }

    /**
     * 获取MMD运行时实例（用于手动控制物理步进）
     * @returns MmdRuntime 实例或 null
     */
    public getMmdRuntime(): MmdRuntime | null {
        return this.mmdRuntime;
    }

    /**
     * 获取场景实例
     */
    public getScene(): Scene {
        return this.scene;
    }

    //endregion

    //region Animation Query Methods

    public getAnimationByModelId(modelId: string): AnimationInfo | undefined {
        for (const animation of this.animations.values()) {
            if (animation.modelId === modelId) {
                return animation;
            }
        }
        return undefined;
    }

    public getAnimationsByModelId(modelId: string): AnimationInfo[] {
        const result: AnimationInfo[] = [];
        for (const animation of this.animations.values()) {
            if (animation.modelId === modelId) {
                result.push(animation);
            }
        }
        return result;
    }

    public hasAnimation(modelId: string): boolean {
        return this.getAnimationByModelId(modelId) !== undefined;
    }

    public getAnimationCount(modelId: string): number {
        return this.getAnimationsByModelId(modelId).length;
    }

    public getAllAnimations(): IterableIterator<AnimationInfo> {
        return this.animations.values();
    }

    /**
     * 获取所有动画中的最大帧数（O(1) 读取缓存值）
     * @returns 最大帧数
     */
    public getMaxAnimationFrames(): number {
        return this._cachedMaxFrames;
    }

    /**
     * 重建最大帧数缓存（仅在动画加载/卸载时调用）
     * 优先使用 compositeAnimation.endFrame（包含 offset），回退到单动画 endFrame
     */
    private _updateMaxFramesCache(): void {
        let maxFrames = 0;
        for (const [modelId] of this.mmdModels) {
            const compositeAnimation = this.modelCompositeAnimations.get(modelId);
            if (compositeAnimation && compositeAnimation.spans.length > 0) {
                const endFrame = compositeAnimation.endFrame;
                if (endFrame > maxFrames) {
                    maxFrames = endFrame;
                }
            }
        }
        // 回退：没有 compositeAnimation 的模型使用单动画 endFrame
        for (const animation of this.animations.values()) {
            if (animation.mmdAnimation) {
                const endFrame = animation.mmdAnimation.endFrame;
                if (endFrame > maxFrames) {
                    maxFrames = endFrame;
                }
            }
        }
        this._cachedMaxFrames = maxFrames;
    }

    /**
     * 检查是否存在任何动画
     * @returns 是否存在动画
     */
    public hasAnyAnimation(): boolean {
        return this.animations.size > 0;
    }

    public clearAnimations(modelId: string): void {
        const mmdModel = this.mmdModels.get(modelId);
        if (mmdModel) {
            mmdModel.setRuntimeAnimation(null);
            this.resetAllMorphWeights(mmdModel);
        }

        for (const [animId, animInfo] of this.animations.entries()) {
            if (animInfo.modelId === modelId) {
                this.animations.delete(animId);
                this.runtimeAnimations.delete(animId);
            }
        }

        const compositeAnimation = this.modelCompositeAnimations.get(modelId);
        if (compositeAnimation) {
            while (compositeAnimation.spans.length > 0) {
                compositeAnimation.removeSpanFromIndex(0);
            }
            this.modelCompositeAnimations.delete(modelId);
        }
        this.modelRuntimeAnimationHandles.delete(modelId);

        this._updateMaxFramesCache();
    }

    //endregion

    //region Utility Methods

    private isValidVmdFile(fileName: string): boolean {
        const ext = fileName.toLowerCase().split('.').pop();
        return ext === 'vmd';
    }

    private generateAnimationId(): string {
        return `anim_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    //endregion

    //region Animation End Detection

    /**
     * 设置动画结束回调
     * @param callback 动画结束时调用的回调函数
     */
    public onAnimationEnd(callback: () => void): void {
        this._onAnimationEndCallback = callback;
    }

    /**
     * 启动动画结束检测
     */
    private _startAnimationEndCheck(): void {
        if (this._animationEndCheckObserver) {
            return;
        }

        this._animationEndCheckObserver = this.scene.onBeforeRenderObservable.add(() => {
            this._checkAnimationEnd();
        });
    }

    /**
     * 停止动画结束检测
     */
    private _stopAnimationEndCheck(): void {
        if (this._animationEndCheckObserver) {
            this.scene.onBeforeRenderObservable.remove(this._animationEndCheckObserver);
            this._animationEndCheckObserver = null;
        }
    }

    /**
     * 检测动画是否结束
     * 注意：mmdRuntime 在动画时间到达 duration 时会内部自动置 _animationPaused=true，
     * 因此不能以 isAnimationPlaying 作为前置条件（手动步进/大步长时会跳过结束检测点，
     * 导致 ANIMATION_ENDED 永不触发、录制/渲染无法收尾）。
     * 统一以「当前帧 >= 最大帧 - 0.5」为准：播放中或已自然结束都视为到达末尾。
     */
    private _checkAnimationEnd(): void {
        if (!this.mmdRuntime) {
            return;
        }

        const currentFrame = this.getCurrentAnimationTime();

        // 驱动相机动画（与模型动画同步帧号）
        if (this.cameraManager && this.cameraManager.isAnimationPlaying()) {
            this.cameraManager.updateAnimation(currentFrame);
        }

        const maxFrame = this.getMaxAnimationFrames();

        if (maxFrame > 0 && currentFrame >= maxFrame - 0.5) {
            this._handleAnimationEnd();
        }
    }

    /**
     * 处理动画结束
     * mmdRuntime 可能已内部自动 pause（自然结束），此时仍须 emit ANIMATION_ENDED
     * 通知外部收尾（停止录屏/渲染），否则会挂死。
     */
    private _handleAnimationEnd(): void {
        this._stopAnimationEndCheck();

        if (this.mmdRuntime) {
            if (this.mmdRuntime.isAnimationPlaying) {
                this.mmdRuntime.pauseAnimation();
            }
            this.mmdRuntime.seekAnimation(0, true);
            this.cameraManager?.stopAnimation();
            eventBus.emit(Events.ANIMATION_ENDED);
        }
    }

    //endregion

    //region Model-Level IK Control

    /**
     * 设置模型级 IK 开关
     * @param modelId 模型 ID
     * @param enabled true=启用IK, false=禁用IK（默认）
     */
    public setModelIkEnabled(modelId: string, enabled: boolean): void {
        this._modelIkEnabled.set(modelId, enabled);
        const mmdModel = this.mmdModels.get(modelId);
        if (mmdModel) {
            mmdModel.ikSolverStates.fill(enabled ? 1 : 0);
        }
    }

    /**
     * 查询模型级 IK 开关状态
     * @param modelId 模型 ID
     * @returns IK 是否启用；如果该模型没有记录则返回 undefined
     */
    public getModelIkEnabled(modelId: string): boolean | undefined {
        return this._modelIkEnabled.get(modelId);
    }

    //endregion

    //region Resource Cleanup

    public async dispose(): Promise<void> {
        this._stopAnimationEndCheck();
        this._onAnimationEndCallback = null;

        for (const [modelId, mmdModel] of this.mmdModels.entries()) {
            try {
                if (this.mmdRuntime) {
                    this.mmdRuntime.destroyMmdModel(mmdModel);
                }
            } catch (error) {
                console.warn(`清理模型 ${modelId} 失败:`, error);
            }
        }
        this.mmdModels.clear();

        this.animations.clear();
        this.runtimeAnimations.clear();
        this.modelCompositeAnimations.clear();
        this.modelRuntimeAnimationHandles.clear();
        this._modelIkEnabled.clear();

        if (this.mmdRuntime) {
            this.mmdRuntime.unregister(this.scene);
            this.mmdRuntime = null;
        }

        this.physicsRuntime = null;
        this.vmdLoader = null;
    }

    //endregion
}
