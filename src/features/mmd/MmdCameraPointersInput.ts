
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { Tools } from '@babylonjs/core/Misc/tools';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';

export interface PointerPoint {
    x: number;
    y: number;
    pointerId: number;
    type: string;
    button: number;
}

export interface MultiTouchPoint {
    x: number;
    y: number;
    pointerId: number;
    type: string;
}

const PITCH_LOWER_LIMIT = -Math.PI / 2 + 0.01;
const PITCH_UPPER_LIMIT = Math.PI / 2 - 0.01;

const MIN_DISTANCE = 5;

/**
 * MMD 相机指针输入控制器
 * 为 MmdCamera 提供类似 ArcRotateCamera 的触屏和鼠标操作支持
 * 旋转中心固定为场景原点，平移使用独立偏移量
 */
export class MmdCameraPointersInput {
    /** 关联的相机 */
    public camera!: MmdCamera;

    /** 允许的鼠标按钮 */
    public buttons: number[] = [0, 1, 2];

    /** X轴旋转灵敏度（水平拖动） */
    public angularSensibilityX: number = 1000.0;

    /** Y轴旋转灵敏度（垂直拖动） */
    public angularSensibilityY: number = 1000.0;

    /** 双指缩放灵敏度 */
    public pinchPrecision: number = 5.0;

    /** 平移灵敏度 */
    public panningSensibility: number = 200.0;

    /** 最近距离（相机到目标点的最小距离） */
    public minDistance: number = MIN_DISTANCE;

    /** 是否启用双指缩放 */
    public pinchZoom: boolean = true;

    /** 是否启用双指平移 */
    public multiTouchPanning: boolean = true;

    /** 是否同时启用缩放和平移 */
    public multiTouchPanAndZoom: boolean = true;

    /** 是否反转缩放方向 */
    public pinchInwards: boolean = true;

    /** 是否启用惯性 */
    public inertiaEnabled: boolean = true;

    /** 惯性系数 (0-1, 越小惯性越强) */
    public inertia: number = 0.9;

    // 内部状态
    private _observer: any = null;
    private _pointA: PointerPoint | null = null;
    private _pointB: PointerPoint | null = null;
    private _currentMousePointerIdDown: number = -1;
    private _altKey: boolean = false;
    private _ctrlKey: boolean = false;
    private _metaKey: boolean = false;
    private _shiftKey: boolean = false;
    private _buttonsPressed: number = 0;
    private _isPanClick: boolean = false;
    private _isPinching: boolean = false;
    private _twoFingerActivityCount: number = 0;
    private _shouldStartPinchZoom: boolean = false;
    private _onLostFocus: (() => void) | null = null;
    private _contextMenuBind: ((evt: Event) => void) | null = null;
    private _pointerInput: ((p: any) => void) | null = null;

    // 惯性值
    private _inertialRotationX: number = 0;
    private _inertialRotationY: number = 0;
    private _inertialDistance: number = 0;
    private _inertialPanningX: number = 0;
    private _inertialPanningY: number = 0;

    /** 平移偏移量（独立于旋转中心） */
    private _panningOffset: Vector3 = new Vector3(0, 0, 0);

    /** 临时向量，避免每帧分配 */
    private static _TmpOrigin = Vector3.Zero();

    /** 临时保存的 target，避免每帧 clone */
    private static _TmpSavedTarget = new Vector3();

    /** 临时缩放结果向量 */
    private static _TmpScaledVec = new Vector3();

    /** 临时旋转矩阵 */
    private static _TmpRotationMatrix = Matrix.Identity();

    /** 临时右方向向量 */
    private static _TmpRight = new Vector3();

    /** 临时上方向向量 */
    private static _TmpUp = new Vector3();

    /**
     * 绑定控制到 DOM 元素
     */
    public attachControl(noPreventDefault?: boolean): void {
        noPreventDefault = noPreventDefault ?? false;

        const engine = this.camera.getEngine();
        const element = engine.getInputElement();

        let previousPinchSquaredDistance = 0;
        let previousMultiTouchPanPosition: MultiTouchPoint | null = null;

        this._pointA = null;
        this._pointB = null;
        this._altKey = false;
        this._ctrlKey = false;
        this._metaKey = false;
        this._shiftKey = false;
        this._buttonsPressed = 0;

        this._pointerInput = (p: any) => {
            const evt = p.event;
            const isTouch = evt.pointerType === 'touch';

            if (p.type !== PointerEventTypes.POINTERMOVE && this.buttons.indexOf(evt.button) === -1) {
                return;
            }

            const srcElement = evt.target;
            this._altKey = evt.altKey;
            this._ctrlKey = evt.ctrlKey;
            this._metaKey = evt.metaKey;
            this._shiftKey = evt.shiftKey;
            this._buttonsPressed = evt.buttons;

            if (engine.isPointerLock) {
                const offsetX = evt.movementX;
                const offsetY = evt.movementY;
                this.onTouch(null, offsetX, offsetY);
                this._pointA = null;
                this._pointB = null;
            } else if (
                p.type !== PointerEventTypes.POINTERDOWN &&
                p.type !== PointerEventTypes.POINTERDOUBLETAP &&
                isTouch &&
                this._pointA?.pointerId !== evt.pointerId &&
                this._pointB?.pointerId !== evt.pointerId
            ) {
                return;
            } else if (p.type === PointerEventTypes.POINTERDOWN && (this._currentMousePointerIdDown === -1 || isTouch)) {
                try {
                    srcElement?.setPointerCapture(evt.pointerId);
                } catch (e) {
                    // 忽略错误
                }

                if (this._pointA === null) {
                    this._pointA = {
                        x: evt.clientX,
                        y: evt.clientY,
                        pointerId: evt.pointerId,
                        type: evt.pointerType,
                        button: evt.button,
                    };
                } else if (this._pointB === null) {
                    this._pointB = {
                        x: evt.clientX,
                        y: evt.clientY,
                        pointerId: evt.pointerId,
                        type: evt.pointerType,
                        button: evt.button,
                    };
                } else {
                    return;
                }

                if (this._currentMousePointerIdDown === -1 && !isTouch) {
                    this._currentMousePointerIdDown = evt.pointerId;
                }

                this.onButtonDown(evt);

                if (!noPreventDefault) {
                    evt.preventDefault();
                    if (element) {
                        element.focus();
                    }
                }
            } else if (p.type === PointerEventTypes.POINTERDOUBLETAP) {
                this.onDoubleTap(evt.pointerType);
            } else if (p.type === PointerEventTypes.POINTERUP && (this._currentMousePointerIdDown === evt.pointerId || isTouch)) {
                try {
                    srcElement?.releasePointerCapture(evt.pointerId);
                } catch (e) {
                    // 忽略错误
                }

                if (!isTouch) {
                    this._pointB = null;
                }

                if (engine._badOS) {
                    this._pointA = this._pointB = null;
                } else {
                    if (this._pointB && this._pointA && this._pointA.pointerId == evt.pointerId) {
                        this._pointA = this._pointB;
                        this._pointB = null;
                    } else if (this._pointA && this._pointB && this._pointB.pointerId == evt.pointerId) {
                        this._pointB = null;
                    } else {
                        this._pointA = this._pointB = null;
                    }
                }

                if (previousPinchSquaredDistance !== 0 || previousMultiTouchPanPosition) {
                    this.onMultiTouch(
                        this._pointA,
                        this._pointB,
                        previousPinchSquaredDistance,
                        0,
                        previousMultiTouchPanPosition,
                        null
                    );
                    previousPinchSquaredDistance = 0;
                    previousMultiTouchPanPosition = null;
                }

                this._currentMousePointerIdDown = -1;
                this.onButtonUp(evt);

                if (!noPreventDefault) {
                    evt.preventDefault();
                }
            } else if (p.type === PointerEventTypes.POINTERMOVE) {
                if (!noPreventDefault) {
                    evt.preventDefault();
                }

                if (this._pointA && this._pointB === null) {
                    const offsetX = evt.clientX - this._pointA.x;
                    const offsetY = evt.clientY - this._pointA.y;
                    this._pointA.x = evt.clientX;
                    this._pointA.y = evt.clientY;
                    this.onTouch(this._pointA, offsetX, offsetY);
                } else if (this._pointA && this._pointB) {
                    const ed = this._pointA.pointerId === evt.pointerId ? this._pointA : this._pointB;
                    ed.x = evt.clientX;
                    ed.y = evt.clientY;

                    const distX = this._pointA.x - this._pointB.x;
                    const distY = this._pointA.y - this._pointB.y;
                    const pinchSquaredDistance = distX * distX + distY * distY;

                    const multiTouchPanPosition: MultiTouchPoint = {
                        x: (this._pointA.x + this._pointB.x) / 2,
                        y: (this._pointA.y + this._pointB.y) / 2,
                        pointerId: evt.pointerId,
                        type: p.type,
                    };

                    this._shouldStartPinchZoom =
                        this._twoFingerActivityCount < 20 &&
                        Math.abs(Math.sqrt(pinchSquaredDistance) - Math.sqrt(previousPinchSquaredDistance)) > 10;

                    this.onMultiTouch(
                        this._pointA,
                        this._pointB,
                        previousPinchSquaredDistance,
                        pinchSquaredDistance,
                        previousMultiTouchPanPosition,
                        multiTouchPanPosition
                    );

                    previousMultiTouchPanPosition = multiTouchPanPosition;
                    previousPinchSquaredDistance = pinchSquaredDistance;
                }
            }
        };

        this._observer = this.camera
            .getScene()
            ._inputManager._addCameraPointerObserver(
                this._pointerInput,
                PointerEventTypes.POINTERDOWN |
                    PointerEventTypes.POINTERUP |
                    PointerEventTypes.POINTERMOVE |
                    PointerEventTypes.POINTERDOUBLETAP
            );

        this._onLostFocus = () => {
            this._pointA = this._pointB = null;
            previousPinchSquaredDistance = 0;
            previousMultiTouchPanPosition = null;
            this._isPinching = false;
            this._twoFingerActivityCount = 0;
            this._inertialRotationX = 0;
            this._inertialRotationY = 0;
            this._inertialDistance = 0;
            this._inertialPanningX = 0;
            this._inertialPanningY = 0;
        };

        this._contextMenuBind = (evt: Event) => this.onContextMenu(evt as MouseEvent);

        if (element) {
            element.addEventListener('contextmenu', this._contextMenuBind, false);
        }

        const hostWindow = this.camera.getScene().getEngine().getHostWindow();
        if (hostWindow) {
            Tools.RegisterTopRootEvents(hostWindow, [{ name: 'blur', handler: this._onLostFocus }]);
        }
    }

    /**
     * 解绑控制
     */
    public detachControl(): void {
        if (this._onLostFocus) {
            const hostWindow = this.camera.getScene().getEngine().getHostWindow();
            if (hostWindow) {
                Tools.UnregisterTopRootEvents(hostWindow, [{ name: 'blur', handler: this._onLostFocus }]);
            }
        }

        if (this._observer) {
            this.camera.getScene()._inputManager._removeCameraPointerObserver(this._observer);
            this._observer = null;
            if (this._contextMenuBind) {
                const inputElement = this.camera.getScene().getEngine().getInputElement();
                if (inputElement) {
                    inputElement.removeEventListener('contextmenu', this._contextMenuBind);
                }
            }
            this._onLostFocus = null;
        }

        this._altKey = false;
        this._ctrlKey = false;
        this._metaKey = false;
        this._shiftKey = false;
        this._buttonsPressed = 0;
        this._currentMousePointerIdDown = -1;
    }

    /**
     * 将俯仰角限制在安全范围内
     */
    private _clampPitch(): void {
        if (this.camera.rotation.x < PITCH_LOWER_LIMIT) {
            this.camera.rotation.x = PITCH_LOWER_LIMIT;
        } else if (this.camera.rotation.x > PITCH_UPPER_LIMIT) {
            this.camera.rotation.x = PITCH_UPPER_LIMIT;
        }
    }

    /**
     * 应用旋转，确保旋转中心为场景原点
     * 核心逻辑：临时将 target 设为原点进行旋转计算，然后恢复平移偏移
     */
    private _applyRotation(deltaX: number, deltaY: number): void {
        MmdCameraPointersInput._TmpSavedTarget.copyFrom(this.camera.target);

        this.camera.target.copyFrom(MmdCameraPointersInput._TmpOrigin);

        this.camera.rotation.x += deltaX;
        this.camera.rotation.y += deltaY;
        this._clampPitch();
        this.camera.updatePosition();

        this.camera.target.copyFrom(MmdCameraPointersInput._TmpSavedTarget);
        this.camera.position.addInPlace(MmdCameraPointersInput._TmpSavedTarget);
    }

    /**
     * 应用距离变化，确保旋转中心为场景原点
     */
    private _applyDistance(delta: number): void {
        MmdCameraPointersInput._TmpSavedTarget.copyFrom(this.camera.target);

        this.camera.target.copyFrom(MmdCameraPointersInput._TmpOrigin);

        this.camera.distance += delta;
        if (this.camera.distance > -this.minDistance) {
            this.camera.distance = -this.minDistance;
        }
        this.camera.updatePosition();

        this.camera.target.copyFrom(MmdCameraPointersInput._TmpSavedTarget);
        this.camera.position.addInPlace(MmdCameraPointersInput._TmpSavedTarget);
    }

    /**
     * 应用平移，更新平移偏移量
     * 使用相机的旋转矩阵来计算正确的右方向和上方向
     */
    private _applyPanning(panX: number, panY: number): void {
        Matrix.RotationYawPitchRollToRef(
            -this.camera.rotation.y,
            -this.camera.rotation.x,
            -this.camera.rotation.z,
            MmdCameraPointersInput._TmpRotationMatrix
        );

        const m = MmdCameraPointersInput._TmpRotationMatrix;
        const right = MmdCameraPointersInput._TmpRight;
        const up = MmdCameraPointersInput._TmpUp;

        right.set(m.m[0], m.m[1], m.m[2]);
        up.set(m.m[4], m.m[5], m.m[6]);

        this._panningOffset.addInPlace(right.scaleToRef(panX, MmdCameraPointersInput._TmpScaledVec));
        this._panningOffset.addInPlace(up.scaleToRef(panY, MmdCameraPointersInput._TmpScaledVec));

        this.camera.target.copyFrom(this._panningOffset);
        this.camera.updatePosition();
    }

    /**
     * 检查输入并应用惯性
     */
    public checkInputs(): void {
        if (!this.inertiaEnabled) {
            return;
        }

        // 应用旋转惯性
        if (Math.abs(this._inertialRotationX) > 0.001 || Math.abs(this._inertialRotationY) > 0.001) {
            this._applyRotation(this._inertialRotationX, this._inertialRotationY);

            this._inertialRotationX *= this.inertia;
            this._inertialRotationY *= this.inertia;

            if (Math.abs(this._inertialRotationX) < 0.001) this._inertialRotationX = 0;
            if (Math.abs(this._inertialRotationY) < 0.001) this._inertialRotationY = 0;
        }

        // 应用距离惯性（缩放）
        if (Math.abs(this._inertialDistance) > 0.01) {
            this._applyDistance(this._inertialDistance);

            this._inertialDistance *= this.inertia;

            if (Math.abs(this._inertialDistance) < 0.01) this._inertialDistance = 0;
        }

        // 应用平移惯性
        if (Math.abs(this._inertialPanningX) > 0.001 || Math.abs(this._inertialPanningY) > 0.001) {
            this._applyPanning(this._inertialPanningX, this._inertialPanningY);

            this._inertialPanningX *= this.inertia;
            this._inertialPanningY *= this.inertia;

            if (Math.abs(this._inertialPanningX) < 0.001) this._inertialPanningX = 0;
            if (Math.abs(this._inertialPanningY) < 0.001) this._inertialPanningY = 0;
        }
    }

    /**
     * 单点触摸/鼠标移动处理
     */
    public onTouch(point: PointerPoint | null, offsetX: number, offsetY: number): void {
        const isPanning = this._ctrlKey || this._isPanClick;

        if (isPanning && this.panningSensibility !== 0) {
            const panX = -offsetX / this.panningSensibility;
            const panY = offsetY / this.panningSensibility;

            if (this.inertiaEnabled) {
                this._inertialPanningX += panX;
                this._inertialPanningY += panY;
            } else {
                this._applyPanning(panX, panY);
            }
        } else {
            const rotX = -offsetY / this.angularSensibilityY;
            const rotY = -offsetX / this.angularSensibilityX;

            if (this.inertiaEnabled) {
                this._inertialRotationX += rotX;
                this._inertialRotationY += rotY;
            } else {
                this._applyRotation(rotX, rotY);
            }
        }
    }

    /**
     * 多点触摸处理（双指缩放和平移）
     */
    public onMultiTouch(
        _pointA: PointerPoint | null,
        _pointB: PointerPoint | null,
        previousPinchSquaredDistance: number,
        pinchSquaredDistance: number,
        previousMultiTouchPanPosition: MultiTouchPoint | null,
        multiTouchPanPosition: MultiTouchPoint | null
    ): void {
        if (previousPinchSquaredDistance === 0 && previousMultiTouchPanPosition === null) {
            return;
        }

        if (pinchSquaredDistance === 0 && multiTouchPanPosition === null) {
            this._isPinching = false;
            this._twoFingerActivityCount = 0;
            return;
        }

        if (this.multiTouchPanAndZoom) {
            this._computePinchZoom(previousPinchSquaredDistance, pinchSquaredDistance);
            this._computeMultiTouchPanning(previousMultiTouchPanPosition, multiTouchPanPosition);
        } else if (this.multiTouchPanning && this.pinchZoom) {
            this._twoFingerActivityCount++;
            if (this._isPinching || this._shouldStartPinchZoom) {
                this._computePinchZoom(previousPinchSquaredDistance, pinchSquaredDistance);
                this._isPinching = true;
            } else {
                this._computeMultiTouchPanning(previousMultiTouchPanPosition, multiTouchPanPosition);
            }
        } else if (this.multiTouchPanning) {
            this._computeMultiTouchPanning(previousMultiTouchPanPosition, multiTouchPanPosition);
        } else if (this.pinchZoom) {
            this._computePinchZoom(previousPinchSquaredDistance, pinchSquaredDistance);
        }
    }

    /**
     * 计算双指缩放
     */
    private _computePinchZoom(previousPinchSquaredDistance: number, pinchSquaredDistance: number): void {
        if (this.pinchPrecision === 0) return;

        const delta =
            (pinchSquaredDistance - previousPinchSquaredDistance) /
            (this.pinchPrecision * (this.pinchInwards ? 1 : -1) * (this.angularSensibilityX + this.angularSensibilityY));

        if (this.inertiaEnabled) {
            this._inertialDistance += delta;
        } else {
            this._applyDistance(delta);
        }
    }

    /**
     * 计算双指平移
     */
    private _computeMultiTouchPanning(
        previousMultiTouchPanPosition: MultiTouchPoint | null,
        multiTouchPanPosition: MultiTouchPoint | null
    ): void {
        if (this.panningSensibility === 0 || !previousMultiTouchPanPosition || !multiTouchPanPosition) {
            return;
        }

        const moveDeltaX = multiTouchPanPosition.x - previousMultiTouchPanPosition.x;
        const moveDeltaY = multiTouchPanPosition.y - previousMultiTouchPanPosition.y;

        const panX = -moveDeltaX / this.panningSensibility;
        const panY = moveDeltaY / this.panningSensibility;

        if (this.inertiaEnabled) {
            this._inertialPanningX += panX;
            this._inertialPanningY += panY;
        } else {
            this._applyPanning(panX, panY);
        }
    }

    /**
     * 双击处理 - 重置到默认视角
     */
    public onDoubleTap(_type: string): void {
        this._panningOffset.set(0, 0, 0);
        this.camera.target.copyFromFloats(0, 0, 0);
        this.camera.rotation.set(-0.22, 0, 0);
        this.camera.distance = -45;
        this.camera.updatePosition();

        this._inertialRotationX = 0;
        this._inertialRotationY = 0;
        this._inertialDistance = 0;
        this._inertialPanningX = 0;
        this._inertialPanningY = 0;
    }

    /**
     * 右键菜单处理
     */
    public onContextMenu(evt: MouseEvent): void {
        evt.preventDefault();
    }

    /**
     * 鼠标按下处理
     */
    public onButtonDown(evt: PointerEvent): void {
        this._isPanClick = evt.button === 1;
    }

    /**
     * 鼠标释放处理
     */
    public onButtonUp(_evt: PointerEvent): void {
        this._isPanClick = false;
        this._isPinching = false;
        this._twoFingerActivityCount = 0;
    }

    /**
     * 获取当前平移偏移量
     */
    public getPanningOffset(): Vector3 {
        return this._panningOffset;
    }

    /**
     * 设置平移偏移量
     */
    public setPanningOffset(offset: Vector3): void {
        this._panningOffset.copyFrom(offset);
        this.camera.target.copyFrom(this._panningOffset);
        this.camera.updatePosition();
    }

    /**
     * 获取类名
     */
    public getClassName(): string {
        return 'MmdCameraPointersInput';
    }

    /**
     * 获取简单名称
     */
    public getSimpleName(): string {
        return 'pointers';
    }
}
