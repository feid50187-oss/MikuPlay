import { Matrix, Scene, Vector3 } from '@babylonjs/core';
import type { MmdCamera } from 'babylon-mmd/esm/Runtime/mmdCamera';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';
import type { VmdLoader } from 'babylon-mmd/esm/Loader/vmdLoader';
import { MmdCameraInputManager } from './MmdCameraInputManager';
import { detectVmdType, VmdType } from '../../utils/fileValidation';
import { fetchFileAsArrayBuffer } from '../../utils/platform';
import { eventBus, Events } from '../../core';

export interface CameraAnimationInfo {
    id: string;
    name: string;
    filePath: string;
    mmdAnimation: MmdAnimation | null;
}

export class CameraManager {
    private scene: Scene;
    private mainCamera: MmdCamera;
    private vmdLoader: VmdLoader | null = null;
    private currentAnimation: CameraAnimationInfo | null = null;
    private runtimeAnimationHandle: any | null = null;

    private isPlaying: boolean = false;

    /** 相机目标点偏移量（米） */
    private targetOffset: Vector3 = new Vector3(0, 0, 0);

    /** 防入地钳制开关（默认关闭） */
    private clampToGround: boolean = false;

    /** 地面高度（钳制下限，米），当前固定为 0 */
    private readonly groundHeight: number = 0;

    // 预分配临时对象，避免每帧分配
    private static readonly _TmpMatrix = new Matrix();
    private static readonly _TmpOffset = new Vector3();

    /** 相机输入管理器 */
    private inputManager: MmdCameraInputManager;

    /** 保存的初始相机状态，用于删除动画后恢复 */
    private initialTarget: Vector3;
    private initialRotation: Vector3;
    private initialDistance: number;

    constructor(scene: Scene, mainCamera: MmdCamera) {
        this.scene = scene;
        this.mainCamera = mainCamera;
        // this.mainCamera.minZ = 0.1;
        // this.mainCamera.maxZ = 1000;

        // 保存初始相机状态
        this.initialTarget = mainCamera.target.clone();
        this.initialRotation = mainCamera.rotation.clone();
        this.initialDistance = mainCamera.distance;

        this.inputManager = new MmdCameraInputManager(mainCamera);
        this.initialize();
    }

    private async initialize(): Promise<void> {
        const { VmdLoader } = await import('babylon-mmd/esm/Loader/vmdLoader');
        this.vmdLoader = new VmdLoader(this.scene);
        this.vmdLoader.loggingEnabled = true;
    }

    /**
     * 加载相机动画
     */
    public async loadCameraAnimation(filePath: string, fileName: string): Promise<CameraAnimationInfo> {
        if (!this.vmdLoader) {
            throw new Error('VMD加载器未初始化');
        }

        const animationId = `camera_anim_${Date.now()}`;

        const buffer = await fetchFileAsArrayBuffer(filePath);

        const vmdType = detectVmdType(buffer);
        if (vmdType !== VmdType.Camera) {
            throw new Error('所选文件为模型动作，请使用「动作导入」功能');
        }

        const mmdAnimation = await this.vmdLoader.loadFromBufferAsync(
            animationId,
            buffer
        );

        const animationInfo: CameraAnimationInfo = {
            id: animationId,
            name: fileName,
            filePath,
            mmdAnimation
        };

        this.currentAnimation = animationInfo;

        await this.bindAnimationToCamera();

        eventBus.emit(Events.CAMERA_ANIMATION_LOADED, { id: animationInfo.id, name: animationInfo.name });

        return animationInfo;
    }

    /**
     * 绑定动画到相机
     */
    private async bindAnimationToCamera(): Promise<void> {
        if (!this.currentAnimation?.mmdAnimation) {
            return;
        }

        if (this.runtimeAnimationHandle) {
            this.mainCamera.destroyRuntimeAnimation(this.runtimeAnimationHandle);
            this.runtimeAnimationHandle = null;
        }

        this.runtimeAnimationHandle = this.mainCamera.createRuntimeAnimation(
            this.currentAnimation.mmdAnimation
        );

        this.mainCamera.setRuntimeAnimation(this.runtimeAnimationHandle);

        this.mainCamera.animate(0);
        this.applyTargetOffset();
    }

    /**
     * 启用相机手动控制
     */
    public enableManualControl(): void {
        this.inputManager.attachControl();
    }

    /**
     * 禁用相机手动控制
     */
    public disableManualControl(): void {
        this.inputManager.detachControl();
    }

    /**
     * 获取相机输入管理器
     */
    public getInputManager(): MmdCameraInputManager {
        return this.inputManager;
    }

    /**
     * 开始播放动画（预览模式，不禁用相机控制）
     */
    public startAnimation(): void {
        this.isPlaying = true;
    }

    /**
     * 暂停动画
     */
    public pauseAnimation(): void {
        this.isPlaying = false;
    }

    /**
     * 停止动画
     */
    public stopAnimation(): void {
        this.isPlaying = false;

        if (this.runtimeAnimationHandle) {
            this.mainCamera.animate(0);
            this.applyTargetOffset();
        }
    }

    /**
     * 更新相机动画（由动画管理器每帧调用）
     * @param mmdFrameTime MMD 帧号（30fps），直接传递给 MmdCamera.animate()
     */
    public updateAnimation(mmdFrameTime: number): void {
        if (!this.isPlaying) {
            return;
        }

        if (this.mainCamera.currentAnimation) {
            this.mainCamera.animate(mmdFrameTime);
            this.applyTargetOffset();
        }
    }

    /**
     * 更新相机动画（离线渲染专用，不检查播放状态）
     * @param mmdFrameTime MMD 帧号（30fps），直接传递给 MmdCamera.animate()
     */
    public updateAnimationForRender(mmdFrameTime: number): void {
        if (this.mainCamera.currentAnimation) {
            this.mainCamera.animate(mmdFrameTime);
            this.applyTargetOffset();
        }
    }

    /**
     * 删除相机动画
     */
    public deleteCameraAnimation(): boolean {
        const removedAnimation = this.currentAnimation;
        if (!removedAnimation) {
            return false;
        }

        this.stopAnimation();

        if (this.runtimeAnimationHandle) {
            this.mainCamera.destroyRuntimeAnimation(this.runtimeAnimationHandle);
            this.mainCamera.setRuntimeAnimation(null);
        }

        this.runtimeAnimationHandle = null;
        this.currentAnimation = null;

        // 恢复相机到初始状态，避免动画残留的姿态导致后续播放异常
        this.restoreInitialCameraState();

        eventBus.emit(Events.CAMERA_ANIMATION_REMOVED, { id: removedAnimation.id, name: removedAnimation.name });

        return true;
    }

    /**
     * 获取当前动画信息
     */
    public getCurrentAnimation(): CameraAnimationInfo | null {
        return this.currentAnimation;
    }

    /**
     * 是否有相机动画
     */
    public hasCameraAnimation(): boolean {
        return this.currentAnimation !== null;
    }

    /**
     * 是否正在播放
     */
    public isAnimationPlaying(): boolean {
        return this.isPlaying;
    }

    /**
     * 获取主相机
     */
    public getMainCamera(): MmdCamera {
        return this.mainCamera;
    }

    /**
     * 获取MMD相机（兼容旧接口）
     */
    public getMmdCamera(): MmdCamera {
        return this.mainCamera;
    }

    /**
     * 设置相机目标点偏移量
     * @param x X轴偏移（米）
     * @param y Y轴偏移（米）
     * @param z Z轴偏移（米）
     */
    public setTargetOffset(x: number, y: number, z: number): void {
        this.targetOffset.set(x, y, z);
        if (!this.isPlaying && this.mainCamera.currentAnimation) {
            this.mainCamera.animate(0);
            this.applyTargetOffset();
        }
    }

    /**
     * 获取相机目标点偏移量
     */
    public getTargetOffset(): Vector3 {
        return this.targetOffset;
    }

    /**
     * 设置防入地钳制开关
     * 开启后，相机微调将实时钳制人眼高度，避免调整后的视角在动画某帧入地
     * @param enabled 是否启用钳制
     */
    public setClampToGround(enabled: boolean): void {
        this.clampToGround = enabled;
        // 立即按当前状态重新应用偏移，使钳制即时生效
        if (!this.isPlaying && this.mainCamera.currentAnimation) {
            this.mainCamera.animate(0);
            this.applyTargetOffset();
        }
    }

    /**
     * 是否启用防入地钳制
     */
    public isClampToGroundEnabled(): boolean {
        return this.clampToGround;
    }

    /**
     * 应用目标点偏移到相机
     */
    private applyTargetOffset(): void {
        this.mainCamera.target.x += this.targetOffset.x;
        this.mainCamera.target.y += this.targetOffset.y;
        this.mainCamera.target.z += this.targetOffset.z;

        // 开启钳制时，实时保证人眼高度不低于地面（防入地）
        if (this.clampToGround) {
            // 人眼 = target + 当前帧旋转/距离决定的相对偏移（与 target 无关）
            const eyeOffsetY = this.computeEyeOffsetY();
            // 要求 eye.y = target.y + eyeOffsetY >= groundHeight
            const minTargetY = this.groundHeight - eyeOffsetY;
            if (this.mainCamera.target.y < minTargetY) {
                this.mainCamera.target.y = minTargetY;
            }
        }
    }

    /**
     * 计算当前帧相机相对目标点的人眼 Y 偏移
     * 复用 MmdCamera 的坐标变换：eye = target + RYPR(-rot) * (0,0,distance)
     * @returns 人眼相对 target 的 Y 分量
     */
    private computeEyeOffsetY(): number {
        const rotation = this.mainCamera.rotation;
        const distance = this.mainCamera.distance;
        Matrix.RotationYawPitchRollToRef(
            -rotation.y,
            -rotation.x,
            -rotation.z,
            CameraManager._TmpMatrix
        );
        return Vector3.TransformCoordinatesFromFloatsToRef(
            0, 0, distance, CameraManager._TmpMatrix, CameraManager._TmpOffset
        ).y;
    }

    /**
     * 恢复相机到初始状态（构造时的 target/rotation/distance）
     */
    private restoreInitialCameraState(): void {
        this.mainCamera.target.copyFrom(this.initialTarget);
        this.mainCamera.rotation.copyFrom(this.initialRotation);
        this.mainCamera.distance = this.initialDistance;
        this.mainCamera.updatePosition();
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.deleteCameraAnimation();

        if (this.inputManager) {
            this.inputManager.dispose();
        }

        if (this.vmdLoader) {
            this.vmdLoader = null;
        }
    }
}
