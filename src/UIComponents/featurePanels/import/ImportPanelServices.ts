
import type { ModelManager, ModelStateManager, AnimationManager, CameraManager } from '../../../features/mmd';
import type { MusicManager } from '../../../features/audio';
import type { EventBus } from '../../../core';

export interface ImportPanelServices {
    modelManager: ModelManager;
    animationManager: AnimationManager;
    cameraManager: CameraManager;
    musicManager: MusicManager;
    stateManager: ModelStateManager;
    eventBus: EventBus;
}

export interface FrameControlCallbacks {
    onFrameChange: (frame: number) => void;
    onPlayingChange: (playing: boolean) => void;
}
