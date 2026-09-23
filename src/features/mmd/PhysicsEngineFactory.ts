import type { Scene } from '@babylonjs/core/scene';
import type { IMmdPhysics } from 'babylon-mmd/esm/Runtime/Physics/IMmdPhysics';
import type { MultiPhysicsRuntime } from 'babylon-mmd/esm/Runtime/Optimized/Physics/Bind/Impl/multiPhysicsRuntime';
import { PhysicsEngineType } from './PhysicsEngineTypes';

/**
 * 物理引擎工厂 — 管理引擎类型选择、创建和切换。
 *
 * 职责：
 * - 跟踪当前引擎类型（SPR / RezePhysics）
 * - 根据当前类型创建对应的 IMmdPhysics 实例
 * - 切换时通知 AnimationManager 重建 MmdRuntime
 */
export class PhysicsEngineFactory {
    private static instance: PhysicsEngineFactory;

    private _currentType: PhysicsEngineType = PhysicsEngineType.RezePhysics;
    /** 切换回调（由 AnimationManager 注册，用于重建 MmdRuntime） */
    private _onChangeCallback: ((type: PhysicsEngineType) => Promise<void>) | null = null;

    private constructor() {}

    public static getInstance(): PhysicsEngineFactory {
        if (!PhysicsEngineFactory.instance) {
            PhysicsEngineFactory.instance = new PhysicsEngineFactory();
            // 启动时恢复上次退出前选择的物理引擎类型。
            // SidePanel 下拉框只恢复了 UI 显示（loadPhysicsEngineDefault），
            // 若不在此同步到 _currentType，PhysicsManager.initialize() 会始终默认加载 RezePhysics。
            // 默认引擎为 RezePhysics，仅当保存值为 SPR 时回退为 SPR。
            try {
                const savedEngine = localStorage.getItem('mikuplay_physics_engine');
                if (savedEngine === PhysicsEngineType.MmdWasmInstanceTypeSPR) {
                    PhysicsEngineFactory.instance._currentType = PhysicsEngineType.MmdWasmInstanceTypeSPR;
                }
            } catch { /* localStorage 不可用时保持默认 RezePhysics */ }
        }
        return PhysicsEngineFactory.instance;
    }

    /**
     * 当前物理引擎类型
     */
    public get currentType(): PhysicsEngineType {
        return this._currentType;
    }

    /**
     * 设置当前物理引擎类型
     */
    public setType(type: PhysicsEngineType): void {
        this._currentType = type;
    }

    /**
     * 注册引擎切换回调（由 AnimationManager 调用）
     */
    public setOnChangeCallback(callback: ((type: PhysicsEngineType) => Promise<void>) | null): void {
        this._onChangeCallback = callback;
    }

    /**
     * 触发引擎切换（由 SidePanel 切换事件调用）
     * @param type 目标引擎类型
     */
    public async switchTo(type: PhysicsEngineType): Promise<void> {
        if (type === this._currentType) return;
        this._currentType = type;
        if (this._onChangeCallback) {
            await this._onChangeCallback(type);
        }
    }

    /**
     * 根据当前引擎类型创建 IMmdPhysics 实例
     * @param scene Babylon.js 场景
     * @param physicsRuntime SPR 物理运行时（仅 SPR 模式需要）
     * @returns IMmdPhysics 实例
     */
    public async createPhysics(scene: Scene, physicsRuntime: MultiPhysicsRuntime | null): Promise<IMmdPhysics> {
        switch (this._currentType) {
            case PhysicsEngineType.MmdWasmInstanceTypeSPR: {
                const { MmdBulletPhysics } = await import('babylon-mmd/esm/Runtime/Optimized/Physics/mmdBulletPhysics');
                if (!physicsRuntime) {
                    throw new Error('SPR 物理引擎需要 physicsRuntime');
                }
                return new MmdBulletPhysics(physicsRuntime);
            }
            case PhysicsEngineType.RezePhysics: {
                const { RezeMmdPhysics } = await import('./physics/RezeMmdPhysics');
                return new RezeMmdPhysics(scene);
            }
            default:
                throw new Error(`不支持的物理引擎类型: ${this._currentType}`);
        }
    }
}