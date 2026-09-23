
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { EventConstants } from '@babylonjs/core/Events/deviceInputEvents';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';

const FfMultiplier = 40;

const MIN_DISTANCE = 5;

/**
 * MMD 相机鼠标滚轮输入控制器
 * 为 MmdCamera 提供滚轮缩放支持
 * 旋转中心固定为场景原点
 */
export class MmdCameraMouseWheelInput {
    /** 关联的相机 */
    public camera!: MmdCamera;

    /** 滚轮灵敏度 */
    public wheelPrecision: number = 3.0;

    /** 滚轮百分比缩放 (如果非0则替代 wheelPrecision) */
    public wheelDeltaPercentage: number = 0;

    /** 最近距离（相机到目标点的最小距离） */
    public minDistance: number = MIN_DISTANCE;

    /** 是否启用惯性 */
    public inertiaEnabled: boolean = true;

    /** 惯性系数 */
    public inertia: number = 0.9;

    // 内部状态
    private _observer: any = null;
    private _wheel: ((p: any) => void) | null = null;
    private _inertialDistance: number = 0;

    /** 临时向量 */
    private static _TmpOrigin = Vector3.Zero();

    /** 临时保存的 target，避免每帧 clone */
    private static _TmpSavedTarget = new Vector3();

    /**
     * 绑定控制到 DOM 元素
     */
    public attachControl(noPreventDefault?: boolean): void {
        noPreventDefault = noPreventDefault ?? false;

        this._wheel = (p: any) => {
            if (p.type !== PointerEventTypes.POINTERWHEEL) {
                return;
            }

            const event = p.event;
            const platformScale = event.deltaMode === EventConstants.DOM_DELTA_LINE ? FfMultiplier : 1;
            const wheelDelta = -(event.deltaY * platformScale);

            let delta: number;

            if (this.wheelDeltaPercentage) {
                delta = this._computeDeltaFromMouseWheelLegacyEvent(wheelDelta, Math.abs(this.camera.distance));
            } else {
                delta = wheelDelta / (this.wheelPrecision * 40);
            }

            if (delta) {
                if (this.inertiaEnabled) {
                    this._inertialDistance += delta;
                } else {
                    this._applyDistance(delta);
                }
            }

            if (event.preventDefault && !noPreventDefault) {
                event.preventDefault();
            }
        };

        this._observer = this.camera.getScene()._inputManager._addCameraPointerObserver(
            this._wheel,
            PointerEventTypes.POINTERWHEEL
        );
    }

    /**
     * 解绑控制
     */
    public detachControl(): void {
        if (this._observer) {
            this.camera.getScene()._inputManager._removeCameraPointerObserver(this._observer);
            this._observer = null;
            this._wheel = null;
        }
    }

    /**
     * 应用距离变化，确保旋转中心为场景原点
     */
    private _applyDistance(delta: number): void {
        MmdCameraMouseWheelInput._TmpSavedTarget.copyFrom(this.camera.target);

        this.camera.target.copyFrom(MmdCameraMouseWheelInput._TmpOrigin);

        this.camera.distance += delta;
        if (this.camera.distance > -this.minDistance) {
            this.camera.distance = -this.minDistance;
        }
        this.camera.updatePosition();

        this.camera.target.copyFrom(MmdCameraMouseWheelInput._TmpSavedTarget);
        this.camera.position.addInPlace(MmdCameraMouseWheelInput._TmpSavedTarget);
    }

    /**
     * 检查输入并应用惯性
     */
    public checkInputs(): void {
        if (!this.inertiaEnabled || Math.abs(this._inertialDistance) < 0.01) {
            return;
        }

        this._applyDistance(this._inertialDistance);

        this._inertialDistance *= this.inertia;

        if (Math.abs(this._inertialDistance) < 0.01) {
            this._inertialDistance = 0;
        }
    }

    /**
     * 使用百分比模式计算滚轮增量
     */
    private _computeDeltaFromMouseWheelLegacyEvent(mouseWheelDelta: number, distance: number): number {
        const wheelDelta = mouseWheelDelta * 0.01 * this.wheelDeltaPercentage * distance;
        let delta: number;

        if (mouseWheelDelta > 0) {
            delta = wheelDelta / (1.0 + this.wheelDeltaPercentage);
        } else {
            delta = wheelDelta * (1.0 + this.wheelDeltaPercentage);
        }

        return delta;
    }

    /**
     * 获取类名
     */
    public getClassName(): string {
        return 'MmdCameraMouseWheelInput';
    }

    /**
     * 获取简单名称
     */
    public getSimpleName(): string {
        return 'mousewheel';
    }
}
