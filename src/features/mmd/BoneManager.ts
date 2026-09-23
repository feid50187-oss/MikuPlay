
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Space } from '@babylonjs/core/Maths/math.axis';
import type { Scene } from '@babylonjs/core/scene';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { AnimationManager } from './AnimationManager';
import { ModelOptStateManager, type AxisType, type ModelOptState } from '../state/ModelOptStateManager';
import { ModelStateManager } from './ModelStateManager';
import type { ModelManager } from './ModelManager';
import { PBRMaterial } from '@babylonjs/core';

type AnimationManagerProvider = () => AnimationManager | null;
type ModelManagerProvider = () => ModelManager | null;

export class BoneManager {
    private static instance: BoneManager;

    // 预分配临时对象，消除每帧分配（applyBoneRotationOffsetsSync）
    private static readonly _AxisX = new Vector3(1, 0, 0);
    private static readonly _AxisY = new Vector3(0, 1, 0);
    private static readonly _AxisZ = new Vector3(0, 0, 1);
    private static readonly _WorkQuat1 = new Quaternion();
    private static readonly _WorkQuat2 = new Quaternion();
    private static readonly _WorkQuat3 = new Quaternion();
    private static readonly _WorkVec1 = new Vector3();

    // 预分配临时对象，消除每帧分配（updateAllSkeletonPositions）
    private static readonly _TmpMatrixA = new Matrix();
    private static readonly _TmpMatrixB = new Matrix();
    private static readonly _TmpBonePos = new Vector3();
    private static readonly _TmpChildPos = new Vector3();
    private static readonly _TmpDir = new Vector3();
    private static readonly _TmpMid = new Vector3();
    private static readonly _TmpDirNorm = new Vector3();
    private static readonly _TmpRotQuat = new Quaternion();

    // 预分配临时对象，消除每帧分配（updateBoneParenting）
    private static readonly _ParentWorldMatrix = new Matrix();
    private static readonly _ParentPosition = new Vector3();
    private static readonly _ParentRotation = new Quaternion();
    private static readonly _ParentScale = new Vector3();
    private static readonly _ChildWorkPos = new Vector3();
    private static readonly _ChildWorkQuat = new Quaternion();
    private static readonly _ParentResultQuat = new Quaternion();

    private originalLocalPositions: Map<string, Vector3> = new Map();
    // 面板数值输入已应用旋转角度跟踪（机制A：欧拉路径改增量四元数叠加后，
    // 用该表记录各轴已应用值，以计算增量 delta = value - prev）
    private appliedRotationValues: Map<string, { x: number; y: number; z: number }> = new Map();
    private animationManagerProvider: AnimationManagerProvider | null = null;
    private modelManagerProvider: ModelManagerProvider | null = null;

    private scene: Scene | null = null;
    private skeletonMeshes: Map<string, AbstractMesh[]> = new Map();
    private skeletonUpdateObserver: any = null;
    private globalSkeletonVisible: boolean = false;

    // 骨骼名称索引 Map，将 O(n) find 降为 O(1)
    private boneNameIndex: Map<string, Map<string, IMmdRuntimeBone>> = new Map();
    //private skeletonBoneThickness: number = 0.06;

    private skeletonBoneMeshMap: Map<string, Map<string, AbstractMesh[]>> = new Map();
    private skeletonDefaultMaterials: Map<string, PBRMaterial> = new Map();
    private highlightMaterial: PBRMaterial | null = null;
    private currentlySelectedBone: { modelId: string; boneName: string } | null = null;
    private selectionUnsubscribe: (() => void) | null = null;

    // 实验性功能：跨模型骨骼父子级绑定
    public static readonly ENABLE_BONE_PARENTING = true;
    private parentingBaselineOffsets: Map<string, { position: Vector3; rotation: Quaternion }> = new Map();
    private parentingUpdateObserver: any = null;

    private constructor() {}

    public static getInstance(): BoneManager {
        if (!BoneManager.instance) {
            BoneManager.instance = new BoneManager();
        }
        return BoneManager.instance;
    }

    public static resetInstance(): void {
        BoneManager.instance = undefined as any;
    }

    public setAnimationManagerProvider(provider: AnimationManagerProvider): void {
        this.animationManagerProvider = provider;
    }

    public setModelManagerProvider(provider: ModelManagerProvider): void {
        this.modelManagerProvider = provider;
    }

    /**
     * 清理指定模型在 BoneManager 中的所有缓存数据
     * （骨骼原始位置、骨骼可视化 LinesMesh）
     * @param modelId 模型ID
     */
    public clearModelData(modelId: string): void {
        const prefix = `${modelId}:`;
        const keysToDelete: string[] = [];
        for (const key of this.originalLocalPositions.keys()) {
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.originalLocalPositions.delete(key);
        }

        this.destroySkeletonForModel(modelId);

        // 清理骨骼名称索引
        this.boneNameIndex.delete(modelId);

        if (this.skeletonMeshes.size === 0) {
            this.stopSkeletonUpdate();
        }
    }

    private getAnimationManager(): AnimationManager | null {
        if (this.animationManagerProvider) {
            return this.animationManagerProvider();
        }
        return null;
    }

    private getBoneKey(modelId: string, boneName: string): string {
        return `${modelId}:${boneName}`;
    }

    private getOriginalLocalPosition(modelId: string, boneName: string, bone: IMmdRuntimeBone): Vector3 {
        const key = this.getBoneKey(modelId, boneName);
        let original = this.originalLocalPositions.get(key);
        if (!original) {
            original = bone.linkedBone.position.clone();
            this.originalLocalPositions.set(key, original.clone());
        }
        return original;
    }

    public getBone(modelId: string, boneName: string): IMmdRuntimeBone | null {
        // 优先使用索引查找 O(1)
        const modelIndex = this.boneNameIndex.get(modelId);
        if (modelIndex) {
            const bone = modelIndex.get(boneName);
            if (bone) return bone;
        }

        const animationManager = this.getAnimationManager();
        if (!animationManager) return null;

        const mmdModel = animationManager.getMmdModel(modelId);
        if (!mmdModel) return null;

        const bone = mmdModel.runtimeBones.find(b => b.name === boneName);
        if (bone) {
            // 懒构建索引
            if (!modelIndex) {
                const newIndex = new Map<string, IMmdRuntimeBone>();
                for (const b of mmdModel.runtimeBones) {
                    newIndex.set(b.name, b);
                }
                this.boneNameIndex.set(modelId, newIndex);
            } else {
                modelIndex.set(boneName, bone);
            }
        }
        return bone || null;
    }

    public applyBoneTranslation(modelId: string, boneName: string, axis: AxisType, value: number): void {
        const bone = this.getBone(modelId, boneName);
        if (!bone) {
            return;
        }

        const linkedBone = bone.linkedBone;
        const originalPosition = this.getOriginalLocalPosition(modelId, boneName, bone);

        const boneTransform = ModelOptStateManager.getInstance().getBoneTransform(modelId, boneName);
        const worldOffset = new Vector3(
            boneTransform.translation.x,
            boneTransform.translation.y,
            boneTransform.translation.z
        );

        let localOffset = worldOffset.clone();
        if (bone.parentBone) {
            const parentWorldMatrix = new Matrix();
            bone.parentBone.getWorldMatrixToRef(parentWorldMatrix);
            const parentInverse = parentWorldMatrix.invert();
            Vector3.TransformNormalToRef(worldOffset, parentInverse, localOffset);
        }

        const newPosition = originalPosition.add(localOffset);
        linkedBone.position = newPosition;
    }

    public applyBoneRotation(modelId: string, boneName: string, axis: AxisType, value: number): void {
        const bone = this.getBone(modelId, boneName);
        if (!bone) {
            return;
        }

        // 机制A: 用已应用值计算增量 delta，走四元数增量叠加，避免 toEulerAngles
        // 在 ±90° 附近的 gimbal 奇异导致跨 90° 时方向跳变/反折。
        // 注意【不】走骨骼偏移校正(correction)系统：面板旋转是一次性姿态编辑，
        // 若注册为持久校正，AnimationManager 的播放 tick 会以 recaptureBase=true 每帧重放，
        // 相对增量逐帧累加成"持续自转"（1.4 回归 f6de112）。播放时动画会自行驱动骨骼覆盖该姿态。
        const key = this.getBoneKey(modelId, boneName);
        let applied = this.appliedRotationValues.get(key);
        if (!applied) {
            applied = { x: 0, y: 0, z: 0 };
            this.appliedRotationValues.set(key, applied);
        }
        const delta = value - applied[axis];
        applied[axis] = value;
        if (delta === 0) {
            return;
        }

        // 四元数增量直接叠加到骨骼当前局部旋转（复用 applyBoneRotationOffsetsSync 同款 temp 对象）
        const linkedBone = bone.linkedBone;
        let currentQuat = linkedBone.rotationQuaternion;
        if (!currentQuat) {
            currentQuat = Quaternion.Identity();
            linkedBone.rotationQuaternion = currentQuat;
        }
        const axisVec = axis === 'x' ? BoneManager._AxisX
            : axis === 'y' ? BoneManager._AxisY
            : BoneManager._AxisZ;
        Quaternion.RotationAxisToRef(axisVec, delta, BoneManager._WorkQuat1);
        BoneManager._WorkQuat1.multiplyToRef(currentQuat, BoneManager._WorkQuat3);
        linkedBone.setRotationQuaternion(BoneManager._WorkQuat3, Space.LOCAL);
    }

    public applyBoneScale(modelId: string, boneName: string, axis: AxisType, value: number): void {
        const bone = this.getBone(modelId, boneName);
        if (!bone) return;

        const mmdModel = this.getMmdModel(modelId);
        if (!mmdModel) return;

        const boneIndex = mmdModel.runtimeBones.indexOf(bone);
        if (boneIndex === -1) return;

        const current = mmdModel.getBoneScale(boneIndex) ?? { x: 1, y: 1, z: 1 };
        switch (axis) {
            case 'x': current.x = value; break;
            case 'y': current.y = value; break;
            case 'z': current.z = value; break;
        }
        mmdModel.setBoneScale(boneIndex, current.x, current.y, current.z);
    }

    public applyBoneScaleSync(modelId: string, boneName: string, activeAxes: Set<AxisType>, value: number): void {
        const bone = this.getBone(modelId, boneName);
        if (!bone) return;

        const mmdModel = this.getMmdModel(modelId);
        if (!mmdModel) return;

        const boneIndex = mmdModel.runtimeBones.indexOf(bone);
        if (boneIndex === -1) return;

        const current = mmdModel.getBoneScale(boneIndex) ?? { x: 1, y: 1, z: 1 };
        
        activeAxes.forEach(axis => {
            switch (axis) {
                case 'x': current.x = value; break;
                case 'y': current.y = value; break;
                case 'z': current.z = value; break;
            }
        });
        
        mmdModel.setBoneScale(boneIndex, current.x, current.y, current.z);
    }

    private getMmdModel(modelId: string): MmdModel | null {
        const animationManager = this.getAnimationManager();
        if (!animationManager) return null;
        return animationManager.getMmdModel(modelId) ?? null;
    }

    public applyCurrentBoneTransform(): void {
        const selected = ModelOptStateManager.getInstance().getSelectedBone();
        if (!selected.modelId || !selected.boneName) {
            return;
        }

        const state = ModelOptStateManager.getInstance().getState();
        const { modelId, boneName } = selected;
        const mode = state.currentMode;
        const axis = state.currentAxis;

        const boneTransform = ModelOptStateManager.getInstance().getBoneTransform(modelId, boneName);

        if (mode === 'move') {
            this.applyBoneTranslation(
                modelId,
                boneName,
                axis,
                boneTransform.translation[axis]
            );
        } else if (mode === 'rotate') {
            this.applyBoneRotation(
                modelId,
                boneName,
                axis,
                boneTransform.rotation[axis]
            );
        } else {
            this.applyBoneScale(
                modelId,
                boneName,
                axis,
                boneTransform.scale[axis]
            );
        }
    }

    public restoreBoneTransform(modelId: string, boneName: string): void {
        const boneTransform = ModelOptStateManager.getInstance().getBoneTransform(modelId, boneName);
        const bone = this.getBone(modelId, boneName);
        if (!bone) {
            return;
        }

        const linkedBone = bone.linkedBone;
        const originalPosition = this.getOriginalLocalPosition(modelId, boneName, bone);

        const worldOffset = new Vector3(
            boneTransform.translation.x,
            boneTransform.translation.y,
            boneTransform.translation.z
        );

        let localOffset = worldOffset.clone();
        if (bone.parentBone) {
            const parentWorldMatrix = new Matrix();
            bone.parentBone.getWorldMatrixToRef(parentWorldMatrix);
            const parentInverse = parentWorldMatrix.invert();
            Vector3.TransformNormalToRef(worldOffset, parentInverse, localOffset);
        }

        linkedBone.position = originalPosition.add(localOffset);

        const hasRotation = boneTransform.rotation.x !== 0 || boneTransform.rotation.y !== 0 || boneTransform.rotation.z !== 0;
        if (hasRotation) {
            const rotation = Quaternion.FromEulerAngles(
                boneTransform.rotation.x,
                boneTransform.rotation.y,
                boneTransform.rotation.z
            );
            linkedBone.setRotationQuaternion(rotation, Space.LOCAL);
        }

        const mmdModel = this.getMmdModel(modelId);
        if (mmdModel) {
            const boneIndex = mmdModel.runtimeBones.indexOf(bone);
            if (boneIndex !== -1) {
                const s = boneTransform.scale;
                // 只有非默认缩放才写入，避免覆盖 MMD 运行时的层级缩放计算
                if (s.x !== 1 || s.y !== 1 || s.z !== 1) {
                    mmdModel.setBoneScale(boneIndex, s.x, s.y, s.z);
                }
            }
        }

        // 如果存在穿模校正状态，清除基线以便下次重新捕获正确的动画姿态
        const correctionState = ModelOptStateManager.getInstance().getBoneCorrectionState(modelId, boneName);
        if (correctionState) {
            correctionState.baseRotation = null;
        }
    }

    /**
     * 获取骨骼在父级缩放传递下的有效缩放值
     * 当该骨骼无显式缩放时，向上查找最近的有显式缩放的祖先骨骼
     */
    public getBoneEffectiveScale(modelId: string, boneName: string): { x: number; y: number; z: number } {
        const state = ModelOptStateManager.getInstance().getBoneTransform(modelId, boneName);
        const s = state.scale;
        if (s.x !== 1 || s.y !== 1 || s.z !== 1) {
            return s;
        }
        // 沿父级链向上查找最近的显式缩放
        const bone = this.getBone(modelId, boneName);
        if (bone) {
            let parent = bone.parentBone;
            while (parent) {
                const parentState = ModelOptStateManager.getInstance().getBoneTransform(modelId, parent.name);
                const ps = parentState.scale;
                if (ps.x !== 1 || ps.y !== 1 || ps.z !== 1) {
                    return ps;
                }
                parent = parent.parentBone;
            }
        }
        return s;
    }

    public resetBoneTransform(modelId: string, boneName: string): void {
        const bone = this.getBone(modelId, boneName);
        if (!bone) {
            return;
        }

        const key = this.getBoneKey(modelId, boneName);
        const originalPosition = this.originalLocalPositions.get(key);

        if (originalPosition) {
            bone.linkedBone.position = originalPosition.clone();
        }

        const identityQuaternion = new Quaternion(0, 0, 0, 1);
        bone.linkedBone.setRotationQuaternion(identityQuaternion, Space.LOCAL);

        // 清除面板已应用旋转跟踪
        this.appliedRotationValues.delete(key);

        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'move', 'x', 0);
        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'move', 'y', 0);
        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'move', 'z', 0);
        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'rotate', 'x', 0);
        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'rotate', 'y', 0);
        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'rotate', 'z', 0);
        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'scale', 'x', 1);
        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'scale', 'y', 1);
        ModelOptStateManager.getInstance().setBoneTransformValue(modelId, boneName, 'scale', 'z', 1);

        const mmdModel = this.getMmdModel(modelId);
        if (mmdModel) {
            const boneIndex = mmdModel.runtimeBones.indexOf(bone);
            if (boneIndex !== -1) {
                mmdModel.setBoneScale(boneIndex, 1, 1, 1);
            }
        }
    }

    public setPropagateScaleToChildren(modelId: string, enabled: boolean): void {
        const mmdModel = this.getMmdModel(modelId);
        if (mmdModel) {
            mmdModel.propagateScaleToChildren = enabled;
        }
    }

    public getPropagateScaleToChildren(modelId: string): boolean {
        const mmdModel = this.getMmdModel(modelId);
        if (mmdModel) {
            return mmdModel.propagateScaleToChildren;
        }
        return true;
    }

    // ====== 骨架骨骼高亮（与骨骼树选中联动） ======

    private getHighlightMaterial(): PBRMaterial {
        if (!this.highlightMaterial && this.scene) {
            this.highlightMaterial = new PBRMaterial('skeleton_highlight_mat', this.scene);
            this.highlightMaterial.albedoColor = new Color3(1, 0, 0);
            this.highlightMaterial.emissiveColor = new Color3(1, 0, 0);
            this.highlightMaterial.emissiveIntensity = 0.6;
            this.highlightMaterial.roughness = 0.3;
            this.highlightMaterial.specularIntensity = 2;
            this.highlightMaterial.alpha = 1;
            this.highlightMaterial.depthFunction = Constants.LEQUAL;
        }
        return this.highlightMaterial!;
    }

    private highlightBoneInSkeleton(modelId: string, boneName: string): void {
        this.clearSkeletonBoneHighlight();

        const boneMeshMap = this.skeletonBoneMeshMap.get(modelId);
        if (!boneMeshMap) return;

        const meshes = boneMeshMap.get(boneName);
        if (!meshes || meshes.length === 0) return;

        const hlMat = this.getHighlightMaterial();
        for (const mesh of meshes) {
            mesh.material = hlMat;
            mesh.enableEdgesRendering();
            mesh.edgesWidth = 3.0;
            mesh.edgesColor = new Color4(1, 1, 0, 1);
        }
        this.currentlySelectedBone = { modelId, boneName };
    }

    private clearSkeletonBoneHighlight(): void {
        if (!this.currentlySelectedBone) return;

        const { modelId, boneName } = this.currentlySelectedBone;
        const boneMeshMap = this.skeletonBoneMeshMap.get(modelId);
        if (boneMeshMap) {
            const meshes = boneMeshMap.get(boneName);
            if (meshes) {
                const defaultMat = this.skeletonDefaultMaterials.get(modelId);
                for (const mesh of meshes) {
                    mesh.disableEdgesRendering();
                    if (defaultMat) {
                        mesh.material = defaultMat;
                    }
                }
            }
        }
        this.currentlySelectedBone = null;
    }

    private onBoneSelectionChanged(state: ModelOptState): void {
        if (!this.globalSkeletonVisible) return;

        if (state.currentModelId && state.currentBoneName) {
            this.highlightBoneInSkeleton(state.currentModelId, state.currentBoneName);
        } else {
            this.clearSkeletonBoneHighlight();
        }
    }

    private startBoneSelectionSync(): void {
        if (this.selectionUnsubscribe) return;

        this.selectionUnsubscribe = ModelOptStateManager.getInstance().subscribe(
            (state) => this.onBoneSelectionChanged(state as ModelOptState)
        );

        const selected = ModelOptStateManager.getInstance().getSelectedBone();
        if (selected.modelId && selected.boneName) {
            this.highlightBoneInSkeleton(selected.modelId, selected.boneName);
        }
    }

    private stopBoneSelectionSync(): void {
        if (this.selectionUnsubscribe) {
            this.selectionUnsubscribe();
            this.selectionUnsubscribe = null;
        }
        this.clearSkeletonBoneHighlight();
    }

    public setScene(scene: Scene): void {
        this.scene = scene;
    }

    /**
     * 应用旋转偏移（四元数乘法叠加）
     * @param modelId 模型ID
     * @param boneName 骨骼名称
     * @param axis 旋转轴 ('x' | 'y' | 'z')
     * @param angleOffset 偏移角度（弧度）
     */
    public applyBoneRotationOffset(
        modelId: string,
        boneName: string,
        axis: AxisType,
        angleOffset: number
    ): void {
        const bone = this.getBone(modelId, boneName);
        if (!bone) return;

        const stateManager = ModelOptStateManager.getInstance();

        // 更新该轴偏移值，然后同步应用所有轴
        // 注意: 必须传 recaptureBase=true —— 基线每次从当前 FK 重新捕获,
        // 与 onAnimationTickObservable 的每帧应用保持一致, 避免旧基线覆盖动画导致抽搐。
        stateManager.setBoneCorrectionValue(modelId, boneName, axis, angleOffset);
        const offsets = stateManager.getBoneCorrectionOffsets(modelId, boneName);
        this.applyBoneRotationOffsetsSync(modelId, boneName, offsets, true);
    }

    /**
     * 重置骨骼旋转偏移
     * @param modelId 模型ID
     * @param boneName 骨骼名称
     */
    public resetBoneRotationOffset(modelId: string, boneName: string): void {
        const bone = this.getBone(modelId, boneName);
        if (!bone) return;

        const stateManager = ModelOptStateManager.getInstance();
        const state = stateManager.getBoneCorrectionState(modelId, boneName);

        if (state?.baseRotation) {
            // 恢复到基线旋转（动画原始值）
            bone.linkedBone.setRotationQuaternion(state.baseRotation.clone(), Space.LOCAL);
        }
        // 若基线不存在（如动画未播放时），不强制设置，避免破坏当前姿态

        // 清除偏移记录与基线
        stateManager.clearBoneCorrection(modelId, boneName);
        // 清除面板已应用旋转跟踪
        this.appliedRotationValues.delete(this.getBoneKey(modelId, boneName));
    }

    /**
     * 同步应用所有轴的旋转偏移
     * @param modelId 模型ID
     * @param boneName 骨骼名称
     * @param offsets {x, y, z} 偏移角度（弧度）
     * @param recaptureBase 是否重新捕获基线（动画更新后应设为 true）
     */
    public applyBoneRotationOffsetsSync(
        modelId: string,
        boneName: string,
        offsets: { x: number; y: number; z: number },
        recaptureBase: boolean = false
    ): void {
        const bone = this.getBone(modelId, boneName);
        if (!bone) return;

        const linkedBone = bone.linkedBone;
        const stateManager = ModelOptStateManager.getInstance();

        let state = stateManager.getBoneCorrectionState(modelId, boneName);

        // 首次应用或明确要求重新捕获时，记录当前旋转作为基线
        if (!state || !state.baseRotation || recaptureBase) {
            const baseRotation = linkedBone.rotationQuaternion?.clone() ?? new Quaternion(0, 0, 0, 1);
            stateManager.setBoneCorrectionBaseRotation(modelId, boneName, baseRotation);
            state = stateManager.getBoneCorrectionState(modelId, boneName)!;
        }

        const baseRotation = state.baseRotation ?? Quaternion.Identity();

        // 创建复合偏移四元数（按XYZ顺序叠加，使用预分配临时对象消除分配）
        BoneManager._WorkQuat1.copyFromFloats(0, 0, 0, 1); // offsetQuaternion = identity

        if (offsets.x !== 0) {
            Quaternion.RotationAxisToRef(BoneManager._AxisX, offsets.x, BoneManager._WorkQuat2);
            BoneManager._WorkQuat2.multiplyToRef(BoneManager._WorkQuat1, BoneManager._WorkQuat1);
        }

        if (offsets.y !== 0) {
            Quaternion.RotationAxisToRef(BoneManager._AxisY, offsets.y, BoneManager._WorkQuat2);
            BoneManager._WorkQuat2.multiplyToRef(BoneManager._WorkQuat1, BoneManager._WorkQuat1);
        }

        if (offsets.z !== 0) {
            Quaternion.RotationAxisToRef(BoneManager._AxisZ, offsets.z, BoneManager._WorkQuat2);
            BoneManager._WorkQuat2.multiplyToRef(BoneManager._WorkQuat1, BoneManager._WorkQuat1);
        }

        // 基于基线旋转叠加偏移
        BoneManager._WorkQuat1.multiplyToRef(baseRotation, BoneManager._WorkQuat3);
        linkedBone.setRotationQuaternion(BoneManager._WorkQuat3, Space.LOCAL);
    }

    public setSkeletonVisible(visible: boolean): void {
        this.globalSkeletonVisible = visible;
        if (visible) {
            this.buildAllSkeletons();
            this.startSkeletonUpdate();
            this.startBoneSelectionSync();
        } else {
            this.stopBoneSelectionSync();
            this.destroyAllSkeletons();
            this.stopSkeletonUpdate();
        }
    }

    public isSkeletonVisible(): boolean {
        return this.globalSkeletonVisible;
    }

    private buildAllSkeletons(): void {
        if (!this.scene) {
            console.warn('[BoneManager] buildAllSkeletons: no scene');
            return;
        }

        const animationManager = this.getAnimationManager();
        if (!animationManager) {
            console.warn('[BoneManager] buildAllSkeletons: no animationManager');
            return;
        }

        const models = ModelStateManager.getInstance().getModels();
        console.log(`[BoneManager] buildAllSkeletons: ${models.length} models`);

        for (const model of models) {
            let mmdModel = animationManager.getMmdModel(model.id);

            if (!mmdModel && this.modelManagerProvider) {
                const modelManager = this.modelManagerProvider();
                const modelInfo = modelManager?.getModel(model.id);
                if (modelInfo?.mesh) {
                    animationManager.createMmdModel(model.id, modelInfo.mesh as any)
                        .then((m) => {
                            if (this.globalSkeletonVisible && m.runtimeBones.length > 0) {
                                this.buildSkeletonForModel(model.id, m);
                            }
                        })
                        .catch((err) => console.error('[BoneManager] Failed to create MmdModel for skeleton:', err));
                }
                continue;
            }

            if (mmdModel && mmdModel.runtimeBones.length > 0) {
                this.buildSkeletonForModel(model.id, mmdModel);
            }
        }
    }

    private buildSkeletonForModel(modelId: string, mmdModel: MmdModel): void {
        if (!this.scene) return;

        this.destroySkeletonForModel(modelId);

        const runtimeBones = mmdModel.runtimeBones;

        // 共享材质（所有骨骼使用相同的蓝色）
        const mat = new PBRMaterial(`skeleton_mat_${modelId}`, this.scene);
        mat.albedoColor = new Color3(0.2, 0.6, 1);
        mat.emissiveColor = new Color3(0.2, 0.6, 1);
        mat.emissiveIntensity = 0.4;
        mat.roughness = 0.8;
        mat.specularIntensity = 2;
        mat.alpha = 0.8;
        mat.depthFunction = Constants.ALWAYS;

        this.skeletonDefaultMaterials.set(modelId, mat);

        const tmpMatrix = new Matrix();
        const tmpMatrix2 = new Matrix();
        const meshes: AbstractMesh[] = [];
        const up = Vector3.Up();
        const boneMeshMap = new Map<string, AbstractMesh[]>();

        for (const bone of runtimeBones) {
            // 跳过 MMD 中标记为"非表示"的骨骼（IsVisible flag = 8）
            if ((bone.flag & 8) === 0) continue;

            bone.getWorldMatrixToRef(tmpMatrix);
            const bonePos = tmpMatrix.getTranslation();

            const boneMeshes: AbstractMesh[] = [];

            if (bone.childBones.length > 0) {
                // 自→子连接：宽端在骨骼自身世界位置，尖端指向子级
                for (const child of bone.childBones) {
                    // 子级骨骼标记为"非表示"时跳过该连接线
                    if ((child.flag & 8) === 0) continue;

                    child.getWorldMatrixToRef(tmpMatrix2);
                    const childPos = tmpMatrix2.getTranslation();

                    const direction = childPos.subtract(bonePos);
                    const rawLength = direction.length();

                    const midPoint = bonePos.add(childPos).scale(0.5);

                    const cylinder = MeshBuilder.CreateCylinder(`skeleton_${modelId}_${bone.name}_to_${child.name}`, {
                        height: 1,
                        diameterTop: 0.0,
                        diameterBottom: 0.1,
                        tessellation: 4,
                        updatable: false
                    }, this.scene);

                    cylinder.position.copyFrom(midPoint);
                    const length = Math.max(rawLength, 0.001);
                    if (rawLength >= 0.001) {
                        const dirNorm = direction.normalize();
                        const rotQuat = new Quaternion();
                        Quaternion.FromUnitVectorsToRef(up, dirNorm, rotQuat);
                        cylinder.rotationQuaternion = rotQuat;
                    } else {
                        cylinder.rotationQuaternion = new Quaternion(0, 0, 0, 1);
                    }
                    cylinder.scaling.set(1, length, 1);

                    cylinder.renderingGroupId = 1;
                    cylinder.isPickable = false;
                    cylinder.material = mat;

                    boneMeshes.push(cylinder);
                    meshes.push(cylinder);
                }
            } else {
                // 末端骨骼：用小球体标记世界位置
                const sphere = MeshBuilder.CreateSphere(`skeleton_${modelId}_${bone.name}`, {
                    diameter: 0.04,
                    segments: 6
                }, this.scene);

                sphere.position.copyFrom(bonePos);
                sphere.renderingGroupId = 1;
                sphere.isPickable = false;
                sphere.material = mat;

                boneMeshes.push(sphere);
                meshes.push(sphere);
            }

            boneMeshMap.set(bone.name, boneMeshes);
        }

        this.skeletonBoneMeshMap.set(modelId, boneMeshMap);

        console.log(`[BoneManager] Created skeleton for ${modelId}: ${runtimeBones.length} bones, ${meshes.length} meshes`);

        this.skeletonMeshes.set(modelId, meshes);
    }

    private updateAllSkeletonPositions(): void {
        const animationManager = this.getAnimationManager();
        if (!animationManager) return;

        // 使用索引循环替代for...of，消除迭代器对象分配
        const skeletonMeshEntries = Array.from(this.skeletonMeshes.entries());
        for (let entryIdx = 0, entryLen = skeletonMeshEntries.length; entryIdx < entryLen; entryIdx++) {
            const [modelId, meshes] = skeletonMeshEntries[entryIdx];
            this.updateSkeletonForModel(animationManager, modelId, meshes);
        }
    }

    /** 更新单个模型的骨架位置 */
    private updateSkeletonForModel(
        animationManager: AnimationManager,
        modelId: string,
        meshes: AbstractMesh[]
    ): void {
        const mmdModel = animationManager.getMmdModel(modelId);
        if (!mmdModel) {
            for (let i = 0, len = meshes.length; i < len; i++) {
                meshes[i].setEnabled(false);
            }
            return;
        }

        const tmpMatrix = BoneManager._TmpMatrixA;
        const tmpMatrix2 = BoneManager._TmpMatrixB;
        const bonePos = BoneManager._TmpBonePos;
        const childPos = BoneManager._TmpChildPos;
        const up = Vector3.UpReadOnly;

        const runtimeBones = mmdModel.runtimeBones;
        const boneCount = runtimeBones.length;
        let meshIndex = 0;

        for (let boneIdx = 0; boneIdx < boneCount; boneIdx++) {
            if (meshIndex >= meshes.length) break;

            const bone = runtimeBones[boneIdx];
            // 跳过 MMD 中标记为"非表示"的骨骼（与构建时一致的过滤条件）
            if ((bone.flag & 8) === 0) continue;

            bone.getWorldMatrixToRef(tmpMatrix);
            tmpMatrix.getTranslationToRef(bonePos);

            const childBones = bone.childBones;
            const childCount = childBones.length;
            if (childCount > 0) {
                // 更新自→子连接锥体
                meshIndex = this.updateBoneConnections(
                    bone, bonePos, meshes, meshIndex,
                    tmpMatrix2, childPos, up
                );
            } else {
                // 更新末端骨骼球体位置
                meshIndex = this.updateEndBoneSphere(meshes, meshIndex, bonePos);
            }
        }
    }

    /** 更新骨骼的子连接锥体 */
    private updateBoneConnections(
        bone: IMmdRuntimeBone,
        bonePos: Vector3,
        meshes: AbstractMesh[],
        meshIndex: number,
        tmpMatrix2: Matrix,
        childPos: Vector3,
        up: Vector3
    ): number {
        const childBones = bone.childBones;
        const childCount = childBones.length;

        for (let childIdx = 0; childIdx < childCount; childIdx++) {
            if (meshIndex >= meshes.length) break;

            const child = childBones[childIdx];
            // 子级骨骼标记为"非表示"时跳过该连接线的更新（与构建时一致的过滤条件）
            if ((child.flag & 8) === 0) continue;

            child.getWorldMatrixToRef(tmpMatrix2);
            tmpMatrix2.getTranslationToRef(childPos);

            childPos.subtractToRef(bonePos, BoneManager._TmpDir);
            const dir = BoneManager._TmpDir;
            const length = dir.length();

            if (length < 0.001) {
                meshes[meshIndex].setEnabled(false);
                meshIndex++;
                continue;
            }

            bonePos.addToRef(childPos, BoneManager._TmpMid);
            BoneManager._TmpMid.scaleToRef(0.5, BoneManager._TmpMid);
            const cylinder = meshes[meshIndex];

            cylinder.position.copyFrom(BoneManager._TmpMid);
            dir.normalizeToRef(BoneManager._TmpDirNorm);
            Quaternion.FromUnitVectorsToRef(up, BoneManager._TmpDirNorm, BoneManager._TmpRotQuat);
            cylinder.rotationQuaternion!.copyFrom(BoneManager._TmpRotQuat);
            cylinder.scaling.set(1, length, 1);
            cylinder.setEnabled(true);

            meshIndex++;
        }
        return meshIndex;
    }

    /** 更新末端骨骼球体位置 */
    private updateEndBoneSphere(
        meshes: AbstractMesh[],
        meshIndex: number,
        bonePos: Vector3
    ): number {
        const sphere = meshes[meshIndex];
        sphere.position.copyFrom(bonePos);
        sphere.setEnabled(true);
        return meshIndex + 1;
    }

    //region Bone Parenting (Experimental)

    /** 确保每帧更新父级绑定 */
    ensureParentingUpdate(): void {
        if (!BoneManager.ENABLE_BONE_PARENTING) return;
        if (this.parentingUpdateObserver) return;

        const scene = this.scene ?? this.getAnimationManager()?.getScene();
        if (!scene) return;

        const callback = () => { this.updateBoneParenting(); };
        scene.onBeforeRenderObservable.add(callback);
        this.parentingUpdateObserver = { scene, callback };
    }

    private stopParentingUpdate(): void {
        if (this.parentingUpdateObserver) {
            this.parentingUpdateObserver.scene.onBeforeRenderObservable.remove(this.parentingUpdateObserver.callback);
            this.parentingUpdateObserver = null;
        }
    }

    private updateBoneParenting(): void {
        const stateManager = ModelOptStateManager.getInstance();
        const bindings = stateManager.getBoneParentingBindings();
        const bindingCount = bindings.length;
        if (bindingCount === 0) {
            this.stopParentingUpdate();
            return;
        }

        const animationManager = this.getAnimationManager();
        if (!animationManager) return;

        // 使用索引循环替代for...of，消除迭代器对象分配
        for (let bindingIdx = 0; bindingIdx < bindingCount; bindingIdx++) {
            const binding = bindings[bindingIdx];
            if (!binding.enabled) continue;

            const parentModel = animationManager.getMmdModel(binding.parentModelId);
            const childModel = animationManager.getMmdModel(binding.childModelId);
            if (!parentModel || !childModel) continue;

            const parentBone = this.getBone(binding.parentModelId, binding.parentBoneName);
            if (!parentBone) continue;

            parentBone.getWorldMatrixToRef(BoneManager._ParentWorldMatrix);

            BoneManager._ParentWorldMatrix.decompose(BoneManager._ParentScale, BoneManager._ParentRotation, BoneManager._ParentPosition);

            const baselineKey = binding.id;
            let baseline = this.parentingBaselineOffsets.get(baselineKey);
            if (!baseline) {
                if (childModel.mesh.rotationQuaternion) {
                    BoneManager._ChildWorkQuat.copyFrom(childModel.mesh.rotationQuaternion);
                } else {
                    Quaternion.FromEulerVectorToRef(childModel.mesh.rotation, BoneManager._ChildWorkQuat);
                }
                childModel.mesh.position.subtractToRef(BoneManager._ParentPosition, BoneManager._ChildWorkPos);
                baseline = {
                    position: BoneManager._ChildWorkPos.clone(),
                    rotation: BoneManager._ChildWorkQuat.clone()
                };
                this.parentingBaselineOffsets.set(baselineKey, baseline);
            }

            BoneManager._ParentPosition.addToRef(baseline.position, BoneManager._ChildWorkPos);
            childModel.mesh.position.copyFrom(BoneManager._ChildWorkPos);

            if (!childModel.mesh.rotationQuaternion) {
                childModel.mesh.rotationQuaternion = Quaternion.FromEulerVector(childModel.mesh.rotation);
            }
            BoneManager._ParentRotation.multiplyToRef(baseline.rotation, BoneManager._ParentResultQuat);
            childModel.mesh.rotationQuaternion.copyFrom(BoneManager._ParentResultQuat);
        }
    }

    setParentingBaselineZero(bindingId: string): void {
        this.parentingBaselineOffsets.set(bindingId, {
            position: Vector3.Zero(),
            rotation: Quaternion.Identity()
        });
    }

    //endregion

    private startSkeletonUpdate(): void {
        if (!this.scene || this.skeletonUpdateObserver) return;

        this.skeletonUpdateObserver = this.scene.onBeforeRenderObservable.add(() => {
            this.updateAllSkeletonPositions();
        });
    }

    private stopSkeletonUpdate(): void {
        if (this.scene && this.skeletonUpdateObserver) {
            this.scene.onBeforeRenderObservable.remove(this.skeletonUpdateObserver);
            this.skeletonUpdateObserver = null;
        }
    }

    private destroySkeletonForModel(modelId: string): void {
        if (this.currentlySelectedBone?.modelId === modelId) {
            this.currentlySelectedBone = null;
        }

        ModelOptStateManager.getInstance().removeModelBoneParentingBindings(modelId);
        // 清理关联的基线偏移
        for (const [key] of this.parentingBaselineOffsets) {
            const bindings = ModelOptStateManager.getInstance().getBoneParentingBindings();
            if (!bindings.some(b => b.id === key)) {
                this.parentingBaselineOffsets.delete(key);
            }
        }

        const meshes = this.skeletonMeshes.get(modelId);
        if (meshes) {
            for (const mesh of meshes) {
                mesh.dispose();
            }
            this.skeletonMeshes.delete(modelId);
        }
        this.skeletonBoneMeshMap.delete(modelId);
        this.skeletonDefaultMaterials.delete(modelId);
    }

    private destroyAllSkeletons(): void {
        for (const meshes of this.skeletonMeshes.values()) {
            for (const mesh of meshes) {
                mesh.dispose();
            }
        }
        this.skeletonMeshes.clear();
        this.skeletonBoneMeshMap.clear();
        this.skeletonDefaultMaterials.clear();
        this.currentlySelectedBone = null;
    }
}
