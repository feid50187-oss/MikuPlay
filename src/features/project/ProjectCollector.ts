import type {
    ProjectArchive, SceneArchive, BackgroundArchive, GroundArchive,
    LightArchive, ShadowArchive, ModelsArchive, ModelArchive,
    AnimationArchive, CameraAnimationArchive, ShadingArchive,
    ShadingModelArchive, MaterialArchive, PostProcArchive,
    ModelOptArchive, BoneCorrectionArchive, BoneParentingArchive,
    MorphWeightArchive, BoneStateArchive,
    ParticleArchive, ParticleSystemArchive,
    PhysicsArchive, CameraArchive, MusicArchive, MusicTrackArchive,
    AppSettingsArchive, ParamValueArchive
} from './ProjectArchive';
import { ModelStateManager, type PersistedModelData } from '../mmd/ModelStateManager';
import { ShadingStateManager, type Color3State } from '../state/ShadingStateManager';
import { PostProcStateManager } from '../state/PostProcStateManager';
import { ModelOptStateManager, type BoneCorrectionState, type BoneParentingBinding } from '../state/ModelOptStateManager';
import { ParticleStateManager } from '../state/ParticleStateManager';
import { BackgroundStateManager } from '../state/BackgroundStateManager';
import { GroundStateManager } from '../state/GroundStateManager';
import { ThemeStateManager } from '../state/ThemeStateManager';
import type { SceneManager } from '../scene/SceneManager';
import type { AnimationManager } from '../mmd/AnimationManager';
import type { CameraManager } from '../mmd/CameraManager';
import type { MusicManager } from '../audio/MusicManager';
import { PhysicsManager } from '../mmd/PhysicsManager';
import type { ModelManager } from '../mmd/ModelManager';

/** 项目依赖注入接口 */
export interface ProjectCollectorDeps {
    sceneManager: SceneManager;
    modelManager: ModelManager;
    animationManager: AnimationManager;
    cameraManager: CameraManager | null;
    musicManager: MusicManager;
}

/** 当前 schema 版本号 */
const CURRENT_SCHEMA_VERSION = 1;

/**
 * 收集当前应用状态为 ProjectArchive
 */
export function collectArchive(deps: ProjectCollectorDeps, name?: string): ProjectArchive {
    const modelStateManager = ModelStateManager.getInstance();
    const shadingStateManager = ShadingStateManager.getInstance();
    const postProcStateManager = PostProcStateManager.getInstance();
    const modelOptStateManager = ModelOptStateManager.getInstance();
    const particleStateManager = ParticleStateManager.getInstance();
    const backgroundStateManager = BackgroundStateManager.getInstance();
    const groundStateManager = GroundStateManager.getInstance();
    const themeStateManager = ThemeStateManager.getInstance();

    const appVersion = getAppVersion();

    return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        appVersion,
        name: name || undefined,
        scene: collectSceneArchive(deps.sceneManager, backgroundStateManager, groundStateManager),
        models: collectModelsArchive(modelStateManager, deps.animationManager, deps.modelManager, modelOptStateManager, deps.cameraManager),
        shading: collectShadingArchive(shadingStateManager, modelStateManager),
        postProc: collectPostProcArchive(postProcStateManager, modelStateManager),
        modelOpt: collectModelOptArchive(modelOptStateManager, modelStateManager),
        particle: collectParticleArchive(particleStateManager),
        physics: collectPhysicsArchive(),
        camera: collectCameraArchive(deps.cameraManager),
        music: collectMusicArchive(deps.musicManager),
        appSettings: collectAppSettingsArchive(themeStateManager, deps.animationManager),
        lights: collectLightsArchive(),
        director: collectDirectorArchive()
    };
}

function getAppVersion(): string {
    return __APP_VERSION__;
}

function collectSceneArchive(
    sceneManager: SceneManager,
    backgroundStateManager: BackgroundStateManager,
    groundStateManager: GroundStateManager
): SceneArchive {
    const config = sceneManager.getConfig();
    const lightConfig = sceneManager.getLightConfig();

    const bgState = backgroundStateManager.getState();

    const background: BackgroundArchive = {
        type: bgState.type,
        environment: { ...bgState.environment },
        media: { ...bgState.media }
    };

    const groundState = groundStateManager.getState();
    const ground: GroundArchive = {
        type: groundState.type,
        scale: groundState.scale,
        height: groundState.height
    };

    let light: LightArchive;
    if (lightConfig) {
        const shadow: ShadowArchive = {
            enabled: lightConfig.shadow.enabled,
            resolution: lightConfig.shadow.resolution,
            selfShadow: lightConfig.shadow.selfShadow,
            quality: lightConfig.shadow.quality,
            intensity: lightConfig.shadow.intensity,
            filterMode: lightConfig.shadow.filterMode,
            bias: lightConfig.shadow.bias,
            normalBias: lightConfig.shadow.normalBias,
            darkness: lightConfig.shadow.darkness,
            frustumEdgeFalloff: lightConfig.shadow.frustumEdgeFalloff,
            transparencyShadow: lightConfig.shadow.transparencyShadow
        };
        light = {
            ambientIntensity: lightConfig.ambientIntensity,
            ambientColor: { ...lightConfig.ambientColor },
            directionalIntensity: lightConfig.directionalIntensity,
            directionalColor: { ...lightConfig.directionalColor },
            directionalDirection: { ...lightConfig.directionalDirection },
            shadow
        };
    } else {
        light = {
            ambientIntensity: 0.25,
            ambientColor: { r: 0.5, g: 0.5, b: 0.5 },
            directionalIntensity: 1,
            directionalColor: { r: 1, g: 1, b: 1 },
            directionalDirection: { x: 0, y: -0.3, z: 1 },
            shadow: {
                enabled: false, resolution: 1024, selfShadow: true, quality: 'medium',
                intensity: 1, filterMode: 'pcf', bias: 0.0003, normalBias: 0,
                darkness: 0, frustumEdgeFalloff: 0.1, transparencyShadow: true
            }
        };
    }

    return {
        backgroundColor: config.backgroundColor,
        gridVisible: config.gridVisible,
        background,
        ground,
        light
    };
}

function collectModelsArchive(
    modelStateManager: ModelStateManager,
    animationManager: AnimationManager,
    modelManager: ModelManager,
    modelOptStateManager: ModelOptStateManager,
    cameraManager: CameraManager | null
): ModelsArchive {
    const models = modelStateManager.getModels();

    const modelArchives: ModelArchive[] = models.map(model => {
        const ikEnabled = animationManager.getModelIkEnabled(model.id) ?? true;
        const visible = modelManager.isModelVisible(model.id);
        const enabled = modelOptStateManager.isModelEnabled(model.id);

        const animations = (model.animations ?? []).map(anim => ({
            filePath: anim.filePath,
            fileName: anim.fileName,
            appendMode: (anim as any).appendMode ?? 'blend' as const
        }));

        return {
            name: model.name,
            filePath: model.filePath,
            fileType: model.fileType,
            animations,
            ikEnabled,
            visible,
            enabled
        };
    });

    let cameraAnimation: CameraAnimationArchive | undefined;
    if (cameraManager) {
        const currentAnim = cameraManager.getCurrentAnimation();
        if (currentAnim) {
            cameraAnimation = {
                filePath: currentAnim.filePath,
                fileName: currentAnim.name
            };
        }
    }

    return {
        models: modelArchives,
        cameraAnimation
    };
}

function collectShadingArchive(
    shadingStateManager: ShadingStateManager,
    modelStateManager: ModelStateManager
): ShadingArchive {
    const shadingState = shadingStateManager.getState();
    const models = modelStateManager.getModels();

    // 构建 filePath → modelId 映射
    const filePathToModelId = new Map<string, string>();
    for (const model of models) {
        filePathToModelId.set(model.filePath, model.id);
    }

    const shadingModels: ShadingModelArchive[] = [];

    for (const [modelId, modelMaterials] of shadingState.materialStates.entries()) {
        const model = models.find(m => m.id === modelId);
        if (!model) continue;

        const renderStyle = shadingStateManager.getRenderStyle(modelId);
        const outlineState = shadingStateManager.getModelOutlineState(modelId);

        const materials: MaterialArchive[] = [];
        for (const [materialIndex, entry] of modelMaterials.entries()) {
            materials.push({
                index: materialIndex,
                adapterTypeId: entry.state.adapterTypeId,
                params: serializeParams(entry.state.params),
                isVisible: entry.state.isVisible,
                originalOutlineWidth: entry.originalOutlineWidth,
                originalOutlineColor: { ...entry.originalOutlineColor },
                originalOutlineAlpha: entry.originalOutlineAlpha,
                originalRenderOutline: entry.originalRenderOutline
            });
        }

        shadingModels.push({
            modelFilePath: model.filePath,
            renderStyle,
            outlineWidth: outlineState?.outlineWidth ?? 0,
            materials
        });
    }

    return { models: shadingModels };
}

/** 将 ParamValue 转换为可序列化的 ParamValueArchive */
function serializeParams(params: Record<string, any>): Record<string, ParamValueArchive> {
    const result: Record<string, ParamValueArchive> = {};
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
            result[key] = value;
        } else if (value && typeof value === 'object') {
            if ('r' in value && 'g' in value && 'b' in value) {
                result[key] = { r: value.r, g: value.g, b: value.b };
            } else if ('x' in value && 'y' in value && 'z' in value) {
                result[key] = { x: value.x, y: value.y, z: value.z };
            }
        }
    }
    return result;
}

function collectPostProcArchive(
    postProcStateManager: PostProcStateManager,
    modelStateManager: ModelStateManager
): PostProcArchive {
    const state = postProcStateManager.getState();
    const models = modelStateManager.getModels();

    // dofAutoFocusModelId → dofAutoFocusModelFilePath
    let dofAutoFocusModelFilePath = '';
    if (state.dofAutoFocusModelId) {
        const model = models.find(m => m.id === state.dofAutoFocusModelId);
        if (model) {
            dofAutoFocusModelFilePath = model.filePath;
        }
    }

    return {
        aaEnabled: state.aaEnabled,
        samples: state.samples,
        exposure: state.exposure,
        saturation: state.saturation,
        contrast: state.contrast,
        bloomEnabled: state.bloomEnabled,
        bloomIntensity: state.bloomIntensity,
        bloomThreshold: state.bloomThreshold,
        bloomKernel: state.bloomKernel,
        dofEnabled: state.dofEnabled,
        dofBlurIntensity: state.dofBlurIntensity,
        dofFocusDistance: state.dofFocusDistance,
        dofDepth: state.dofDepth,
        dofAutoFocusEnabled: state.dofAutoFocusEnabled,
        dofAutoFocusModelFilePath,
        vignetteEnabled: state.vignetteEnabled,
        vignetteIntensity: state.vignetteIntensity,
        vignetteSoftness: state.vignetteSoftness,
        vignetteColor: { ...state.vignetteColor },
        caEnabled: state.caEnabled,
        caIntensity: state.caIntensity,
        grainEnabled: state.grainEnabled,
        grainIntensity: state.grainIntensity,
        softFocusEnabled: state.softFocusEnabled,
        softFocusIntensity: state.softFocusIntensity,
        hueEnabled: state.hueEnabled,
        hueShift: state.hueShift
    };
}

function collectModelOptArchive(
    modelOptStateManager: ModelOptStateManager,
    modelStateManager: ModelStateManager
): ModelOptArchive {
    const state = modelOptStateManager.getState();
    const models = modelStateManager.getModels();

    // 构建 modelId → filePath 映射
    const idToPath = new Map<string, string>();
    for (const model of models) {
        idToPath.set(model.id, model.filePath);
    }

    // 骨骼校正
    const boneCorrections: BoneCorrectionArchive[] = [];
    for (const [modelId, boneMap] of state.boneCorrectionStates.entries()) {
        const modelFilePath = idToPath.get(modelId);
        if (!modelFilePath) continue;

        for (const [boneName, correction] of boneMap.entries()) {
            boneCorrections.push({
                modelFilePath,
                boneName,
                rotationOffsets: { ...correction.rotationOffsets },
                baseRotation: correction.baseRotation
                    ? { x: correction.baseRotation.x, y: correction.baseRotation.y, z: correction.baseRotation.z, w: correction.baseRotation.w }
                    : null
            });
        }
    }

    // 骨骼绑定
    const boneParentingBindings: BoneParentingArchive[] = [];
    for (const [id, binding] of state.boneParentingBindings.entries()) {
        const parentFilePath = idToPath.get(binding.parentModelId);
        const childFilePath = idToPath.get(binding.childModelId);
        if (!parentFilePath || !childFilePath) continue;

        boneParentingBindings.push({
            id: binding.id,
            parentModelFilePath: parentFilePath,
            parentBoneName: binding.parentBoneName,
            childModelFilePath: childFilePath,
            childBoneName: binding.childBoneName,
            enabled: binding.enabled
        });
    }

    // 表情权重
    const morphWeights: MorphWeightArchive[] = [];
    for (const [modelId, morphState] of state.morphStates.entries()) {
        const modelFilePath = idToPath.get(modelId);
        if (!modelFilePath) continue;

        const weights: Record<string, number> = {};
        for (const morph of morphState.morphs) {
            if (morph.weight !== 0) {
                weights[morph.name] = morph.weight;
            }
        }
        morphWeights.push({ modelFilePath, morphWeights: weights });
    }

    // 骨骼变换值（移动/旋转/缩放操作）
    const boneStates: BoneStateArchive[] = [];
    for (const [modelId, boneState] of state.boneStates.entries()) {
        const modelFilePath = idToPath.get(modelId);
        if (!modelFilePath) continue;

        for (const [boneName, record] of boneState.bones.entries()) {
            // 只保存非默认值（移动/旋转均为0，缩放为1）
            const isDefault =
                record.translation.x === 0 && record.translation.y === 0 && record.translation.z === 0 &&
                record.rotation.x === 0 && record.rotation.y === 0 && record.rotation.z === 0 &&
                record.scale.x === 1 && record.scale.y === 1 && record.scale.z === 1;
            if (isDefault) continue;

            boneStates.push({
                modelFilePath,
                boneName,
                translation: { ...record.translation },
                rotation: { ...record.rotation },
                scale: { ...record.scale }
            });
        }
    }

    return {
        boneCorrections,
        boneParentingBindings,
        morphWeights,
        boneStates,
        currentMode: state.currentMode,
        currentAxis: state.currentAxis
    };
}

function collectParticleArchive(particleStateManager: ParticleStateManager): ParticleArchive {
    const state = particleStateManager.getState();
    const systems: ParticleSystemArchive[] = [];

    state.systems.forEach((sys, type) => {
        systems.push({
            type: sys.type,
            enabled: sys.enabled,
            params: { ...sys.params }
        });
    });

    return {
        currentType: state.currentType,
        systems
    };
}

function collectPhysicsArchive(): PhysicsArchive {
    let sharedPhysicsWorld = false;
    try {
        const saved = localStorage.getItem('mikuplay_shared_physics_world');
        if (saved === 'true') sharedPhysicsWorld = true;
    } catch { /* ignore */ }

    let groundCollisionEnabled = true;
    if (PhysicsManager.hasInstance()) {
        groundCollisionEnabled = PhysicsManager.getInstance().isGroundCollisionEnabled();
    }

    return {
        sharedPhysicsWorld,
        groundCollisionEnabled
    };
}

function collectCameraArchive(cameraManager: CameraManager | null): CameraArchive {
    const offset = cameraManager?.getTargetOffset();
    return {
        targetOffset: offset ? { x: offset.x, y: offset.y, z: offset.z } : { x: 0, y: 0, z: 0 }
    };
}

function collectMusicArchive(musicManager: MusicManager): MusicArchive {
    const musicList = musicManager.getMusicList();
    const tracks: MusicTrackArchive[] = musicList.map(m => ({
        filePath: m.filePath,
        name: m.name
    }));

    return { tracks };
}

function collectAppSettingsArchive(
    themeStateManager: ThemeStateManager,
    animationManager: AnimationManager
): AppSettingsArchive {
    let frustumCulling = false;
    try {
        const saved = localStorage.getItem('mikuplay_frustum_culling');
        if (saved === 'true') frustumCulling = true;
    } catch { /* ignore */ }

    let renderScale = 0;
    try {
        const saved = localStorage.getItem('mikuplay_render_scale');
        if (saved !== null) renderScale = parseFloat(saved);
    } catch { /* ignore */ }

    return {
        theme: themeStateManager.getTheme(),
        frustumCulling,
        renderScale,
        animationPlaying: animationManager.isAnimationPlaying(),
        animationCurrentFrame: animationManager.getCurrentAnimationTime()
    };
}

/**
 * 收集灯光管理器设置
 */
function collectLightsArchive(): LightsArchive {
    const settings: Record<string, any> = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('lightMgr_')) {
                const raw = localStorage.getItem(key);
                if (raw) {
                    settings[key.replace('lightMgr_', '')] = JSON.parse(raw);
                }
            }
        }
    } catch (e) {
        console.warn('[ProjectCollector] 收集灯光管理器设置失败:', e);
    }
    return { settings };
}

/**
 * 收集导演模式设置
 */
function collectDirectorArchive(): DirectorArchive {
    try {
        const nodesRaw = localStorage.getItem('director_nodes');
        const presetsRaw = localStorage.getItem('director_presets');

        return {
            nodes: nodesRaw ? JSON.parse(nodesRaw).nodes || [] : [],
            presets: presetsRaw ? JSON.parse(presetsRaw).presets || [] : []
        };
    } catch (e) {
        console.warn('[ProjectCollector] 收集导演模式设置失败:', e);
        return { nodes: [], presets: [] };
    }
}
