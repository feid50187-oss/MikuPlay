import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Nullable } from '@babylonjs/core/types';
import type { PmxObject } from 'babylon-mmd/esm/Loader/Parser/pmxObject';
import type { ILogger } from 'babylon-mmd/esm/Loader/Parser/ILogger';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import type { IMmdModelPhysicsCreationOptions } from 'babylon-mmd/esm/Runtime/mmdRuntime';
import type { IMmdPhysics, IMmdPhysicsModel } from 'babylon-mmd/esm/Runtime/Physics/IMmdPhysics';
import { Mat4, Vec3 } from './math';
import { RezePhysics } from './physics';
import { RigidbodyShape, RigidbodyType } from './types';
import type { Joint, Rigidbody } from './types';

// PMX 物理模式：0 = FollowBone（跟骨），1 = Physics（纯物理），2 = PhysicsWithBone（位置跟骨 + 旋转物理）
const PMX_PHYSICS_MODE_FOLLOW_BONE = 0;
const PMX_PHYSICS_MODE_PHYSICS_WITH_BONE = 2;
// PMX 形状：0 = Sphere，1 = Box，2 = Capsule
const PMX_SHAPE_TYPE_SPHERE = 0;
const PMX_SHAPE_TYPE_BOX = 1;

// 每帧复用重力缓冲，避免 GC 压力
const _gravity = new Vec3(0, -98, 0);

/**
 * RezePhysics 物理引擎的 babylon-mmd 适配器（IMmdPhysics 实现）。
 *
 * 设计要点：
 * - 模型空间模拟：骨骼矩阵（worldTransformMatrices 切片）位移为 PMX 单位，
 *   刚体 shapePosition/size/mass/joint.position 全部使用 PMX 原值不缩放，
 *   rootMesh 的 scale 由渲染层统一放大，物理行为与 PMX 原始表现一致。
 * - 渲染链路：`IMmdRuntimeBone.worldMatrix` 就是 `MmdModel.worldTransformMatrices`
 *   的切片视图，RezePhysics.step 直接写 boneWorldMatrices[b].values 即写渲染矩阵，
 *   因此 syncBodies/syncBones 均为 no-op。
 * - 时序：按 Scene 注册单个共享 step 回调（onBeforeRenderObservable insertFirst），
 *   每帧只取一次全局状态后驱动该 Scene 上所有模型，保证在 Babylon physics step
 *   之后、MmdRuntime.afterPhysics 之前执行。
 * - 重力：每帧从 scene.getPhysicsEngine() 同步，PhysicsManager.setGravity 自动生效。
 * - 每个模型独立世界（不实现多世界共享，符合 MMD 默认行为）。
 */
export class RezeMmdPhysics implements IMmdPhysics {
    private readonly _scene: Scene;

    /**
     * 设置手动步进模式（用于离线渲染）
     * 启用时，所有 RezePhysics 模型暂停 onBeforeRenderObservable 驱动
     */
    public static setManualStepMode(enabled: boolean): void {
        RezeMmdPhysicsModel.setManualStepMode(enabled);
    }

    /**
     * 手动步进所有 RezePhysics 模型
     * @param dt 时间步长（秒）
     */
    public static stepAll(dt: number): void {
        RezeMmdPhysicsModel.stepAll(dt);
    }

    /**
     * 检查是否处于手动步进模式
     */
    public static isManualStepMode(): boolean {
        return RezeMmdPhysicsModel.isManualStepMode();
    }

    /**
     * 设置全局重力（性能友好：直接修改复用缓冲，不分配新对象）
     * @param x X轴重力分量
     * @param y Y轴重力分量
     * @param z Z轴重力分量
     */
    public static setGravity(x: number, y: number, z: number): void {
        _gravity.setXYZ(x, y, z);
    }

    /**
     * 设置所有实例的求解迭代次数，控制台实时调整
     * @example 控制台输入：RezeMmdPhysics.setSolverIterations(20)
     */
    public static setSolverIterations(iterations: number): void {
        RezeMmdPhysicsModel.setSolverIterations(iterations);
    }

    /**
     * 获取当前求解迭代次数
     */
    public static getSolverIterations(): number | null {
        return RezeMmdPhysicsModel.getSolverIterations();
    }

    constructor(scene: Scene) {
        this._scene = scene;
    }

    buildPhysics(
        rootMesh: Mesh,
        bones: readonly IMmdRuntimeBone[],
        rigidBodies: PmxObject['rigidBodies'],
        joints: PmxObject['joints'],
        logger: ILogger,
        _physicsOptions: Nullable<IMmdModelPhysicsCreationOptions>
    ): IMmdPhysicsModel {
        // scalingFactor 仅用于告警：模型空间模拟下使用 PMX 原值，无需实际缩放
        const worldMatrix = rootMesh.computeWorldMatrix();
        const worldScale = new Vector3();
        worldMatrix.decompose(worldScale, new Quaternion());
        if (!(Math.abs(worldScale.x - worldScale.y) < 0.001 && Math.abs(worldScale.y - worldScale.z) < 0.001)) {
            logger.warn('MMD physics does not support non-uniform scaling');
        }
        if (worldScale.x !== 1) {
            logger.warn(`MMD physics does not support scaling. scaling factor: ${worldScale.x}`);
        }

        // boneIndex 无效时回退到名称匹配（个别模型 boneIndex 越界）
        const boneNameMap = new Map<string, IMmdRuntimeBone>();
        for (const bone of bones) {
            boneNameMap.set(bone.name, bone);
        }
        const resolveRigidBodyBoneIndex = (boneIndex: number, rigidBody: PmxObject['rigidBodies'][number]): number => {
            if (0 <= boneIndex && boneIndex < bones.length) {
                return boneIndex;
            }
            // -1 是 PMX 合法值（无骨骼刚体，如关节链中间体），引擎核心原生支持。
            // 不做名称回退：刚体名恰好撞上骨骼名时会错误绑定到无关骨骼。
            if (boneIndex === -1) {
                return -1;
            }
            const bone = boneNameMap.get(rigidBody.name) ?? boneNameMap.get(rigidBody.englishName);
            return bone !== undefined ? bones.indexOf(bone) : -1;
        };

        const rigidbodies: Rigidbody[] = [];
        // PMX 刚体索引 → RezePhysics 内部索引（-1 表示转换失败被跳过）
        const rigidbodyIndexMap = new Int32Array(rigidBodies.length).fill(-1);
        for (let i = 0; i < rigidBodies.length; ++i) {
            const rigidBody = rigidBodies[i];
            const boneIndex = resolveRigidBodyBoneIndex(rigidBody.boneIndex, rigidBody);
            // boneIndex === -1 且原始值就是 -1：PMX 合法的无骨骼刚体，保留并正常参与模拟，
            // 否则引用它的 Joint 会因找不到刚体被一并丢弃，导致链上其它骨骼刚体失去锚点（拉丝下坠）。
            // 仅当原始索引越界且名称回退也失败时才跳过。
            if (boneIndex === -1 && rigidBody.boneIndex !== -1) {
                logger.warn(`Failed to find bone for rigid body: ${rigidBody.name}`);
                continue;
            }

            const shapeType = rigidBody.shapeType;
            const shapeSize = rigidBody.shapeSize; // PmxObject.Vec3 是元组 [x, y, z]
            let size: Vec3;
            if (shapeType === PMX_SHAPE_TYPE_SPHERE) {
                // Sphere: size[0] = 半径
                size = new Vec3(shapeSize[0], 0, 0);
            } else if (shapeType === PMX_SHAPE_TYPE_BOX) {
                // Box: 半尺寸
                size = new Vec3(shapeSize[0], shapeSize[1], shapeSize[2]);
            } else {
                // Capsule: size[0] = 半径, size[1] = 高度
                size = new Vec3(shapeSize[0], shapeSize[1], 0);
            }

            const physicsMode = rigidBody.physicsMode;
            const index = rigidbodies.length;
            rigidbodyIndexMap[i] = index;
            rigidbodies.push({
                name: rigidBody.name,
                englishName: rigidBody.englishName,
                boneIndex,
                group: rigidBody.collisionGroup,
                collisionMask: rigidBody.collisionMask,
                shape: shapeType as unknown as RigidbodyShape, // 0/1/2 与 RigidbodyShape 枚举值一致
                size,
                shapePosition: new Vec3(rigidBody.shapePosition[0], rigidBody.shapePosition[1], rigidBody.shapePosition[2]),
                shapeRotation: new Vec3(rigidBody.shapeRotation[0], rigidBody.shapeRotation[1], rigidBody.shapeRotation[2]),
                mass: physicsMode === PMX_PHYSICS_MODE_FOLLOW_BONE ? 0 : rigidBody.mass,
                linearDamping: rigidBody.linearDamping,
                angularDamping: rigidBody.angularDamping,
                restitution: rigidBody.repulsion,
                friction: rigidBody.friction,
                type: physicsMode === PMX_PHYSICS_MODE_FOLLOW_BONE ? RigidbodyType.Static : RigidbodyType.Dynamic,
                // mode-2（PhysicsWithBone）：位置每帧重钉回骨骼，旋转保留模拟
                aligned: physicsMode === PMX_PHYSICS_MODE_PHYSICS_WITH_BONE,
                // 首次 step 时 computeBoneOffsets 会用 boneInverseBindMatrices 重新计算，此处仅占位
                bodyOffsetMatrixInverse: Mat4.identity(),
            });
        }

        const convertedJoints: Joint[] = [];
        for (const joint of joints) {
            const rigidbodyIndexA =
                joint.rigidbodyIndexA >= 0 && joint.rigidbodyIndexA < rigidbodyIndexMap.length
                    ? rigidbodyIndexMap[joint.rigidbodyIndexA]
                    : -1;
            const rigidbodyIndexB =
                joint.rigidbodyIndexB >= 0 && joint.rigidbodyIndexB < rigidbodyIndexMap.length
                    ? rigidbodyIndexMap[joint.rigidbodyIndexB]
                    : -1;
            if (rigidbodyIndexA === -1 || rigidbodyIndexB === -1) {
                logger.warn(`Failed to find rigid body for joint: ${joint.name}`);
                continue;
            }
            convertedJoints.push({
                name: joint.name,
                englishName: joint.englishName,
                type: joint.type,
                rigidbodyIndexA,
                rigidbodyIndexB,
                position: new Vec3(joint.position[0], joint.position[1], joint.position[2]),
                rotation: new Vec3(joint.rotation[0], joint.rotation[1], joint.rotation[2]),
                positionMin: new Vec3(joint.positionMin[0], joint.positionMin[1], joint.positionMin[2]),
                positionMax: new Vec3(joint.positionMax[0], joint.positionMax[1], joint.positionMax[2]),
                rotationMin: new Vec3(joint.rotationMin[0], joint.rotationMin[1], joint.rotationMin[2]),
                rotationMax: new Vec3(joint.rotationMax[0], joint.rotationMax[1], joint.rotationMax[2]),
                springPosition: new Vec3(joint.springPosition[0], joint.springPosition[1], joint.springPosition[2]),
                springRotation: new Vec3(joint.springRotation[0], joint.springRotation[1], joint.springRotation[2]),
            });
        }

        // bone.worldMatrix 是 MmdModel.worldTransformMatrices 的切片视图，
        // Mat4 直接包装该 Float32Array（不复制），step 写 values 即写渲染矩阵
        const boneMatrices: Mat4[] = new Array(bones.length);
        const boneInverseBindMatrices = new Float32Array(bones.length * 16);
        for (let i = 0; i < bones.length; ++i) {
            boneMatrices[i] = new Mat4(bones[i].worldMatrix);
            boneInverseBindMatrices.set(bones[i].linkedBone.getAbsoluteInverseBindMatrix().m, i * 16);
        }

        const physics = new RezePhysics(rigidbodies, convertedJoints);

        // 不再为每个模型单独注册 onBeforeRenderObservable 回调，
        // 改由 RezeMmdPhysicsModel 按 Scene 注册共享帧回调（stepFrame），
        // 每帧只取一次全局状态（物理引擎重力、帧时间），多模型复用。
        return new RezeMmdPhysicsModel(this._scene, physics, boneMatrices, boneInverseBindMatrices, rigidbodyIndexMap);
    }
}

/**
 * RezePhysics 物理模型（IMmdPhysicsModel 实现）。
 *
 * 不再为每个模型注册独立的 onBeforeRenderObservable 回调。改由按 Scene 注册
 * 单个共享帧回调：每帧只取一次全局状态（物理引擎重力、帧时间），同一 Scene
 * 上的所有模型共用该状态步进。消除多模型场景下重复 getPhysicsEngine()/
 * getDeltaTime() 的开销。
 *
 * 支持手动步进模式（用于离线渲染）：通过 per-scene 模型 registry 收集所有活动
 * 实例，调用 stepAll 可统一驱动所有模型的手动步进，重力同步也按 Scene 批量。
 */
class RezeMmdPhysicsModel implements IMmdPhysicsModel {
    /** Per-scene 模型列表，用于共享帧回调 */
    private static _sceneModelMap: Map<Scene, RezeMmdPhysicsModel[]> = new Map();
    /** Per-scene 共享帧回调句柄，用于 dispose 时移除 */
    private static _sceneCallbacks: Map<Scene, () => void> = new Map();
    /** 是否处于手动步进模式（离线渲染时启用，禁用 onBeforeRenderObservable 回调） */
    private static _manualStepMode = false;

    /**
     * 设置手动步进模式
     * 启用时：所有注册的实例暂停 onBeforeRenderObservable 驱动，等待手动 stepAll 调用
     * 同时设置 RezePhysics 的离线模式（禁用 affordable 上限，保证所有子步执行）
     * 禁用时：恢复 onBeforeRenderObservable 驱动和实时模式
     */
    public static setManualStepMode(enabled: boolean): void {
        RezeMmdPhysicsModel._manualStepMode = enabled;
        for (const models of RezeMmdPhysicsModel._sceneModelMap.values()) {
            for (let i = 0; i < models.length; i++) {
                models[i]._physics.setOfflineMode(enabled);
            }
        }
    }

    /**
     * 手动步进所有注册的 RezePhysics 模型
     * 按 Scene 批量同步重力，每帧只调用一次 getPhysicsEngine()
     * @param dt 时间步长（秒）
     */
    public static stepAll(dt: number): void {
        for (const [scene, models] of RezeMmdPhysicsModel._sceneModelMap) {
            // 每 Scene 取一次全局重力
            const physicsEngine = scene.getPhysicsEngine();
            if (physicsEngine) {
                const g = physicsEngine.gravity;
                _gravity.setXYZ(g.x, g.y, g.z);
            }
            for (let i = 0; i < models.length; i++) {
                models[i]._physics.setGravity(_gravity);
                models[i]._physics.step(dt, models[i]._boneMatrices, models[i]._boneInverseBindMatrices);
            }
        }
    }

    /**
     * 检查是否处于手动步进模式
     */
    public static isManualStepMode(): boolean {
        return RezeMmdPhysicsModel._manualStepMode;
    }

    /**
     * 批量设置所有实例的求解迭代次数（钳制 1–64）
     * 调用后立即生效，每帧读取该值，无需重建物理世界
     * @param iterations 目标迭代次数，默认硬编码为 10
     */
    public static setSolverIterations(iterations: number): void {
        for (const models of RezeMmdPhysicsModel._sceneModelMap.values()) {
            for (let i = 0; i < models.length; i++) {
                models[i]._physics.setSolverIterations(iterations);
            }
        }
    }

    /**
     * 获取第一个实例的迭代次数（所有实例设置后一致）
     */
    public static getSolverIterations(): number | null {
        for (const models of RezeMmdPhysicsModel._sceneModelMap.values()) {
            if (models.length > 0) {
                return models[0]._physics.getSolverIterations();
            }
        }
        return null;
    }

    private readonly _scene: Scene;
    private readonly _physics: RezePhysics;
    private readonly _boneMatrices: Mat4[];
    private readonly _boneInverseBindMatrices: Float32Array;
    /** PMX 刚体索引 → store 内部索引（含转换失败项，值为 -1） */
    private readonly _rigidbodyIndexMap: Int32Array;
    /** store 内部索引 → 初始类型快照（仅 Static/Dynamic，用于恢复） */
    private readonly _originalTypes: Uint8Array;
    /** store 内部索引 → 初始 invMass 快照（用于恢复） */
    private readonly _originalInvMasses: Float32Array;
    /** PMX 刚体维度的上次已提交状态（1 = dynamic，0 = kinematic） */
    private readonly _syncedStates: Uint8Array;
    private _disabledRigidBodyCount = 0;

    constructor(
        scene: Scene,
        physics: RezePhysics,
        boneMatrices: Mat4[],
        boneInverseBindMatrices: Float32Array,
        rigidbodyIndexMap: Int32Array
    ) {
        this._scene = scene;
        this._physics = physics;
        this._boneMatrices = boneMatrices;
        this._boneInverseBindMatrices = boneInverseBindMatrices;
        this._rigidbodyIndexMap = rigidbodyIndexMap;
        // 首次 step 前引擎尚未计算 bodyOffset，需先触发一次以完成绑定
        // （computeBoneOffsets 使用传入的逆绑定矩阵，与渲染骨架一致）
        if (boneMatrices.length > 0) {
            physics.step(0, boneMatrices, boneInverseBindMatrices);
        }

        const store = physics.getStore();
        this._originalTypes = new Uint8Array(store.type);
        this._originalInvMasses = new Float32Array(store.invMass);
        this._syncedStates = new Uint8Array(rigidbodyIndexMap.length).fill(1);

        // 注册到 per-scene 模型列表；若该 Scene 尚无共享帧回调，则注册一个
        let models = RezeMmdPhysicsModel._sceneModelMap.get(scene);
        if (!models) {
            models = [];
            RezeMmdPhysicsModel._sceneModelMap.set(scene, models);

            // 本 Scene 首个模型：注册共享帧回调，每帧只取一次全局状态
            const callback = (): void => {
                if (RezeMmdPhysicsModel._manualStepMode) return;

                // 取全局状态一次，供本 Scene 所有模型复用
                const physicsEngine = scene.getPhysicsEngine();
                if (physicsEngine) {
                    const g = physicsEngine.gravity;
                    _gravity.setXYZ(g.x, g.y, g.z);
                }
                const dt = scene.getEngine().getDeltaTime() / 1000;

                const sceneModels = RezeMmdPhysicsModel._sceneModelMap.get(scene);
                if (sceneModels) {
                    for (let i = 0; i < sceneModels.length; i++) {
                        sceneModels[i]._physics.setGravity(_gravity);
                        sceneModels[i]._physics.step(
                            dt,
                            sceneModels[i]._boneMatrices,
                            sceneModels[i]._boneInverseBindMatrices,
                        );
                    }
                }
            };
            // insertFirst=true：保证排在 MmdRuntime.afterPhysics（同一 observable 上）之前
            scene.onBeforeRenderObservable.add(callback, undefined, true);
            RezeMmdPhysicsModel._sceneCallbacks.set(scene, callback);
        }
        models.push(this);
    }

    dispose(): void {
        // 从 per-scene 模型列表移除
        const models = RezeMmdPhysicsModel._sceneModelMap.get(this._scene);
        if (models) {
            const idx = models.indexOf(this);
            if (idx >= 0) {
                models.splice(idx, 1);
            }
            // 本 Scene 最后一个模型：清理共享帧回调
            if (models.length === 0) {
                RezeMmdPhysicsModel._sceneModelMap.delete(this._scene);
                const callback = RezeMmdPhysicsModel._sceneCallbacks.get(this._scene);
                if (callback) {
                    this._scene.onBeforeRenderObservable.removeCallback(callback);
                    RezeMmdPhysicsModel._sceneCallbacks.delete(this._scene);
                }
            }
        }
    }

    initialize(): void {
        this._physics.reset(this._boneMatrices);
    }

    get needDeoptimize(): boolean {
        return 0 < this._disabledRigidBodyCount;
    }

    commitBodyStates(rigidBodyStates: Uint8Array): void {
        const store = this._physics.getStore();
        const types = store.type;
        const synced = this._syncedStates;
        const indexMap = this._rigidbodyIndexMap;
        const originalTypes = this._originalTypes;
        const originalInvMasses = this._originalInvMasses;
        let changed = false;
        for (let i = 0; i < rigidBodyStates.length; ++i) {
            const index = indexMap[i];
            if (index < 0) continue;
            if (originalTypes[index] === RigidbodyType.Static) continue; // FollowBone 刚体不可切换
            const state = rigidBodyStates[i];
            if (state === synced[i]) continue;
            synced[i] = state;
            changed = true;
            const i3 = index * 3;
            if (state === 0) {
                // 禁用：变为 Kinematic（跟骨），清零速度与质量倒数
                this._disabledRigidBodyCount += 1;
                types[index] = RigidbodyType.Kinematic;
                store.invMass[index] = 0;
                store.linearVelocities[i3] = 0;
                store.linearVelocities[i3 + 1] = 0;
                store.linearVelocities[i3 + 2] = 0;
                store.angularVelocities[i3] = 0;
                store.angularVelocities[i3 + 1] = 0;
                store.angularVelocities[i3 + 2] = 0;
            } else {
                // 启用：恢复初始 Dynamic 类型与质量
                this._disabledRigidBodyCount -= 1;
                types[index] = originalTypes[index];
                store.invMass[index] = originalInvMasses[index];
            }
        }
        if (changed) {
            // Dynamic↔Kinematic 切换影响碰撞对过滤，必须失效缓存
            store.invalidateCollisionPairs();
        }
    }

    // no-op：RezePhysics.step 内部直接读写 boneWorldMatrices（worldTransformMatrices 切片）
    syncBodies(): void {
        // nothing to do
    }

    syncBones(): void {
        // nothing to do
    }
}

// 控制台调试入口：挂到 globalThis，浏览器 DevTools 可直接实时调整物理参数。
// 用法（控制台）：
//   RezePhysicsDebug.setSolverIterations(20)  // 增大迭代→更稳更慢
//   RezePhysicsDebug.getSolverIterations()    // 查询当前值
interface RezePhysicsDebugApi {
    setSolverIterations(iterations: number): void;
    getSolverIterations(): number | null;
}
(globalThis as unknown as { RezePhysicsDebug: RezePhysicsDebugApi }).RezePhysicsDebug = {
    setSolverIterations: (iterations: number): void => {
        RezeMmdPhysics.setSolverIterations(iterations);
    },
    getSolverIterations: (): number | null => RezeMmdPhysics.getSolverIterations(),
};
