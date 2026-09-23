
import { StateStore } from './StateStore';
import { Events } from '../../core';

export type BackgroundType = string;

export interface EnvironmentSettings {
  texturePath: string | null;
  rotation: number;
  exposure: number;
}

export interface MediaSettings {
  sourceUri: string | null;
  mediaType: 'image' | 'video' | null;
  mediaWidth: number;
  mediaHeight: number;
  scale: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  opacity: number;
  billboard: boolean;
  videoPlaying: boolean;
  videoLoop: boolean;
  videoVolume: number;
  tint: number;
  brightness: number;
}

export interface BackgroundState {
  type: BackgroundType;
  environment: EnvironmentSettings;
  media: MediaSettings;
}

function getDefaultBackgroundState(): BackgroundState {
  return {
    type: 'color',
    environment: {
      texturePath: null,
      rotation: 0,
      exposure: 0
    },
    media: {
      sourceUri: null,
      mediaType: null,
      mediaWidth: 0,
      mediaHeight: 0,
      scale: 1,
      positionX: 0,
      positionY: 0,
      positionZ: 20,
      opacity: 1,
      billboard: false,
      videoPlaying: true,
      videoLoop: true,
      videoVolume: 0.5,
      tint: 0,
      brightness: 1
    }
  };
}

export class BackgroundStateManager extends StateStore<BackgroundState> {
  private static instance: BackgroundStateManager;

  protected state: BackgroundState = getDefaultBackgroundState();

  private constructor() {
    super();
  }

  static getInstance(): BackgroundStateManager {
    if (!BackgroundStateManager.instance) {
      BackgroundStateManager.instance = new BackgroundStateManager();
    }
    return BackgroundStateManager.instance;
  }

  static resetInstance(): void {
    BackgroundStateManager.instance = undefined as any;
  }

  setType(type: BackgroundType): void {
    this.update({ type }, Events.BACKGROUND_TYPE_CHANGED);
  }

  setEnvironmentTexturePath(texturePath: string | null): void {
    this.update({
      environment: { ...this.state.environment, texturePath }
    });
  }

  setEnvironmentRotation(rotation: number): void {
    this.update({
      environment: { ...this.state.environment, rotation }
    });
  }

  setEnvironmentExposure(exposure: number): void {
    this.update({
      environment: { ...this.state.environment, exposure }
    });
  }

  setMediaSource(sourceUri: string, mediaType: 'image' | 'video', mediaWidth: number, mediaHeight: number): void {
    this.update({
      media: { ...this.state.media, sourceUri, mediaType, mediaWidth, mediaHeight }
    });
  }

  setMediaScale(scale: number): void {
    this.update({
      media: { ...this.state.media, scale }
    });
  }

  setMediaPosition(positionX: number, positionY: number, positionZ: number): void {
    this.update({
      media: { ...this.state.media, positionX, positionY, positionZ }
    });
  }

  setMediaOpacity(opacity: number): void {
    this.update({
      media: { ...this.state.media, opacity }
    });
  }

  setMediaBillboard(billboard: boolean): void {
    this.update({
      media: { ...this.state.media, billboard }
    });
  }

  setVideoPlaying(videoPlaying: boolean): void {
    this.update({
      media: { ...this.state.media, videoPlaying }
    });
  }

  setVideoLoop(videoLoop: boolean): void {
    this.update({
      media: { ...this.state.media, videoLoop }
    });
  }

  setVideoVolume(videoVolume: number): void {
    this.update({
      media: { ...this.state.media, videoVolume }
    });
  }

  setMediaTint(tint: number): void {
    this.update({
      media: { ...this.state.media, tint }
    });
  }

  setMediaBrightness(brightness: number): void {
    this.update({
      media: { ...this.state.media, brightness }
    });
  }

  getMediaState(): MediaSettings {
    return { ...this.state.media };
  }
}
