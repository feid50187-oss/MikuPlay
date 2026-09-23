
import { StateStore } from './StateStore';
import { Events } from '../../core';

import type { Color3State } from './ShadingStateManager';

export interface PostProcState {
  aaEnabled: boolean;
  samples: number;
  exposure: number;
  saturation: number;
  contrast: number;
  bloomEnabled: boolean;
  bloomIntensity: number;
  bloomThreshold: number;
  bloomKernel: number;
  dofEnabled: boolean;
  dofBlurIntensity: number;
  dofFocusDistance: number;
  dofDepth: number;
  dofAutoFocusEnabled: boolean;
  dofAutoFocusModelId: string;
  // 暗角
  vignetteEnabled: boolean;
  vignetteIntensity: number;
  vignetteSoftness: number;
  vignetteColor: Color3State;
  // 全屏色散
  caEnabled: boolean;
  caIntensity: number;
  // 胶片颗粒
  grainEnabled: boolean;
  grainIntensity: number;
  // 柔焦滤镜
  softFocusEnabled: boolean;
  softFocusIntensity: number;
  // 色调滤镜
  hueEnabled: boolean;
  hueShift: number;
}

function getDefaultPostProcState(): PostProcState {
  return {
    aaEnabled: false,
    samples: 4,
    exposure: 0,
    saturation: 1,
    contrast: 1,
    bloomEnabled: false,
    bloomIntensity: 0.5,
    bloomThreshold: 0.5,
    bloomKernel: 64,
    dofEnabled: false,
    dofBlurIntensity: 0.6,
    dofFocusDistance: 50,
    dofDepth: 20,
    dofAutoFocusEnabled: false,
    dofAutoFocusModelId: '',
    // 暗角
    vignetteEnabled: false,
    vignetteIntensity: 0.8,
    vignetteSoftness: 0.3,
    vignetteColor: { r: 0, g: 0, b: 0 },
    // 全屏色散
    caEnabled: false,
    caIntensity: 0.02,
    // 胶片颗粒
    grainEnabled: false,
    grainIntensity: 0.05,
    // 柔焦滤镜
    softFocusEnabled: false,
    softFocusIntensity: 0.5,
    // 色调滤镜
    hueEnabled: false,
    hueShift: 0
  };
}

export class PostProcStateManager extends StateStore<PostProcState> {
  private static instance: PostProcStateManager;

  protected state: PostProcState = getDefaultPostProcState();

  private constructor() {
    super();
  }

  static getInstance(): PostProcStateManager {
    if (!PostProcStateManager.instance) {
      PostProcStateManager.instance = new PostProcStateManager();
    }
    return PostProcStateManager.instance;
  }

  static resetInstance(): void {
    PostProcStateManager.instance = undefined as any;
  }

  setState(partial: Partial<PostProcState>): void {
    this.update(partial, Events.POSTPROC_CHANGED);
  }

  setAAEnabled(aaEnabled: boolean): void {
    this.update({ aaEnabled }, Events.POSTPROC_CHANGED);
  }

  setSamples(samples: number): void {
    this.update({ samples }, Events.POSTPROC_CHANGED);
  }

  setExposure(exposure: number): void {
    this.update({ exposure }, Events.POSTPROC_CHANGED);
  }

  setSaturation(saturation: number): void {
    this.update({ saturation }, Events.POSTPROC_CHANGED);
  }

  setContrast(contrast: number): void {
    this.update({ contrast }, Events.POSTPROC_CHANGED);
  }

  setBloomEnabled(bloomEnabled: boolean): void {
    this.update({ bloomEnabled }, Events.POSTPROC_CHANGED);
  }

  setBloomIntensity(bloomIntensity: number): void {
    this.update({ bloomIntensity }, Events.POSTPROC_CHANGED);
  }

  setBloomThreshold(bloomThreshold: number): void {
    this.update({ bloomThreshold }, Events.POSTPROC_CHANGED);
  }

  setBloomKernel(bloomKernel: number): void {
    this.update({ bloomKernel }, Events.POSTPROC_CHANGED);
  }

  setDOFEnabled(dofEnabled: boolean): void {
    this.update({ dofEnabled }, Events.POSTPROC_CHANGED);
  }

  setDOFBlurIntensity(dofBlurIntensity: number): void {
    this.update({ dofBlurIntensity }, Events.POSTPROC_CHANGED);
  }

  setDOFFocusDistance(dofFocusDistance: number): void {
    this.update({ dofFocusDistance }, Events.POSTPROC_CHANGED);
  }

  setDOFDepth(dofDepth: number): void {
    this.update({ dofDepth }, Events.POSTPROC_CHANGED);
  }

  setDOFAutoFocusEnabled(dofAutoFocusEnabled: boolean): void {
    this.update({ dofAutoFocusEnabled }, Events.POSTPROC_CHANGED);
  }

  setDOFAutoFocusModelId(dofAutoFocusModelId: string): void {
    this.update({ dofAutoFocusModelId }, Events.POSTPROC_CHANGED);
  }

  // 暗角
  setVignetteEnabled(enabled: boolean): void {
    this.update({ vignetteEnabled: enabled }, Events.POSTPROC_CHANGED);
  }
  setVignetteIntensity(value: number): void {
    this.update({ vignetteIntensity: value }, Events.POSTPROC_CHANGED);
  }
  setVignetteSoftness(value: number): void {
    this.update({ vignetteSoftness: value }, Events.POSTPROC_CHANGED);
  }
  setVignetteColor(r: number, g: number, b: number): void {
    this.update({ vignetteColor: { r, g, b } }, Events.POSTPROC_CHANGED);
  }

  // 全屏色散
  setCAEnabled(enabled: boolean): void {
    this.update({ caEnabled: enabled }, Events.POSTPROC_CHANGED);
  }
  setCAIntensity(value: number): void {
    this.update({ caIntensity: value }, Events.POSTPROC_CHANGED);
  }

  // 胶片颗粒
  setGrainEnabled(enabled: boolean): void {
    this.update({ grainEnabled: enabled }, Events.POSTPROC_CHANGED);
  }
  setGrainIntensity(value: number): void {
    this.update({ grainIntensity: value }, Events.POSTPROC_CHANGED);
  }

  // 柔焦滤镜
  setSoftFocusEnabled(enabled: boolean): void {
    this.update({ softFocusEnabled: enabled }, Events.POSTPROC_CHANGED);
  }
  setSoftFocusIntensity(value: number): void {
    this.update({ softFocusIntensity: value }, Events.POSTPROC_CHANGED);
  }

  // 色调滤镜
  setHueEnabled(enabled: boolean): void {
    this.update({ hueEnabled: enabled }, Events.POSTPROC_CHANGED);
  }
  setHueShift(value: number): void {
    this.update({ hueShift: value }, Events.POSTPROC_CHANGED);
  }
}
