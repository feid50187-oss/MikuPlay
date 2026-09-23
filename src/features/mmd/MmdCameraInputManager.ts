
import type { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';
import { MmdCameraPointersInput } from './MmdCameraPointersInput';
import { MmdCameraMouseWheelInput } from './MmdCameraMouseWheelInput';

/**
 * MMD 相机输入管理器
 * 统一管理 MmdCamera 的指针输入和滚轮输入
 */
export class MmdCameraInputManager {
    /** 关联的相机 */
    private camera: MmdCamera;

    /** 指针输入控制器 */
    private pointersInput: MmdCameraPointersInput;

    /** 滚轮输入控制器 */
    private mouseWheelInput: MmdCameraMouseWheelInput;

    /** 是否已绑定控制 */
    private attached: boolean = false;

    /** 渲染前观察器 */
    private _beforeRenderObserver: any = null;

    constructor(camera: MmdCamera) {
        this.camera = camera;
        this.pointersInput = new MmdCameraPointersInput();
        this.pointersInput.camera = camera;
        this.mouseWheelInput = new MmdCameraMouseWheelInput();
        this.mouseWheelInput.camera = camera;
    }

    /**
     * 绑定控制到 DOM 元素
     * @param noPreventDefault 是否阻止默认事件
     */
    public attachControl(noPreventDefault?: boolean): void {
        if (this.attached) {
            return;
        }

        this.pointersInput.attachControl(noPreventDefault);
        this.mouseWheelInput.attachControl(noPreventDefault);

        // 注册渲染前回调以处理惯性
        this._beforeRenderObserver = this.camera.getScene().onBeforeRenderObservable.add(() => {
            this.pointersInput.checkInputs();
            this.mouseWheelInput.checkInputs();
        });

        this.attached = true;
    }

    /**
     * 解绑控制
     */
    public detachControl(): void {
        if (!this.attached) {
            return;
        }

        this.pointersInput.detachControl();
        this.mouseWheelInput.detachControl();

        if (this._beforeRenderObserver) {
            this.camera.getScene().onBeforeRenderObservable.remove(this._beforeRenderObserver);
            this._beforeRenderObserver = null;
        }

        this.attached = false;
    }

    /**
     * 获取指针输入控制器
     */
    public getPointersInput(): MmdCameraPointersInput {
        return this.pointersInput;
    }

    /**
     * 获取滚轮输入控制器
     */
    public getMouseWheelInput(): MmdCameraMouseWheelInput {
        return this.mouseWheelInput;
    }

    /**
     * 设置旋转灵敏度
     * @param x X轴灵敏度
     * @param y Y轴灵敏度
     */
    public setAngularSensibility(x: number, y: number): void {
        this.pointersInput.angularSensibilityX = x;
        this.pointersInput.angularSensibilityY = y;
    }

    /**
     * 设置平移灵敏度
     * @param sensibility 灵敏度值
     */
    public setPanningSensibility(sensibility: number): void {
        this.pointersInput.panningSensibility = sensibility;
    }

    /**
     * 设置缩放灵敏度
     * @param precision 缩放灵敏度
     */
    public setPinchPrecision(precision: number): void {
        this.pointersInput.pinchPrecision = precision;
        this.mouseWheelInput.wheelPrecision = precision;
    }

    /**
     * 设置是否启用惯性
     * @param enabled 是否启用
     */
    public setInertiaEnabled(enabled: boolean): void {
        this.pointersInput.inertiaEnabled = enabled;
        this.mouseWheelInput.inertiaEnabled = enabled;
    }

    /**
     * 设置惯性系数
     * @param inertia 惯性系数 (0-1)
     */
    public setInertia(inertia: number): void {
        this.pointersInput.inertia = inertia;
        this.mouseWheelInput.inertia = inertia;
    }

    /**
     * 设置最近距离
     * @param minDistance 最近距离（相机到目标点的最小距离）
     */
    public setMinDistance(minDistance: number): void {
        this.pointersInput.minDistance = minDistance;
        this.mouseWheelInput.minDistance = minDistance;
    }

    /**
     * 是否已绑定控制
     */
    public isAttached(): boolean {
        return this.attached;
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.detachControl();
    }
}
