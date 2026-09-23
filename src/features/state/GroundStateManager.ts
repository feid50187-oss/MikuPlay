
import { StateStore } from './StateStore';
import { Events } from '../../core';

export type GroundType = string;

export interface GroundState {
  type: GroundType;
  scale: number;
  height: number;
}

function getDefaultGroundState(): GroundState {
  return {
    type: 'none',
    scale: 1,
    height: 0
  };
}

export class GroundStateManager extends StateStore<GroundState> {
  private static instance: GroundStateManager;

  protected state: GroundState = getDefaultGroundState();

  private constructor() {
    super();
  }

  static getInstance(): GroundStateManager {
    if (!GroundStateManager.instance) {
      GroundStateManager.instance = new GroundStateManager();
    }
    return GroundStateManager.instance;
  }

  static resetInstance(): void {
    GroundStateManager.instance = undefined as any;
  }

  setGroundType(type: GroundType): void {
    this.update({ type }, Events.GROUND_TYPE_CHANGED);
  }

  setScale(scale: number): void {
    this.update({ scale }, Events.GROUND_SCALE_CHANGED);
  }

  setHeight(height: number): void {
    this.update({ height }, Events.GROUND_HEIGHT_CHANGED);
  }
}
