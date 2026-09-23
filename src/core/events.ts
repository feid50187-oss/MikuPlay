
export const Events = {
  MODEL_LOADED: 'model:loaded',
  MODEL_REMOVED: 'model:removed',
  MODEL_SELECTED: 'model:selected',
  MODEL_VISIBILITY_CHANGED: 'model:visibility_changed',

  ANIMATION_LOADED: 'animation:loaded',
  ANIMATION_REMOVED: 'animation:removed',
  ANIMATION_ENDED: 'animation:ended',
  FRAME_UPDATED: 'frame:updated',

  MUSIC_LOADED: 'music:loaded',
  MUSIC_REMOVED: 'music:removed',
  MUSIC_CHANGED: 'music:changed',
  MUSIC_LIST_CHANGED: 'music:list_changed',
  MUSIC_STATE_CHANGED: 'music:state_changed',
  MUSIC_TIME_UPDATED: 'music:time_updated',

  CAMERA_ANIMATION_LOADED: 'camera_animation:loaded',
  CAMERA_ANIMATION_REMOVED: 'camera_animation:removed',

  GROUND_TYPE_CHANGED: 'ground:type_changed',
  GROUND_SCALE_CHANGED: 'ground:scale_changed',
  GROUND_HEIGHT_CHANGED: 'ground:height_changed',

  LIGHT_AMBIENT_CHANGED: 'light:ambient_changed',
  LIGHT_DIRECTIONAL_CHANGED: 'light:directional_changed',

  BACKGROUND_TYPE_CHANGED: 'background:type_changed',
  BACKGROUND_COLOR_CHANGED: 'background:color_changed',

  PARTICLE_SYSTEM_CHANGED: 'particle:system_changed',
  PARTICLE_PARAMS_CHANGED: 'particle:params_changed',

  POSTPROC_CHANGED: 'postproc:changed',
  POSTPROC_ADAPTER_REGISTERED: 'postproc:adapter_registered',
  POSTPROC_ADAPTER_UNREGISTERED: 'postproc:adapter_unregistered',
  SHADING_MATERIAL_CHANGED: 'shading:material_changed',
  SHADING_ADAPTER_REGISTERED: 'shading:adapter_registered',
  SHADING_ADAPTER_UNREGISTERED: 'shading:adapter_unregistered',

  PHYSICS_TOGGLED: 'physics:toggled',
  GRAVITY_CHANGED: 'gravity:changed',

  TEXTURE_DOWNSAMPLE_TOGGLED: 'texture:downsample_toggled',

  FULLSCREEN_CHANGED: 'fullscreen:changed',
  THEME_CHANGED: 'theme:changed',
} as const;

export type EventType = (typeof Events)[keyof typeof Events];
