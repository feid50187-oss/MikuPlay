import { FollowCamera, Mesh, Matrix, Vector3, Quaternion } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { Observer } from '@babylonjs/core';
import type { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { CameraManager } from './CameraManager';
import type { ModelManager, ModelInfo } from './ModelManager';

/**
 * 跟随相机管理器
 * 负责在 MMD 相机与 Babylon 的 FollowCamera 之间切换，并管理跟随模型的绑定逻辑：
 * - 默认跟随场景中第一个 MMD 模型
 * - 场景无模型时绑定至之后导入的第一个模型
 * - 已绑定模型时忽略新增模型
 * - 绑定模型被删除后按顺序切换到下一个模型，无更多模型时恢复默认视角
 */
export class FollowCameraManager {
    private scene: Scene;
    private mmdCamera: MmdCamera;
    private cameraManager: CameraManager;
    private modelManager: ModelManager;

    private followCamera: FollowCamera | null = null;
    private enabled: boolean = false;

    /** 跟随相机锁定的虚拟目标（每帧同步到头骨世界坐标，避免根节点静止导致相机不跟随） */
    private followTarget: Mesh | null = null;
    /** 锁定目标的初始 Y 坐标（模型在 Y 方向不跟随） */
    private lockedTargetY: number | null = null;
    /** 取消渲染观测（每帧同步 target 到头骨） */
    private renderObserver: Observer<Scene> | null = null;

    /** 模型导入顺序（用于删除后切换到下一个） */
    private modelOrder: string[] = [];
    /** 当前跟随的模型 ID */
    private boundModelId: string | null = null;

    /** 取消订阅函数 */
    private unsubscribeModelChanged: (() => void) | null = null;

    // 预分配临时对象，避免每帧分配
    private static readonly _TmpMatrix = new Matrix();
    private static readonly _TmpTranslation = new Vector3();

    constructor(cameraManager: CameraManager, modelManager: ModelManager) {
        this.cameraManager = cameraManager;
        this.modelManager = modelManager;
        this.mmdCamera = cameraManager.getMmdCamera();
        this.scene = this.mmdCamera.getScene();

        this.modelOrder = this.modelManager.getAllModels().map(m => m.id);
        // 仅在启用时响应模型变化，内部通过 enabled 判断
        this.unsubscribeModelChanged = this.modelManager.onModelChanged((model, added) => {
            this.handleModelChanged(model, added);
        });
    }

    /**
     * 是否已启用跟随相机
     */
    public isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * 启用跟随相机
     * 切换当前相机为 FollowCamera，并绑定到场景中的模型
     */
    public enable(): void {
        if (this.enabled) {
            return;
        }

        // 停用 MMD 相机手动控制，避免与跟随相机输入冲突
        this.cameraManager.disableManualControl();

        const position = this.mmdCamera.position.clone();
        this.followCamera = new FollowCamera('followCamera', position, this.scene);
        this.followCamera.radius = 18;
        this.followCamera.heightOffset = 1;
        // 180° 使相机位于模型正前方（MMD 模型默认面向 +Z，公式默认将相机置于 +Z 即背面）
        this.followCamera.rotationOffset = 180;
        this.followCamera.cameraAcceleration = 0.08;
        this.followCamera.maxCameraSpeed = 12;
        this.followCamera.attachControl(true);

        // 默认 pointers 手势配置（X→旋转、Y→高度、pinch→半径）本身是"每轴控制单一属性"，
        // 但 Babylon 会在仅启用单个属性时误报警告，此处关闭该误报。
        const pointerInput = this.followCamera.inputs.attached['pointers'] as { warningEnable?: boolean } | undefined;
        if (pointerInput) {
            pointerInput.warningEnable = false;
        }

        this.scene.activeCamera = this.followCamera;
        this.enabled = true;

        // 同步模型导入顺序：模型可能在启用跟随前已导入，需基于当前模型重建顺序
        this.modelOrder = this.modelManager.getAllModels().map(m => m.id);

        this.bindToDefaultModel();
    }

    /**
     * 关闭跟随相机
     * 切换回 MMD 相机并释放跟随相机资源
     */
    public disable(): void {
        if (!this.enabled) {
            return;
        }

        this.unbindModel();

        if (this.followCamera) {
            this.followCamera.detachControl();
            this.followCamera.dispose();
            this.followCamera = null;
        }
        this.disposeFollowTarget();

        this.scene.activeCamera = this.mmdCamera;
        this.enabled = false;

        // 恢复 MMD 相机手动控制
        this.cameraManager.enableManualControl();
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        if (this.enabled) {
            this.disable();
        }
        if (this.unsubscribeModelChanged) {
            this.unsubscribeModelChanged();
            this.unsubscribeModelChanged = null;
        }
    }

    /**
     * 绑定到默认模型（场景中第一个 MMD 模型；无模型则保持未绑定，等待之后导入）
     */
    private bindToDefaultModel(): void {
        const firstModel = this.modelManager.getAllModels()[0];
        if (firstModel?.mesh) {
            this.bindToModel(firstModel);
        } else {
            this.unbindModel();
        }
    }

    /**
     * 绑定跟随相机到指定模型
     * 创建一个虚拟 target 并每帧同步到头骨的世界坐标（Y 方向锁定，不跟随模型上下移动）
     */
    private bindToModel(model: ModelInfo): void {
        if (!this.followCamera || !model.mesh) {
            return;
        }
        // 清理上一个绑定的 observer 与 target，避免旧 observer 继续引用已删除模型
        this.teardownFollowTarget();
        this.boundModelId = model.id;
        this.lockedTargetY = null;

        this.followTarget = new Mesh(`followTarget_${model.id}`, this.scene);
        this.followTarget.isVisible = false;
        this.followTarget.isPickable = false;
        this.followCamera.lockedTarget = this.followTarget;
        // 绑定到模型后重新激活跟随相机视图，并停用 MMD 相机手动控制避免输入冲突
        this.scene.activeCamera = this.followCamera;
        this.cameraManager.disableManualControl();

        // 每帧把上半身世界坐标同步到虚拟 target，Y 方向保持初始值
        this.renderObserver = this.scene.onBeforeRenderObservable.add(() => {
            this.syncTargetToTrackPoint(model);
        });

        // 立即同步一次并放置相机到目标位置，避免视角从远处跳变
        this.syncTargetToTrackPoint(model);
        this.positionCameraAtTarget();
    }

    /**
     * 解除绑定，恢复默认视角（相机停留在当前位置）
     */
    private unbindModel(): void {
        this.boundModelId = null;
        if (this.followCamera) {
            this.followCamera.lockedTarget = null;
        }
        this.teardownFollowTarget();
    }

    /**
     * 移除每帧同步 observer 并释放虚拟 target
     */
    private teardownFollowTarget(): void {
        if (this.renderObserver) {
            if (this.scene.onBeforeRenderObservable.hasObservers()) {
                this.scene.onBeforeRenderObservable.remove(this.renderObserver);
            }
            this.renderObserver = null;
        }
        this.disposeFollowTarget();
        this.lockedTargetY = null;
    }

    /**
     * 无模型可跟随时恢复默认视角：清理绑定并切回 MMD 相机。
     * 跟随相机在无 lockedTarget 时不会更新位置，若继续作为活动相机会冻结且无法操作。
     */
    private restoreDefaultView(): void {
        this.unbindModel();
        if (this.followCamera) {
            this.scene.activeCamera = this.mmdCamera;
        }
        // 重新启用 MMD 相机手动控制，否则切回后相机因控制被禁用而无法操作
        this.cameraManager.enableManualControl();
    }

    /**
     * 将虚拟 target 同步到上半身（或模型中心）的世界坐标
     * Y 方向锁定在初始值，不跟随模型上下移动
     */
    private syncTargetToTrackPoint(model: ModelInfo): boolean {
        if (!this.followTarget) {
            return false;
        }

        const trackBone = this.getUpperBodyBone(model);
        if (trackBone) {
            trackBone.getWorldTranslationToRef(FollowCameraManager._TmpTranslation);
            if (!this.isFiniteVector(FollowCameraManager._TmpTranslation)) {
                return false;
            }
            // 首次同步时锁定 Y 坐标
            if (this.lockedTargetY === null) {
                this.lockedTargetY = FollowCameraManager._TmpTranslation.y;
            }
            // 使用锁定的 Y 坐标，只更新 X 和 Z
            this.followTarget.position.x = FollowCameraManager._TmpTranslation.x;
            this.followTarget.position.y = this.lockedTargetY;
            this.followTarget.position.z = FollowCameraManager._TmpTranslation.z;
            // 不追踪模型旋转，保持相机朝向固定
            this.followTarget.rotationQuaternion = Quaternion.Identity();
            return true;
        }

        // 兜底：无上半身骨骼时退化为追踪模型包围盒中心，保证相机仍能跟随模型移动
        const mesh = model.mesh;
        // 模型删除过程中网格可能已被 dispose，此时返回 NaN 会导致相机冻结，需跳过
        if (mesh && !mesh.isDisposed()) {
            mesh.computeWorldMatrix();
            const boundingInfo = mesh.getBoundingInfo();
            if (boundingInfo) {
                const center = boundingInfo.boundingBox.centerWorld;
                if (this.isFiniteVector(center)) {
                    // 首次同步时锁定 Y 坐标
                    if (this.lockedTargetY === null) {
                        this.lockedTargetY = center.y;
                    }
                    // 使用锁定的 Y 坐标，只更新 X 和 Z
                    this.followTarget.position.x = center.x;
                    this.followTarget.position.y = this.lockedTargetY;
                    this.followTarget.position.z = center.z;
                    this.followTarget.rotationQuaternion = Quaternion.Identity();
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * 判断向量各分量是否均为有限值，避免 NaN 污染相机位置
     */
    private isFiniteVector(v: Vector3): boolean {
        return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    }

    /**
     * 将相机立即放到目标位置，避免切换瞬间视角跳变到远处再缓慢飞回
     */
    private positionCameraAtTarget(): void {
        if (!this.followCamera || !this.followTarget) {
            return;
        }
        const targetPos = this.followTarget.getAbsolutePosition();
        // 与 Babylon FollowCamera._follow 保持一致的计算方式，避免初始朝向取反
        const rotMatrix = FollowCameraManager._TmpMatrix;
        this.followTarget.absoluteRotationQuaternion.toRotationMatrix(rotMatrix);
        const yRotation = Math.atan2(rotMatrix.m[8], rotMatrix.m[10]);
        const radians = (this.followCamera.rotationOffset * Math.PI) / 180 + yRotation;
        this.followCamera.position = new Vector3(
            targetPos.x + Math.sin(radians) * this.followCamera.radius,
            targetPos.y + this.followCamera.heightOffset,
            targetPos.z + Math.cos(radians) * this.followCamera.radius
        );
        this.followCamera.setTarget(targetPos);
    }

    /**
     * 获取模型的"上半身"骨骼（优先 '上半身' 系列，其次回退到 '頭'/'Head'）
     */
    private getUpperBodyBone(model: ModelInfo): IMmdRuntimeBone | null {
        const mmdModel = this.modelManager.getMmdModel(model.id);
        if (!mmdModel || !mmdModel.runtimeBones) {
            return null;
        }
        const upperBodyNames = new Set(['上半身', '上半身1', '上半身2', 'UpperBody', 'Upper Body']);
        for (const bone of mmdModel.runtimeBones) {
            if (upperBodyNames.has(bone.name)) {
                return bone;
            }
        }
        // 无上半身骨骼时回退到头骨
        for (const bone of mmdModel.runtimeBones) {
            if (bone.name === '頭' || bone.name === 'Head') {
                return bone;
            }
        }
        return null;
    }

    /**
     * 释放虚拟 target 资源
     */
    private disposeFollowTarget(): void {
        if (this.followTarget) {
            this.followTarget.dispose();
            this.followTarget = null;
        }
    }

    /**
     * 处理模型新增/删除事件
     */
    private handleModelChanged(model: ModelInfo, added: boolean): void {
        if (!this.enabled) {
            return;
        }

        if (added) {
            this.modelOrder.push(model.id);
            // 已绑定模型时忽略新增模型
            if (this.boundModelId === null && model.mesh) {
                this.bindToModel(model);
            }
        } else {
            const index = this.modelOrder.indexOf(model.id);
            if (index >= 0) {
                this.modelOrder.splice(index, 1);
            }

            // 仅当被删除的是当前跟随的模型时切换
            if (model.id !== this.boundModelId) {
                return;
            }

            // 判断：绑定模型被删除后，若场景还有其他模型则顺序切换绑定到下一个；否则恢复默认视角
            if (this.modelOrder.length === 0) {
                // 无更多模型，恢复默认视角（切回 MMD 相机，避免跟随相机因无 target 而冻结）
                this.restoreDefaultView();
                return;
            }

            // 顺序切换到下一个模型（删除的是最后一个时回退到新的最后一个）
            const nextIndex = Math.min(index, this.modelOrder.length - 1);
            const nextId = this.modelOrder[nextIndex];
            const nextModel = this.modelManager.getModel(nextId);
            if (nextModel?.mesh && !nextModel.mesh.isDisposed()) {
                this.bindToModel(nextModel);
            } else {
                this.unbindModel();
            }
        }
    }

    /**
     * 获取跟随相机实例
     */
    public getFollowCamera(): FollowCamera | null {
        return this.followCamera;
    }

    /**
     * 获取当前跟随的模型 ID
     */
    public getBoundModelId(): string | null {
        return this.boundModelId;
    }
}