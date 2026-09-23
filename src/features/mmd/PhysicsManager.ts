import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { MultiPhysicsRuntime } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/Impl/multiPhysicsRuntime';
import type { RigidBody } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody';
import { PhysicsEngineType } from './PhysicsEngineTypes';
import { PhysicsEngineFactory } from './PhysicsEngineFactory';

//负责物理引擎的完整生命周期管理：WASM实例创建、物理运行时初始化、地面碰撞体、重力/精度控制。
export class PhysicsManager {
    private static instance: PhysicsManager;

    private scene: Scene;
    private physicsRuntime: MultiPhysicsRuntime | null = null;
    private wasmInstance: any | null = null;
    private initializationPromise: Promise<void> | null = null;

    private _groundBody: RigidBody | null = null;
    private _groundCollisionEnabled: boolean = true;

    private constructor(scene: Scene) {
        this.scene = scene;
        this.initializationPromise = this.initialize();
    }

    public static getInstance(scene?: Scene): PhysicsManager {
        if (!PhysicsManager.instance) {
            if (!scene) {
                throw new Error('PhysicsManager: 首次调用 getInstance 必须提供 Scene 参数');
            }
            PhysicsManager.instance = new PhysicsManager(scene);
        }
        return PhysicsManager.instance;
    }

    public static hasInstance(): boolean {
        return !!PhysicsManager.instance;
    }

    public static resetInstance(): void {
        if (PhysicsManager.instance) {
            PhysicsManager.instance.dispose();
        }
        PhysicsManager.instance = undefined as any;
    }

    public async waitForInitialization(): Promise<void> {
        if (this.initializationPromise) {
            await this.initializationPromise;
        }
    }

    //region Initialization

    private async initialize(): Promise<void> {
        const engineType = PhysicsEngineFactory.getInstance().currentType;

        if (engineType === PhysicsEngineType.MmdWasmInstanceTypeSPR) {
            const { GetMmdWasmInstance } = await import('babylon-mmd/esm/Runtime/Optimized/mmdWasmInstance');
            const { MmdWasmInstanceTypeSPR } = await import('babylon-mmd/esm/Runtime/Optimized/InstanceType/singlePhysicsRelease');
            const { MultiPhysicsRuntime } = await import('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/Impl/multiPhysicsRuntime');

            this.wasmInstance = await GetMmdWasmInstance(new MmdWasmInstanceTypeSPR());
            this.physicsRuntime = new MultiPhysicsRuntime(this.wasmInstance);
            this.physicsRuntime.setGravity(new Vector3(0, -9.8 * 10, 0)); //MMD重力是标准的10倍
            this.physicsRuntime.register(this.scene);

            await this.buildGroundCollider();
        } else {
            // RezePhysics 模式：不初始化 WASM 运行时
            console.log('PhysicsManager: 使用 RezePhysics 模式，跳过 WASM 初始化');
        }
    }

    //endregion

    //region Ground Collider

    public async createGroundCollider(): Promise<void> {
        if (!this.physicsRuntime || !this.wasmInstance) {
            console.warn('PhysicsManager: 物理引擎未初始化，无法创建地面碰撞体');
            return;
        }
        await this.buildGroundCollider();
    }

    private async buildGroundCollider(): Promise<void> {
        if (!this.physicsRuntime || !this.wasmInstance) {
            return;
        }

        try {
            const { MotionType } = await import('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/motionType');
            const { PhysicsStaticPlaneShape } = await import('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/physicsShape');
            const { RigidBody } = await import('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBody');
            const { RigidBodyConstructionInfo } = await import('babylon-mmd/esm/Runtime/Optimized/Physics/Bind/rigidBodyConstructionInfo');

            const info = new RigidBodyConstructionInfo(this.wasmInstance);
            info.motionType = MotionType.Static;
            info.shape = new PhysicsStaticPlaneShape(this.physicsRuntime, new Vector3(0, 1, 0), 0);
            info.collisionGroup = 0xFFFF;
            info.collisionMask = 0xFFFF; //与所有碰撞组发生碰撞
            const groundBody = new RigidBody(this.physicsRuntime, info);
            this.physicsRuntime.addRigidBodyToGlobal(groundBody);
            this._groundBody = groundBody;
            this._groundCollisionEnabled = true;

            console.log('地面碰撞体创建成功');
        } catch (error) {
            console.error('创建地面碰撞体失败:', error);
        }
    }

    /**
     * 设置地面碰撞是否启用（通过添加/移除刚体实现）
     * @param enabled 是否启用地面碰撞
     */
    public setGroundCollisionEnabled(enabled: boolean): void {
        if (!this._groundBody || !this.physicsRuntime) {
            console.warn('PhysicsManager: 地面碰撞体未创建，无法修改碰撞掩码');
            return;
        }

        if (enabled === this._groundCollisionEnabled) return;

        if (enabled) {
            this.physicsRuntime.addRigidBodyToGlobal(this._groundBody);
            console.log('地面碰撞已启用（collisionMask = 0xFFFF）');
        } else {
            this.physicsRuntime.removeRigidBodyFromGlobal(this._groundBody);
            console.log('地面碰撞已禁用（collisionMask = 0）');
        }
        this._groundCollisionEnabled = enabled;
    }

    /**
     * 获取地面碰撞当前是否启用
     */
    public isGroundCollisionEnabled(): boolean {
        return this._groundCollisionEnabled;
    }

    //endregion

    //region Physics Control

    /**
     * 启用或禁用指定模型的物理模拟
     * @param mmdModel MmdModel 实例
     * @param enabled true启用物理，false禁用物理
     */
    public async enablePhysics(mmdModel: MmdModel, enabled: boolean): Promise<void> {
        await this.waitForInitialization();

        // 设置 rigidBodyStates: 1 = Dynamic (启用), 0 = Kinematic (禁用)
        const state = enabled ? 1 : 0;
        mmdModel.rigidBodyStates.fill(state);

        // 提交状态到物理运行时
        if (this.physicsRuntime && 'commitBodyStates' in this.physicsRuntime) {
            (this.physicsRuntime as any).commitBodyStates(mmdModel.rigidBodyStates);
        }
    }

    /**
     * 检查指定模型的物理是否启用
     * @param mmdModel MmdModel 实例
     */
    public isPhysicsEnabled(mmdModel: MmdModel): boolean {
        return mmdModel.rigidBodyStates.length > 0 && mmdModel.rigidBodyStates[0] === 1;
    }

    /**
     * 设置全局重力
     * @param x X轴重力分量
     * @param y Y轴重力分量（通常为负值，如-98）
     * @param z Z轴重力分量
     */
    public async setGravity(x: number, y: number, z: number): Promise<void> {
        await this.waitForInitialization();

        const engineType = PhysicsEngineFactory.getInstance().currentType;

        if (engineType === PhysicsEngineType.MmdWasmInstanceTypeSPR && this.physicsRuntime) {
            // Bullet 引擎：设置物理运行时的重力
            this.physicsRuntime.setGravity(new Vector3(x, y, z));
        } else if (engineType === PhysicsEngineType.RezePhysics) {
            // RezePhysics 引擎：通过静态方法设置重力（修改复用缓冲，无 GC 压力）
            const { RezeMmdPhysics } = await import('./physics/RezeMmdPhysics');
            RezeMmdPhysics.setGravity(x, y, z);
        }
    }

    /**
     * 获取当前重力设置
     */
    public getGravity(): Vector3 | null {
        if (this.physicsRuntime && 'gravity' in this.physicsRuntime) {
            return (this.physicsRuntime as any).gravity;
        }
        return null;
    }

    /**
     * 设置物理模拟精度参数
     * @param maxSubSteps 最大子步数
     * @param fixedTimeStep 固定时间步长（秒）
     */
    public setPhysicsPrecision(maxSubSteps: number, fixedTimeStep: number): void {
        if (!this.physicsRuntime) {
            console.warn('PhysicsManager: 物理运行时未初始化，无法设置精度参数');
            return;
        }

        this.physicsRuntime.maxSubSteps = maxSubSteps;
        this.physicsRuntime.fixedTimeStep = fixedTimeStep;

        console.log(`物理精度已设置: maxSubSteps=${maxSubSteps}, fixedTimeStep=${fixedTimeStep.toFixed(5)} (${(1 / fixedTimeStep).toFixed(0)} FPS)`);
    }

    /**
     * 获取当前物理模拟精度参数
     * @returns 当前精度设置 {maxSubSteps, fixedTimeStep}
     */
    public getPhysicsPrecision(): { maxSubSteps: number; fixedTimeStep: number } | null {
        if (!this.physicsRuntime) {
            return null;
        }

        return {
            maxSubSteps: this.physicsRuntime.maxSubSteps,
            fixedTimeStep: this.physicsRuntime.fixedTimeStep
        };
    }

    //endregion

    //region Public Accessors

    /**
     * 获取物理运行时实例
     */
    public getPhysicsRuntime(): MultiPhysicsRuntime | null {
        return this.physicsRuntime;
    }

    //endregion

    //region Resource Cleanup

    public dispose(): void {
        if (this.physicsRuntime) {
            if (this._groundBody) {
                try {
                    this.physicsRuntime.removeRigidBodyFromGlobal(this._groundBody);
                } catch (error) {
                    console.warn('PhysicsManager: 清除地面碰撞体失败:', error);
                }
                this._groundBody = null;
            }
            this.physicsRuntime = null;
        }

        this.wasmInstance = null;
        this._groundCollisionEnabled = true;
        this.initializationPromise = null;
    }

    //endregion
}
