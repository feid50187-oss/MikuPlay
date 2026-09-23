/**
 * 物理引擎类型枚举
 */
export enum PhysicsEngineType {
    /** SPR (WASM) — 基于 bullet WASM 的物理引擎（默认） */
    MmdWasmInstanceTypeSPR = 'spr',
    /** RezePhysics — 纯 TypeScript 物理引擎 */
    RezePhysics = 'reze'
}

/**
 * 物理引擎类型元数据
 */
export const PHYSICS_ENGINE_LABELS: Record<PhysicsEngineType, string> = {
    [PhysicsEngineType.MmdWasmInstanceTypeSPR]: 'SPR (WASM)',
    [PhysicsEngineType.RezePhysics]: 'RezePhysics (纯TS)'
};

/**
 * 物理引擎切换事件回调
 */
export type PhysicsEngineChangeCallback = (type: PhysicsEngineType) => void;