
import { StateStore } from './StateStore';
import { Events } from '../../core';

export type ParticleSystemType = string;

export interface ParticleSystemState {
  type: string;
  enabled: boolean;
  params: Record<string, number | { x: number; y: number; z: number } | { r: number; g: number; b: number; a: number }>;
}

export interface ParticleState {
  currentType: string;
  systems: Map<string, ParticleSystemState>;
}

function getDefaultParticleState(): ParticleState {
  return {
    currentType: 'rain',
    systems: new Map()
  };
}

export class ParticleStateManager extends StateStore<ParticleState> {
  private static instance: ParticleStateManager;

  protected state: ParticleState = getDefaultParticleState();

  private constructor() {
    super();
  }

  static getInstance(): ParticleStateManager {
    if (!ParticleStateManager.instance) {
      ParticleStateManager.instance = new ParticleStateManager();
    }
    return ParticleStateManager.instance;
  }

  static resetInstance(): void {
    ParticleStateManager.instance = undefined as any;
  }

  getState(): Readonly<ParticleState> {
    return {
      currentType: this.state.currentType,
      systems: new Map(this.state.systems)
    };
  }

  setSystem(type: ParticleSystemType): void {
    this.state.currentType = type;
    this.update({ currentType: type }, Events.PARTICLE_SYSTEM_CHANGED);
  }

  setEnabled(type: string, enabled: boolean): void {
    let systemState = this.state.systems.get(type);
    if (!systemState) {
      systemState = { type, enabled, params: {} };
      this.state.systems.set(type, systemState);
    } else {
      systemState.enabled = enabled;
    }
    this.update({}, Events.PARTICLE_SYSTEM_CHANGED);
  }

  setParam(
    type: string,
    paramName: string,
    value: number | { x: number; y: number; z: number } | { r: number; g: number; b: number; a: number }
  ): void {
    let systemState = this.state.systems.get(type);
    if (!systemState) {
      systemState = { type, enabled: false, params: {} };
      this.state.systems.set(type, systemState);
    }
    systemState.params[paramName] = value;
    this.update({}, Events.PARTICLE_PARAMS_CHANGED);
  }

  isEnabled(type: string): boolean {
    return this.state.systems.get(type)?.enabled ?? false;
  }

  getParam(
    type: string,
    paramName: string
  ): number | { x: number; y: number; z: number } | { r: number; g: number; b: number; a: number } | undefined {
    return this.state.systems.get(type)?.params[paramName];
  }

  getParams(type: string): Record<string, number | { x: number; y: number; z: number } | { r: number; g: number; b: number; a: number }> {
    const systemState = this.state.systems.get(type);
    return systemState ? { ...systemState.params } : {};
  }

  getEnabledTypes(): string[] {
    const enabled: string[] = [];
    this.state.systems.forEach((state, type) => {
      if (state.enabled) {
        enabled.push(type);
      }
    });
    return enabled;
  }

  reset(): void {
    this.state = getDefaultParticleState();
    super.reset();
  }
}
