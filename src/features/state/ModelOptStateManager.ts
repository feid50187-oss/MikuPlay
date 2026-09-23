
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { StateStore } from './StateStore';
import { Events } from '../../core';

export type ModelOptMode = 'move' | 'rotate' | 'scale';
export type AxisType = 'x' | 'y' | 'z';

export interface BoneTransformValue {
  x: number;
  y: number;
  z: number;
}

export interface BoneTransformRecord {
  translation: BoneTransformValue;
  rotation: BoneTransformValue;
  scale: BoneTransformValue;
}

export interface MorphInfo {
  name: string;
  index: number;
  weight: number;
  category: number; // PmxObject.Morph.Category: 0=System, 1=Eyebrow, 2=Eye, 3=Lip, 4=Other
}

export interface ModelMorphState {
  modelId: string;
  morphs: MorphInfo[];
}

export interface ModelBoneState {
  modelId: string;
  bones: Map<string, BoneTransformRecord>;
}

export interface BoneCorrectionState {
  modelId: string;
  boneName: string;
  rotationOffsets: {
    x: number;
    y: number;
    z: number;
  };
  baseRotation: Quaternion | null;
}

export interface BoneParentingBinding {
  id: string;
  parentModelId: string;
  parentBoneName: string;
  childModelId: string;
  childBoneName: string;
  enabled: boolean;
}

export interface ModelOptState {
  currentMode: ModelOptMode;
  currentAxis: AxisType;
  activeScaleAxes: Set<AxisType>;
  currentModelId: string | null;
  currentBoneName: string | null;
  selectedModelId: string | null;
  boneStates: Map<string, ModelBoneState>;
  morphStates: Map<string, ModelMorphState>;
  modelEnabledStates: Map<string, boolean>;
  boneCorrectionStates: Map<string, Map<string, BoneCorrectionState>>;
  boneParentingBindings: Map<string, BoneParentingBinding>;
}

function getDefaultModelOptState(): ModelOptState {
  return {
    currentMode: 'move',
    currentAxis: 'x',
    activeScaleAxes: new Set<AxisType>(['x', 'y', 'z']),
    currentModelId: null,
    currentBoneName: null,
    selectedModelId: null,
    boneStates: new Map(),
    morphStates: new Map(),
    modelEnabledStates: new Map(),
    boneCorrectionStates: new Map(),
    boneParentingBindings: new Map()
  };
}

export class ModelOptStateManager extends StateStore<ModelOptState> {
  private static instance: ModelOptStateManager;

  protected state: ModelOptState = getDefaultModelOptState();

  // 缓存 getAllBoneCorrections 结果（每 tick 调用，仅在用户修改时重建）
  private _cachedCorrections: Array<{ modelId: string; boneName: string; offsets: { x: number; y: number; z: number } }> | null = null;
  private _correctionsDirty = true;

  // morph 索引 Map，将 O(n) find 降为 O(1)
  private _morphIndexMaps: Map<string, Map<number, MorphInfo>> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): ModelOptStateManager {
    if (!ModelOptStateManager.instance) {
      ModelOptStateManager.instance = new ModelOptStateManager();
    }
    return ModelOptStateManager.instance;
  }

  static resetInstance(): void {
    ModelOptStateManager.instance = undefined as any;
  }

  getState(): Readonly<ModelOptState> {
    return this.state;
  }

  setMode(currentMode: ModelOptMode): void {
    this.update({ currentMode });
  }

  setAxis(currentAxis: AxisType): void {
    this.update({ currentAxis });
  }

  toggleScaleAxis(axis: AxisType): void {
    const newAxes = new Set(this.state.activeScaleAxes);
    if (newAxes.has(axis)) {
      if (newAxes.size > 1) {
        newAxes.delete(axis);
      }
    } else {
      newAxes.add(axis);
    }
    this.update({ activeScaleAxes: newAxes });
  }

  setScaleAxes(axes: AxisType[]): void {
    this.update({ activeScaleAxes: new Set(axes) });
  }

  getActiveScaleAxes(): Set<AxisType> {
    return new Set(this.state.activeScaleAxes);
  }

  isScaleAxisActive(axis: AxisType): boolean {
    return this.state.activeScaleAxes.has(axis);
  }

  selectModel(selectedModelId: string | null): void {
    if (this.state.selectedModelId !== selectedModelId) {
      // 选中模型时，自动选中"全ての親"骨骼
      if (selectedModelId) {
        this.state.currentModelId = selectedModelId;
        this.state.currentBoneName = '全ての親';
      } else {
        this.state.currentModelId = null;
        this.state.currentBoneName = null;
      }
      this.update({ selectedModelId }, Events.MODEL_SELECTED, selectedModelId);
    }
  }

  getSelectedModel(): string | null {
    return this.state.selectedModelId;
  }

  setSelectedBone(currentModelId: string | null, currentBoneName: string | null): void {
    this.update({ currentModelId, currentBoneName });
  }

  getSelectedBone(): { modelId: string | null; boneName: string | null } {
    return {
      modelId: this.state.currentModelId,
      boneName: this.state.currentBoneName
    };
  }

  getBoneTransform(modelId: string, boneName: string): BoneTransformRecord {
    const modelState = this.state.boneStates.get(modelId);
    if (!modelState) {
      return {
        translation: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      };
    }
    const boneRecord = modelState.bones.get(boneName);
    if (!boneRecord) {
      return {
        translation: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      };
    }
    return {
      translation: { ...boneRecord.translation },
      rotation: { ...boneRecord.rotation },
      scale: { ...boneRecord.scale }
    };
  }

  setBoneTransformValue(
    modelId: string,
    boneName: string,
    mode: ModelOptMode,
    axis: AxisType,
    value: number
  ): void {
    let modelState = this.state.boneStates.get(modelId);
    if (!modelState) {
      modelState = { modelId, bones: new Map() };
      this.state.boneStates.set(modelId, modelState);
    }

    let boneRecord = modelState.bones.get(boneName);
    if (!boneRecord) {
      boneRecord = {
        translation: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      };
      modelState.bones.set(boneName, boneRecord);
    }

    const roundedValue = Math.round(value * 100) / 100;

    if (mode === 'move') {
      boneRecord.translation[axis] = roundedValue;
    } else if (mode === 'rotate') {
      boneRecord.rotation[axis] = roundedValue;
    } else {
      boneRecord.scale[axis] = roundedValue;
    }
  }

  getBoneTransformValue(modelId: string, boneName: string, mode: ModelOptMode, axis: AxisType): number {
    const modelState = this.state.boneStates.get(modelId);
    if (!modelState) {
      return mode === 'scale' ? 1 : 0;
    }
    const boneRecord = modelState.bones.get(boneName);
    if (!boneRecord) {
      return mode === 'scale' ? 1 : 0;
    }

    if (mode === 'move') {
      return boneRecord.translation[axis];
    } else if (mode === 'rotate') {
      return boneRecord.rotation[axis];
    } else {
      return boneRecord.scale[axis];
    }
  }

  setModelOptValue(mode: ModelOptMode, axis: AxisType, value: number): void {
    const { currentModelId, currentBoneName } = this.state;
    if (currentModelId && currentBoneName) {
      this.setBoneTransformValue(currentModelId, currentBoneName, mode, axis, value);
    }
  }

  getModelOptValue(mode: ModelOptMode, axis: AxisType): number {
    const { currentModelId, currentBoneName } = this.state;
    if (currentModelId && currentBoneName) {
      return this.getBoneTransformValue(currentModelId, currentBoneName, mode, axis);
    }
    return mode === 'scale' ? 1 : 0;
  }

  initializeModelMorphs(modelId: string, morphs: MorphInfo[]): void {
    const morphIndexMap = new Map<number, MorphInfo>();
    const morphState: ModelMorphState = {
      modelId,
      morphs: morphs.map((m) => ({ ...m }))
    };
    // 使用 morphState.morphs 中的对象，确保 setMorphWeight 修改的是同一个对象
    for (const m of morphState.morphs) {
      morphIndexMap.set(m.index, m);
    }
    this.state.morphStates.set(modelId, morphState);
    this._morphIndexMaps.set(modelId, morphIndexMap);
    this.update({});
  }

  getModelMorphState(modelId: string): ModelMorphState | undefined {
    const state = this.state.morphStates.get(modelId);
    if (state) {
      return {
        modelId: state.modelId,
        morphs: state.morphs.map((m) => ({ ...m }))
      };
    }
    return undefined;
  }

  setMorphWeight(modelId: string, morphIndex: number, weight: number): void {
    const morphIndexMap = this._morphIndexMaps.get(modelId);
    const morph = morphIndexMap?.get(morphIndex);
    if (morph) {
      morph.weight = Math.max(0, Math.min(1, weight));
      this.update({});
    }
  }

  getMorphWeight(modelId: string, morphIndex: number): number {
    const morphIndexMap = this._morphIndexMaps.get(modelId);
    return morphIndexMap?.get(morphIndex)?.weight ?? 0;
  }

  resetModelMorphs(modelId: string): void {
    const state = this.state.morphStates.get(modelId);
    if (state) {
      state.morphs.forEach((morph) => {
        morph.weight = 0;
      });
      this.update({});
    }
  }

  removeModelMorphs(modelId: string): void {
    this.state.morphStates.delete(modelId);
    this._morphIndexMaps.delete(modelId);
  }

  removeModelBones(modelId: string): void {
    this.state.boneStates.delete(modelId);
  }

  initializeModelEnabledState(modelId: string): void {
    if (!this.state.modelEnabledStates.has(modelId)) {
      this.state.modelEnabledStates.set(modelId, true);
      this.update({}, Events.MODEL_VISIBILITY_CHANGED, { modelId, visible: true });
    }
  }

  setModelEnabled(modelId: string, enabled: boolean): void {
    this.state.modelEnabledStates.set(modelId, enabled);
    this.update({}, Events.MODEL_VISIBILITY_CHANGED, { modelId, visible: enabled });
  }

  isModelEnabled(modelId: string): boolean {
    return this.state.modelEnabledStates.get(modelId) ?? true;
  }

  getAllModelEnabledStates(): Map<string, boolean> {
    return new Map(this.state.modelEnabledStates);
  }

  removeModelEnabledState(modelId: string): void {
    this.state.modelEnabledStates.delete(modelId);
  }

  //region Bone Correction

  private getOrCreateBoneCorrectionState(modelId: string, boneName: string): BoneCorrectionState {
    let modelMap = this.state.boneCorrectionStates.get(modelId);
    if (!modelMap) {
      modelMap = new Map();
      this.state.boneCorrectionStates.set(modelId, modelMap);
    }
    let state = modelMap.get(boneName);
    if (!state) {
      state = {
        modelId,
        boneName,
        rotationOffsets: { x: 0, y: 0, z: 0 },
        baseRotation: null
      };
      modelMap.set(boneName, state);
    }
    return state;
  }

  getBoneCorrectionState(modelId: string, boneName: string): BoneCorrectionState | undefined {
    return this.state.boneCorrectionStates.get(modelId)?.get(boneName);
  }

  setBoneCorrectionBaseRotation(modelId: string, boneName: string, baseRotation: Quaternion): void {
    const state = this.getOrCreateBoneCorrectionState(modelId, boneName);
    state.baseRotation = baseRotation.clone();
  }

  setBoneCorrectionValue(modelId: string, boneName: string, axis: AxisType, value: number): void {
    const state = this.getOrCreateBoneCorrectionState(modelId, boneName);
    state.rotationOffsets[axis] = value;
    this._correctionsDirty = true;
    this.update({});
  }

  getBoneCorrectionValue(modelId: string, boneName: string, axis: AxisType): number {
    return this.state.boneCorrectionStates.get(modelId)?.get(boneName)?.rotationOffsets[axis] ?? 0;
  }

  getBoneCorrectionOffsets(modelId: string, boneName: string): { x: number; y: number; z: number } {
    const offsets = this.state.boneCorrectionStates.get(modelId)?.get(boneName)?.rotationOffsets;
    if (!offsets) {
      return { x: 0, y: 0, z: 0 };
    }
    return { x: offsets.x, y: offsets.y, z: offsets.z };
  }

  clearBoneCorrection(modelId: string, boneName: string): void {
    this.state.boneCorrectionStates.get(modelId)?.delete(boneName);
    this._correctionsDirty = true;
    this.update({});
  }

  getAllBoneCorrections(): Array<{ modelId: string; boneName: string; offsets: { x: number; y: number; z: number } }> {
    if (!this._correctionsDirty && this._cachedCorrections) {
      return this._cachedCorrections;
    }
    const result: Array<{ modelId: string; boneName: string; offsets: { x: number; y: number; z: number } }> = [];
    for (const [modelId, modelMap] of this.state.boneCorrectionStates.entries()) {
      for (const [boneName, state] of modelMap.entries()) {
        result.push({ modelId, boneName, offsets: { ...state.rotationOffsets } });
      }
    }
    this._cachedCorrections = result;
    this._correctionsDirty = false;
    return result;
  }

  removeModelBoneCorrections(modelId: string): void {
    this.state.boneCorrectionStates.delete(modelId);
  }

  //endregion

  //region Bone Parenting Binding

  addBoneParentingBinding(binding: BoneParentingBinding): void {
    this.state.boneParentingBindings.set(binding.id, binding);
    this.update({});
  }

  removeBoneParentingBinding(id: string): void {
    this.state.boneParentingBindings.delete(id);
    this.update({});
  }

  getBoneParentingBinding(id: string): BoneParentingBinding | undefined {
    return this.state.boneParentingBindings.get(id);
  }

  getBoneParentingBindings(): BoneParentingBinding[] {
    return Array.from(this.state.boneParentingBindings.values());
  }

  setBoneParentingBindingEnabled(id: string, enabled: boolean): void {
    const binding = this.state.boneParentingBindings.get(id);
    if (binding) {
      binding.enabled = enabled;
      this.update({});
    }
  }

  removeModelBoneParentingBindings(modelId: string): void {
    for (const [id, binding] of this.state.boneParentingBindings.entries()) {
      if (binding.parentModelId === modelId || binding.childModelId === modelId) {
        this.state.boneParentingBindings.delete(id);
      }
    }
  }

  //endregion
}
