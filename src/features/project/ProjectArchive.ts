/**
 * 工程存档数据接口定义
 * 所有存档相关的 TypeScript 接口和类型
 */

/** 可序列化的参数值类型 */
export type ParamValueArchive =
    | number
    | boolean
    | string
    | { r: number; g: number; b: number }
    | { x: number; y: number; z: number };

// ===== 顶层结构 =====

export interface ProjectArchive {
    /** 存档格式版本号，当前为 1 */
    schemaVersion: 1;
    /** 存档创建时间（ISO 8601） */
    createdAt: string;
    /** 应用版本号（取自 package.json version） */
    appVersion: string;
    /** 存档名称（可选） */
    name?: string;
    /** 场景环境状态 */
    scene: SceneArchive;
    /** 模型与动画状态 */
    models: ModelsArchive;
    /** 材质状态 */
    shading: ShadingArchive;
    /** 后处理状态 */
    postProc: PostProcArchive;
    /** 模型操作状态 */
    modelOpt: ModelOptArchive;
    /** 粒子状态 */
    particle: ParticleArchive;
    /** 物理设置 */
    physics: PhysicsArchive;
    /** 相机状态 */
    camera: CameraArchive;
    /** 音乐状态 */
    music: MusicArchive;
    /** 应用设置 */
    appSettings: AppSettingsArchive;
    /** 灯光管理器预设 */
    lights?: LightsArchive;
    /** 导演模式预设 */
    director?: DirectorArchive;
}

// ===== SceneArchive =====

export interface SceneArchive {
    backgroundColor: string;
    gridVisible: boolean;
    background: BackgroundArchive;
    ground: GroundArchive;
    light: LightArchive;
}

export interface BackgroundArchive {
    type: string;
    environment: {
        texturePath: string | null;
        rotation: number;
        exposure: number;
    };
    media: {
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
    };
}

export interface GroundArchive {
    type: string;
    scale: number;
    height: number;
}

export interface LightArchive {
    ambientIntensity: number;
    ambientColor: { r: number; g: number; b: number };
    directionalIntensity: number;
    directionalColor: { r: number; g: number; b: number };
    directionalDirection: { x: number; y: number; z: number };
    shadow: ShadowArchive;
}

export interface ShadowArchive {
    enabled: boolean;
    resolution: number;
    selfShadow: boolean;
    quality: 'low' | 'medium' | 'high';
    intensity: number;
    filterMode: 'none' | 'blurCloseEsm' | 'pcf' | 'pcss';
    bias: number;
    normalBias: number;
    darkness: number;
    frustumEdgeFalloff: number;
    transparencyShadow: boolean;
}

// ===== ModelsArchive =====

export interface ModelsArchive {
    models: ModelArchive[];
    cameraAnimation?: CameraAnimationArchive;
}

export interface ModelArchive {
    name: string;
    filePath: string;
    fileType: 'pmx' | 'pmd' | 'bpmx';
    animations: AnimationArchive[];
    ikEnabled: boolean;
    visible: boolean;
    enabled: boolean;
}

export interface AnimationArchive {
    filePath: string;
    fileName: string;
    appendMode: 'blend' | 'append';
}

export interface CameraAnimationArchive {
    filePath: string;
    fileName: string;
}

// ===== ShadingArchive =====

export interface ShadingArchive {
    models: ShadingModelArchive[];
}

export interface ShadingModelArchive {
    modelFilePath: string;
    renderStyle: string;
    outlineWidth: number;
    materials: MaterialArchive[];
}

export interface MaterialArchive {
    index: number;
    adapterTypeId: string;
    params: Record<string, ParamValueArchive>;
    isVisible: boolean;
    originalOutlineWidth: number;
    originalOutlineColor: { r: number; g: number; b: number };
    originalOutlineAlpha: number;
    originalRenderOutline: boolean;
}

// ===== PostProcArchive =====

export interface PostProcArchive {
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
    dofAutoFocusModelFilePath: string;
    vignetteEnabled: boolean;
    vignetteIntensity: number;
    vignetteSoftness: number;
    vignetteColor: { r: number; g: number; b: number };
    caEnabled: boolean;
    caIntensity: number;
    grainEnabled: boolean;
    grainIntensity: number;
    softFocusEnabled: boolean;
    softFocusIntensity: number;
    hueEnabled: boolean;
    hueShift: number;
}

// ===== ModelOptArchive =====

/** 骨骼变换值存档格式 */
export interface BoneStateArchive {
    modelFilePath: string;
    boneName: string;
    translation: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
}

export interface ModelOptArchive {
    boneCorrections: BoneCorrectionArchive[];
    boneParentingBindings: BoneParentingArchive[];
    morphWeights: MorphWeightArchive[];
    boneStates: BoneStateArchive[];
    currentMode: 'move' | 'rotate' | 'scale';
    currentAxis: 'x' | 'y' | 'z';
}

export interface BoneCorrectionArchive {
    modelFilePath: string;
    boneName: string;
    rotationOffsets: { x: number; y: number; z: number };
    baseRotation: { x: number; y: number; z: number; w: number } | null;
}

export interface BoneParentingArchive {
    id: string;
    parentModelFilePath: string;
    parentBoneName: string;
    childModelFilePath: string;
    childBoneName: string;
    enabled: boolean;
}

export interface MorphWeightArchive {
    modelFilePath: string;
    morphWeights: Record<string, number>;
}

// ===== ParticleArchive =====

export interface ParticleArchive {
    currentType: string;
    systems: ParticleSystemArchive[];
}

export interface ParticleSystemArchive {
    type: string;
    enabled: boolean;
    params: Record<string, number | { x: number; y: number; z: number } | { r: number; g: number; b: number; a: number }>;
}

// ===== PhysicsArchive =====

export interface PhysicsArchive {
    sharedPhysicsWorld: boolean;
    groundCollisionEnabled: boolean;
}

// ===== CameraArchive =====

export interface CameraArchive {
    targetOffset: { x: number; y: number; z: number };
    cameraRotation?: { x: number; y: number };
}

// ===== MusicArchive =====

export interface MusicArchive {
    tracks: MusicTrackArchive[];
}

export interface MusicTrackArchive {
    filePath: string;
    name: string;
}

// ===== AppSettingsArchive =====

export interface AppSettingsArchive {
    theme: 'light' | 'dark';
    frustumCulling: boolean;
    renderScale: number;
    animationPlaying: boolean;
    animationCurrentFrame: number;
}

// ===== 恢复报告 =====

export interface RestoreReport {
    success: boolean;
    restoredModels: number;
    restoredAnimations: number;
    missingFiles: Array<{ type: string; filePath: string; name: string }>;
    warnings: string[];
}

// ===== LightsArchive =====

export interface LightsArchive {
    /** 灯光管理器设置键值对 */
    settings: Record<string, any>;
    /** 预设名称 */
    presetName?: string;
}

// ===== DirectorArchive =====

export interface DirectorArchive {
    /** 镜头节点列表 */
    nodes: any[];
    /** 用户预设列表 */
    presets: any[];
    /** 全局设置 */
    globalSettings?: Record<string, any>;
}
