
import { Vector3, Scene, Matrix } from '@babylonjs/core';
import type { Camera, AbstractMesh } from '@babylonjs/core';
import type { IMmdModel } from 'babylon-mmd/esm/Runtime/IMmdModel';

export interface MmdModelProvider {
    getMmdModel(modelId: string): IMmdModel | undefined;
    getAllMmdModelIds(): string[];
    getMeshForModel(modelId: string): AbstractMesh | undefined;
}

export class AutoFocusController {
    private _scene: Scene;
    private _camera: Camera;
    private _modelProvider: MmdModelProvider;
    private _targetModelId: string = '';
    private _isEnabled: boolean = false;
    private _onFocusUpdate: ((distance: number) => void) | null = null;

    // 缓存头骨引用，避免每帧扫描所有骨骼
    private _cachedHeadBone: import('babylon-mmd/esm/Runtime/IMmdRuntimeBone').IMmdRuntimeBone | null = null;
    private _cachedHeadModelId: string = '';

    // 预分配临时对象，消除每帧分配
    private static readonly _TmpMatrix = new Matrix();
    private static readonly _TmpPosition = new Vector3();
    private static readonly _TmpDiff = new Vector3();

    constructor(
        scene: Scene,
        camera: Camera,
        modelProvider: MmdModelProvider
    ) {
        this._scene = scene;
        this._camera = camera;
        this._modelProvider = modelProvider;
    }

    get isEnabled(): boolean {
        return this._isEnabled;
    }

    set isEnabled(value: boolean) {
        this._isEnabled = value;
    }

    get targetModelId(): string {
        return this._targetModelId;
    }

    set targetModelId(value: string) {
        this._targetModelId = value;
    }

    set onFocusUpdate(callback: ((distance: number) => void) | null) {
        this._onFocusUpdate = callback;
    }

    public update(): void {
        if (!this._isEnabled || !this._targetModelId) return;

        const distance = this.calculateFocusDistance();
        if (distance > 0 && this._onFocusUpdate) {
            this._onFocusUpdate(distance);
        }
    }

    private calculateFocusDistance(): number {
        let targetPos = this.getHeadBoneWorldPosition();

        if (targetPos) {
            targetPos.subtractToRef(this._camera.position, AutoFocusController._TmpDiff);
            return AutoFocusController._TmpDiff.length();
        }

        targetPos = this.getMeshBoundingCenter();
        if (targetPos) {
            targetPos.subtractToRef(this._camera.position, AutoFocusController._TmpDiff);
            return AutoFocusController._TmpDiff.length();
        }

        return 0;
    }

    private getHeadBoneWorldPosition(): Vector3 | null {
        const mmdModel = this._modelProvider.getMmdModel(this._targetModelId);
        if (!mmdModel || !mmdModel.runtimeBones) {
            this._cachedHeadBone = null;
            return null;
        }

        // 模型切换时重新扫描，否则复用缓存引用
        if (this._cachedHeadBone && this._cachedHeadModelId === this._targetModelId) {
            // 快速路径：验证缓存引用仍有效（未反注册）
            if ((this._cachedHeadBone as any)._isDisposed !== true) {
                this._cachedHeadBone.getWorldMatrixToRef(AutoFocusController._TmpMatrix);
                AutoFocusController._TmpMatrix.getTranslationToRef(AutoFocusController._TmpPosition);
                return AutoFocusController._TmpPosition;
            }
            this._cachedHeadBone = null;
        }

        // 首次 / 模型切换：扫描所有骨骼查找头骨
        for (const bone of mmdModel.runtimeBones) {
            if (bone.name === '頭' || bone.name === 'Head') {
                this._cachedHeadBone = bone;
                this._cachedHeadModelId = this._targetModelId;
                bone.getWorldMatrixToRef(AutoFocusController._TmpMatrix);
                AutoFocusController._TmpMatrix.getTranslationToRef(AutoFocusController._TmpPosition);
                return AutoFocusController._TmpPosition;
            }
        }

        this._cachedHeadBone = null;
        return null;
    }

    private getMeshBoundingCenter(): Vector3 | null {
        const mesh = this._modelProvider.getMeshForModel(this._targetModelId);
        if (!mesh) return null;

        mesh.computeWorldMatrix();
        const boundingInfo = mesh.getBoundingInfo();
        if (!boundingInfo) return null;

        // centerWorld 在同一帧内稳定不变，无需 clone
        return boundingInfo.boundingBox.centerWorld;
    }

    dispose(): void {
        this._onFocusUpdate = null;
    }
}
