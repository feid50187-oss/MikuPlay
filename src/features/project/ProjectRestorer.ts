import type {
    ProjectArchive, RestoreReport, SceneArchive, ModelsArchive,
    ShadingArchive, PostProcArchive, ModelOptArchive, ParticleArchive,
    PhysicsArchive, CameraArchive, MusicArchive, AppSettingsArchive,
    MaterialArchive, ShadingModelArchive, BoneCorrectionArchive,
    BoneParentingArchive, MorphWeightArchive, ParticleSystemArchive,
    BoneStateArchive
} from './ProjectArchive';
import { ModelStateManager } from '../mmd/ModelStateManager';
import { ShadingStateManager } from '../state/ShadingStateManager';
import { PostProcStateManager } from '../state/PostProcStateManager';
import { ModelOptStateManager } from '../state/ModelOptStateManager';
import { ParticleStateManager } from '../state/ParticleStateManager';
import { BackgroundStateManager } from '../state/BackgroundStateManager';
import { GroundStateManager } from '../state/GroundStateManager';
import { ThemeStateManager } from '../state/ThemeStateManager';
import { BoneManager } from '../mmd/BoneManager';
import type { SceneManager } from '../scene/SceneManager';
import type { AnimationManager } from '../mmd/AnimationManager';
import type { CameraManager } from '../mmd/CameraManager';
import type { MusicManager } from '../audio/MusicManager';
import { PhysicsManager } from '../mmd/PhysicsManager';
import type { ModelManager } from '../mmd/ModelManager';
import type { MmdMesh } from 'babylon-mmd/esm/Runtime/mmdMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { type MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import { PostProcessManager } from '../scene/PostProcessManager';
import type { MmdModelProvider } from '../scene/AutoFocusController';
import { materialAdapterRegistry } from '../shading/MaterialAdapterRegistry';
import { MmdStandardMaterial } from 'babylon-mmd/esm/Loader/mmdStandardMaterial';

/** 共享后处理管理器实例（由 restorePostProc 创建，供 PostProcPanel 复用） */
let sharedPostProcessManager: PostProcessManager | null = null;

//动画校正功能依旧存在问题，当前的恢复只能将微调应用在第一帧，之后的帧里动作呈现未微调的状态，未来再修复

/** 获取共享的后处理管理器 */
export function getSharedPostProcessManager(): PostProcessManager | null {
    return sharedPostProcessManager;
}

/** 项目恢复依赖注入接口 */
export interface ProjectRestorerDeps {
    sceneManager: SceneManager;
    modelManager: ModelManager;
    animationManager: AnimationManager;
    cameraManager: CameraManager | null;
    musicManager: MusicManager;
}

/**
 * 从 ProjectArchive 恢复应用状态
 */
export async function restoreArchive(archive: ProjectArchive, deps: ProjectRestorerDeps): Promise<RestoreReport> {
    const report: RestoreReport = {
        success: true,
        restoredModels: 0,
        restoredAnimations: 0,
        missingFiles: [],
        warnings: []
    };

    const filePathToModelId = new Map<string, string>();

    const modelStateManager = ModelStateManager.getInstance();
    const shadingStateManager = ShadingStateManager.getInstance();
    const postProcStateManager = PostProcStateManager.getInstance();
    const modelOptStateManager = ModelOptStateManager.getInstance();
    const particleStateManager = ParticleStateManager.getInstance();
    const backgroundStateManager = BackgroundStateManager.getInstance();
    const groundStateManager = GroundStateManager.getInstance();
    const themeStateManager = ThemeStateManager.getInstance();

    try {
        // Phase 0: 清理当前状态
        await clearCurrentState(deps, modelStateManager, shadingStateManager, modelOptStateManager);

        // Phase 1: 恢复场景环境
        restoreScene(archive.scene, deps.sceneManager, backgroundStateManager, groundStateManager);

        // Phase 2: 加载模型
        await restoreModels(archive.models, deps, modelStateManager, modelOptStateManager, filePathToModelId, report);

        // Phase 3: 加载动画
        await restoreAnimations(archive.models, deps.animationManager, modelStateManager, filePathToModelId, report);

        // Phase 4: 加载镜头动画
        await restoreCameraAnimation(archive.models, deps.cameraManager, report);

        // Phase 5: 恢复材质状态
        restoreShading(archive.shading, shadingStateManager, filePathToModelId, report);

        // Phase 5b: 根据渲染风格执行材质转换（实际切换材质）
        await applyRenderStyles(archive.shading, deps, filePathToModelId, report);

        // Phase 5c: 将存档中的材质参数和描边宽度实际应用到 mesh 材质对象
        applyMaterialData(archive.shading, deps, filePathToModelId, report);

        // Phase 6: 恢复后处理（同时直接应用到场景）
        restorePostProc(archive.postProc, postProcStateManager, filePathToModelId, deps);

        // Phase 7: 恢复模型操作状态
        restoreModelOpt(archive.modelOpt, modelOptStateManager, filePathToModelId, report, deps);

        // Phase 8: 恢复粒子
        restoreParticle(archive.particle, particleStateManager);

        // Phase 9: 恢复物理设置
        restorePhysics(archive.physics, deps);

        // Phase 10: 恢复相机设置
        restoreCamera(archive.camera, deps.cameraManager);

        // Phase 11: 恢复音乐
        await restoreMusic(archive.music, deps.musicManager, report);

        // Phase 12: 恢复应用设置
        restoreAppSettings(archive.appSettings, themeStateManager, deps.animationManager, deps.sceneManager);

        // Phase 12b: 恢复灯光管理器
        restoreLights(archive.lights);

        // Phase 12c: 恢复导演模式
        restoreDirector(archive.director);

        // Phase 13: IK 状态恢复（依赖模型已加载）
        for (const model of archive.models.models) {
            const modelId = filePathToModelId.get(model.filePath);
            if (modelId) {
                deps.animationManager.setModelIkEnabled(modelId, model.ikEnabled);
            } else {
                report.warnings.push(`IK 状态恢复跳过: 未找到模型 ${model.filePath}`);
            }
        }

    } catch (error) {
        report.success = false;
        report.warnings.push(`恢复过程中发生错误: ${error}`);
    }

    return report;
}

/** Phase 0: 清理当前状态 */
async function clearCurrentState(
    deps: ProjectRestorerDeps,
    modelStateManager: ModelStateManager,
    shadingStateManager: ShadingStateManager,
    modelOptStateManager: ModelOptStateManager
): Promise<void> {
    // 停止动画播放
    try {
        if (deps.animationManager.isAnimationPlaying()) {
            await deps.animationManager.stopAnimation();
        }
    } catch { /* ignore */ }

    // 删除所有模型
    const models = modelStateManager.getModels();
    for (const model of models) {
        try {
            await deps.modelManager.deleteModel(model.id);
        } catch { /* ignore */ }
    }

    // 清空状态管理器
    modelStateManager.clearState();

    // 清空 ShadingStateManager 中所有模型数据
    for (const model of models) {
        shadingStateManager.removeModel(model.id);
        modelOptStateManager.removeModelMorphs(model.id);
        modelOptStateManager.removeModelBones(model.id);
        modelOptStateManager.removeModelEnabledState(model.id);
        modelOptStateManager.removeModelBoneCorrections(model.id);
        modelOptStateManager.removeModelBoneParentingBindings(model.id);
    }

    // 清空音乐
    try {
        deps.musicManager.clearAllMusic();
    } catch { /* ignore */ }

    // 删除相机动画
    try {
        deps.cameraManager?.deleteCameraAnimation();
    } catch { /* ignore */ }
}

/** Phase 1: 恢复场景环境 */
function restoreScene(
    sceneArchive: SceneArchive,
    sceneManager: SceneManager,
    backgroundStateManager: BackgroundStateManager,
    groundStateManager: GroundStateManager
): void {
    sceneManager.setBackgroundColor(sceneArchive.backgroundColor);
    sceneManager.setGridVisible(sceneArchive.gridVisible);

    // 背景
    backgroundStateManager.setType(sceneArchive.background.type);
    sceneManager.setTransparentBackground(sceneArchive.background.type === 'transparent');
    const env = sceneArchive.background.environment;
    if (env.texturePath !== null) {
        backgroundStateManager.setEnvironmentTexturePath(env.texturePath);
    }
    backgroundStateManager.setEnvironmentRotation(env.rotation);
    backgroundStateManager.setEnvironmentExposure(env.exposure);

    const media = sceneArchive.background.media;
    if (media.sourceUri) {
        backgroundStateManager.setMediaSource(media.sourceUri, media.mediaType!, media.mediaWidth, media.mediaHeight);
    }
    backgroundStateManager.setMediaScale(media.scale);
    backgroundStateManager.setMediaPosition(media.positionX, media.positionY, media.positionZ);
    backgroundStateManager.setMediaOpacity(media.opacity);
    backgroundStateManager.setMediaBillboard(media.billboard);
    backgroundStateManager.setVideoPlaying(media.videoPlaying);
    backgroundStateManager.setVideoLoop(media.videoLoop);
    backgroundStateManager.setVideoVolume(media.videoVolume);

    // 地面
    groundStateManager.setGroundType(sceneArchive.ground.type);
    groundStateManager.setScale(sceneArchive.ground.scale);
    groundStateManager.setHeight(sceneArchive.ground.height);

    // 光照
    const lightManager = sceneManager.getLightManager();
    if (lightManager) {
        const light = sceneArchive.light;
        lightManager.setAmbientIntensity(light.ambientIntensity);
        lightManager.setAmbientColor(light.ambientColor.r, light.ambientColor.g, light.ambientColor.b);
        lightManager.setDirectionalIntensity(light.directionalIntensity);
        lightManager.setDirectionalColor(light.directionalColor.r, light.directionalColor.g, light.directionalColor.b);
        lightManager.setDirectionalDirection(light.directionalDirection.x, light.directionalDirection.y, light.directionalDirection.z);
        lightManager.setShadowConfig(light.shadow);
    }
}

/** Phase 2: 加载模型 */
async function restoreModels(
    modelsArchive: ModelsArchive,
    deps: ProjectRestorerDeps,
    modelStateManager: ModelStateManager,
    modelOptStateManager: ModelOptStateManager,
    filePathToModelId: Map<string, string>,
    report: RestoreReport
): Promise<void> {
    for (const modelArchive of modelsArchive.models) {
        try {
            const modelInfo = await deps.modelManager.loadModel(modelArchive.filePath, modelArchive.name);
            modelStateManager.addModel(modelInfo);
            await deps.animationManager.createMmdModel(modelInfo.id, modelInfo.mesh! as unknown as import('babylon-mmd/esm/Runtime/mmdMesh').MmdMesh);

            modelOptStateManager.initializeModelEnabledState(modelInfo.id);
            modelOptStateManager.setModelEnabled(modelInfo.id, modelArchive.enabled);
            deps.modelManager.setModelVisible(modelInfo.id, modelArchive.visible);

            filePathToModelId.set(modelArchive.filePath, modelInfo.id);
            report.restoredModels++;
        } catch (error) {
            report.success = false;
            report.missingFiles.push({
                type: 'model',
                filePath: modelArchive.filePath,
                name: modelArchive.name
            });
            report.warnings.push(`模型加载失败: ${modelArchive.name} - ${error}`);
        }
    }
}

/** Phase 3: 加载动画 */
async function restoreAnimations(
    modelsArchive: ModelsArchive,
    animationManager: AnimationManager,
    modelStateManager: ModelStateManager,
    filePathToModelId: Map<string, string>,
    report: RestoreReport
): Promise<void> {
    for (const modelArchive of modelsArchive.models) {
        const modelId = filePathToModelId.get(modelArchive.filePath);
        if (!modelId) {
            report.warnings.push(`动画恢复跳过: 未找到模型 ${modelArchive.filePath}`);
            continue;
        }

        const mmdModel = animationManager.getMmdModel(modelId);
        if (!mmdModel) {
            report.warnings.push(`动画恢复跳过: 模型未实例化 ${modelArchive.filePath}`);
            continue;
        }

        for (const animArchive of modelArchive.animations) {
            try {
                await animationManager.loadAnimation(
                    animArchive.filePath,
                    animArchive.fileName,
                    modelId,
                    mmdModel.mesh as unknown as MmdMesh,
                    animArchive.appendMode
                );
                modelStateManager.addAnimation(modelId, {
                    filePath: animArchive.filePath,
                    fileName: animArchive.fileName,
                    appendMode: animArchive.appendMode
                });
                report.restoredAnimations++;
            } catch (error) {
                report.missingFiles.push({
                    type: 'animation',
                    filePath: animArchive.filePath,
                    name: animArchive.fileName
                });
                report.warnings.push(`动画加载失败: ${animArchive.fileName} - ${error}`);
            }
        }
    }
}

/** Phase 4: 加载镜头动画 */
async function restoreCameraAnimation(
    modelsArchive: ModelsArchive,
    cameraManager: CameraManager | null,
    report?: RestoreReport
): Promise<void> {
    if (!cameraManager || !modelsArchive.cameraAnimation) return;

    try {
        await cameraManager.loadCameraAnimation(
            modelsArchive.cameraAnimation.filePath,
            modelsArchive.cameraAnimation.fileName
        );
    } catch (error) {
        const msg = `镜头动画加载失败: ${error}`;
        console.warn(`[ProjectRestorer] ${msg}`);
        report?.warnings.push(msg);
    }
}

/** Phase 5: 恢复材质状态 */
function restoreShading(
    shadingArchive: ShadingArchive,
    shadingStateManager: ShadingStateManager,
    filePathToModelId: Map<string, string>,
    report: RestoreReport
): void {
    for (const shadingModel of shadingArchive.models) {
        const modelId = filePathToModelId.get(shadingModel.modelFilePath);
        if (!modelId) {
            report.warnings.push(`材质恢复跳过: 未找到模型 ${shadingModel.modelFilePath}`);
            continue;
        }

        shadingStateManager.setRenderStyle(modelId, shadingModel.renderStyle);
        shadingStateManager.setModelOutlineState(modelId, { outlineWidth: shadingModel.outlineWidth });

        for (const material of shadingModel.materials) {
            shadingStateManager.setMaterialStateNew(modelId, material.index, {
                adapterTypeId: material.adapterTypeId,
                params: material.params as any,
                isVisible: material.isVisible
            });
            shadingStateManager.setOriginalOutlineProperties(
                modelId,
                material.index,
                material.originalOutlineWidth,
                material.originalOutlineColor,
                material.originalOutlineAlpha,
                material.originalRenderOutline
            );
        }
    }
}

/**
 * Phase 5b: 根据存档中的渲染风格设置，实际切换材质
 * 解决渲染风格存档后无法自动恢复的问题
 */
async function applyRenderStyles(
    shadingArchive: ShadingArchive,
    deps: ProjectRestorerDeps,
    filePathToModelId: Map<string, string>,
    report: RestoreReport
): Promise<void> {
    const shadingStateManager = ShadingStateManager.getInstance();
    const scene = deps.sceneManager.getScene();
    if (!scene) return;

    for (const shadingModel of shadingArchive.models) {
        const modelId = filePathToModelId.get(shadingModel.modelFilePath);
        if (!modelId) {
            report.warnings.push(`渲染风格应用跳过: 未找到模型 ${shadingModel.modelFilePath}`);
            continue;
        }

        const renderStyle = shadingModel.renderStyle;
        // mmd-standard 无需材质转换
        if (renderStyle === 'mmd-standard') continue;

        const adapter = materialAdapterRegistry.get(renderStyle);
        if (!adapter || !adapter.createsMaterial) continue;

        const mmdModel = deps.animationManager.getMmdModel(modelId);
        if (!mmdModel) continue;

        const materials = mmdModel.mesh?.metadata?.materials;
        const meshes = mmdModel.mesh?.metadata?.meshes;
        if (!materials || !meshes) continue;

        for (let i = 0; i < materials.length; i++) {
            const oldMaterial = materials[i];
            if (!oldMaterial) continue;
            if (adapter.canHandle(oldMaterial)) continue;

            let newMaterial;
            if (adapter.convertFromMmd) {
                try {
                    newMaterial = adapter.convertFromMmd(oldMaterial, scene);
                } catch (e) {
                    report.warnings.push(`材质 ${i} 转换失败: ${e}`);
                    continue;
                }
            } else {
                continue;
            }

            // 保存原始 MMD 材质引用
            shadingStateManager.saveOriginalMmdMaterial(modelId, i, oldMaterial);
            shadingStateManager.setConvertedMaterial(modelId, i, newMaterial!);

            // 替换材质
            for (const mesh of meshes) {
                if (mesh.material === oldMaterial) {
                    mesh.material = newMaterial;
                }
            }
            (materials as Material[])[i] = newMaterial!;
        }
    }
}

/**
 * Phase 5c: 将存档中的材质参数和描边宽度实际应用到 mesh 材质对象
 * 解决材质参数/描边宽度仅写入 StateManager 而未生效的问题
 */
function applyMaterialData(
    shadingArchive: ShadingArchive,
    deps: ProjectRestorerDeps,
    filePathToModelId: Map<string, string>,
    report: RestoreReport
): void {
    for (const shadingModel of shadingArchive.models) {
        const modelId = filePathToModelId.get(shadingModel.modelFilePath);
        if (!modelId) {
            report.warnings.push(`材质数据应用跳过: 未找到模型 ${shadingModel.modelFilePath}`);
            continue;
        }

        const mmdModel = deps.animationManager.getMmdModel(modelId);
        if (!mmdModel) {
            report.warnings.push(`材质数据应用跳过: 模型未实例化 ${shadingModel.modelFilePath}`);
            continue;
        }

        const materials = mmdModel.mesh?.metadata?.materials;
        if (!materials) continue;

        // 应用每个材质的参数到实际 Babylon 材质对象
        for (const materialArchive of shadingModel.materials) {
            const index = materialArchive.index;
            if (index < 0 || index >= materials.length) continue;
            const babylonMat = materials[index];
            if (!babylonMat) continue;

            // 通过适配器应用参数
            const adapter = materialAdapterRegistry.get(materialArchive.adapterTypeId);
            if (adapter) {
                try {
                    adapter.writeState(babylonMat, materialArchive.params as any);
                } catch (e) {
                    report.warnings.push(`材质参数应用失败 [${shadingModel.modelFilePath} #${index}]: ${e}`);
                }
            }
        }

        // 应用描边宽度：遍历并设置 MmdStandardMaterial 的 outline
        for (const materialArchive of shadingModel.materials) {
            const index = materialArchive.index;
            if (index < 0 || index >= materials.length) continue;
            const babylonMat = materials[index];
            if (!babylonMat || !(babylonMat instanceof MmdStandardMaterial)) continue;

            if (materialArchive.originalRenderOutline && shadingModel.outlineWidth > 0) {
                babylonMat.outlineWidth = shadingModel.outlineWidth;
                babylonMat.renderOutline = true;
            } else {
                babylonMat.renderOutline = false;
            }
        }
    }
}

/** Phase 6: 恢复后处理（同时直接应用到场景，无需手动打开面板） */
function restorePostProc(
    postProcArchive: PostProcArchive,
    postProcStateManager: PostProcStateManager,
    filePathToModelId: Map<string, string>,
    deps: ProjectRestorerDeps
): void {
    // dofAutoFocusModelFilePath → dofAutoFocusModelId
    let dofAutoFocusModelId = '';
    if (postProcArchive.dofAutoFocusModelFilePath) {
        dofAutoFocusModelId = filePathToModelId.get(postProcArchive.dofAutoFocusModelFilePath) ?? '';
    }

    postProcStateManager.setState({
        ...postProcArchive,
        dofAutoFocusModelId
    } as any);

    // 直接创建并应用 PostProcessManager，使后处理立即生效
    const scene = deps.sceneManager.getScene();
    const camera = deps.sceneManager.getCamera();
    if (!scene || !camera) return;

    try {
        // 清理旧的共享管理器
        if (sharedPostProcessManager) {
            sharedPostProcessManager.dispose();
        }

        const ppm = new PostProcessManager();
        const modelProvider: MmdModelProvider = {
            getMmdModel(modelId: string) { return deps.animationManager.getMmdModel(modelId); },
            getAllMmdModelIds(): string[] {
                const ids: string[] = [];
                const entries = deps.animationManager.getAllMmdModelEntries?.();
                if (entries) {
                    for (const [id] of entries) ids.push(id);
                }
                return ids;
            },
            getMeshForModel() { return undefined; }
        };
        ppm.initialize(scene, camera, modelProvider);
        ppm.applyState({
            ...postProcArchive,
            dofAutoFocusModelId
        } as any);
        sharedPostProcessManager = ppm;
    } catch (e) {
        console.warn('[ProjectRestorer] 后处理直接应用失败:', e);
    }
}

/** Phase 7: 恢复模型操作状态 */
function restoreModelOpt(
    modelOptArchive: ModelOptArchive,
    modelOptStateManager: ModelOptStateManager,
    filePathToModelId: Map<string, string>,
    report: RestoreReport,
    deps: ProjectRestorerDeps
): void {
    const boneManager = BoneManager.getInstance();

    // 骨骼校正
    let skippedCorrections = 0;
    for (const correction of modelOptArchive.boneCorrections) {
        const modelId = filePathToModelId.get(correction.modelFilePath);
        if (!modelId) { skippedCorrections++; continue; }

        modelOptStateManager.setBoneCorrectionValue(modelId, correction.boneName, 'x', correction.rotationOffsets.x);
        modelOptStateManager.setBoneCorrectionValue(modelId, correction.boneName, 'y', correction.rotationOffsets.y);
        modelOptStateManager.setBoneCorrectionValue(modelId, correction.boneName, 'z', correction.rotationOffsets.z);

        if (correction.baseRotation) {
            const q = Quaternion.FromArray([
                correction.baseRotation.x,
                correction.baseRotation.y,
                correction.baseRotation.z,
                correction.baseRotation.w
            ]);
            modelOptStateManager.setBoneCorrectionBaseRotation(modelId, correction.boneName, q);
        }
    }
    if (skippedCorrections > 0) {
        report.warnings.push(`骨骼校正恢复跳过: ${skippedCorrections} 条记录因模型未找到而跳过`);
    }

    // 恢复骨骼校正值后立即应用到骨骼，避免依赖动画 tick 时机
    // 依旧存在问题，当前的恢复只能将微调应用在第一帧，之后的帧里动作呈现未微调的状态，未来再修复
    skippedCorrections = 0;
    for (const correction of modelOptArchive.boneCorrections) {
        const modelId = filePathToModelId.get(correction.modelFilePath);
        if (!modelId) { skippedCorrections++; continue; }
        boneManager.applyBoneRotationOffsetsSync(
            modelId,
            correction.boneName,
            correction.rotationOffsets,
            false
        );
    }
    if (skippedCorrections > 0) {
        report.warnings.push(`骨骼校正应用跳过: ${skippedCorrections} 条记录因模型未找到而跳过`);
    }

    // 表情权重
    let skippedMorphs = 0;
    for (const morphArchive of modelOptArchive.morphWeights) {
        const modelId = filePathToModelId.get(morphArchive.modelFilePath);
        if (!modelId) { skippedMorphs++; continue; }

        // 获取 mmdModel 以实际应用形态键权重
        const mmdModel = deps.animationManager.getMmdModel(modelId);
        if (!mmdModel) {
            report.warnings.push(`表情权重恢复跳过: 模型未实例化 ${morphArchive.modelFilePath}`);
            continue;
        }

        // 确保形态键状态已初始化（类似 MorphOperationSection.displayMorphs 的逻辑）
        let morphState = modelOptStateManager.getModelMorphState(modelId);
        if (!morphState) {
            // 初始化形态键状态
            const runtimeMorphs = mmdModel.morph.morphs;
            const morphInfos = runtimeMorphs.map((m: any, idx: number) => ({
                name: m.name,
                index: idx,
                weight: mmdModel.morph.getMorphWeightFromIndex(idx)
            }));
            modelOptStateManager.initializeModelMorphs(modelId, morphInfos);
            morphState = modelOptStateManager.getModelMorphState(modelId);
        }

        if (!morphState) continue;

        // 应用每个形态键的权重
        for (const [morphName, weight] of Object.entries(morphArchive.morphWeights)) {
            const morphInfo = morphState.morphs.find(m => m.name === morphName);
            if (morphInfo) {
                // 实际应用到模型
                mmdModel.morph.setMorphWeightFromIndex(morphInfo.index, weight);
                // 更新状态管理器
                modelOptStateManager.setMorphWeight(modelId, morphInfo.index, weight);
            }
        }
    }
    if (skippedMorphs > 0) {
        report.warnings.push(`表情权重恢复跳过: ${skippedMorphs} 条记录因模型未找到而跳过`);
    }

    // 骨骼绑定
    let skippedBindings = 0;
    for (const binding of modelOptArchive.boneParentingBindings) {
        const parentModelId = filePathToModelId.get(binding.parentModelFilePath);
        const childModelId = filePathToModelId.get(binding.childModelFilePath);
        if (!parentModelId || !childModelId) { skippedBindings++; continue; }

        modelOptStateManager.addBoneParentingBinding({
            id: binding.id,
            parentModelId,
            parentBoneName: binding.parentBoneName,
            childModelId,
            childBoneName: binding.childBoneName,
            enabled: binding.enabled
        });

        // 设置基线偏移并确保每帧更新，否则绑定仅存在于状态中但不生效
        BoneManager.getInstance().setParentingBaselineZero(binding.id);
        BoneManager.getInstance().ensureParentingUpdate();
    }
    if (skippedBindings > 0) {
        report.warnings.push(`骨骼绑定恢复跳过: ${skippedBindings} 条记录因模型未找到而跳过`);
    }

    // 操作模式
    modelOptStateManager.setMode(modelOptArchive.currentMode);
    modelOptStateManager.setAxis(modelOptArchive.currentAxis);

    // 骨骼变换值（移动/旋转/缩放）
    let skippedBoneStates = 0;
    for (const boneState of modelOptArchive.boneStates) {
        const modelId = filePathToModelId.get(boneState.modelFilePath);
        if (!modelId) { skippedBoneStates++; continue; }

        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'move', 'x', boneState.translation.x);
        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'move', 'y', boneState.translation.y);
        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'move', 'z', boneState.translation.z);
        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'rotate', 'x', boneState.rotation.x);
        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'rotate', 'y', boneState.rotation.y);
        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'rotate', 'z', boneState.rotation.z);
        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'scale', 'x', boneState.scale.x);
        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'scale', 'y', boneState.scale.y);
        modelOptStateManager.setBoneTransformValue(modelId, boneState.boneName, 'scale', 'z', boneState.scale.z);

        // 实际应用到骨骼，避免必须手动点击骨骼才生效
        BoneManager.getInstance().restoreBoneTransform(modelId, boneState.boneName);
    }
    if (skippedBoneStates > 0) {
        report.warnings.push(`骨骼变换值恢复跳过: ${skippedBoneStates} 条记录因模型未找到而跳过`);
    }
}

/** Phase 8: 恢复粒子 */
function restoreParticle(
    particleArchive: ParticleArchive,
    particleStateManager: ParticleStateManager
): void {
    particleStateManager.setSystem(particleArchive.currentType);

    for (const system of particleArchive.systems) {
        particleStateManager.setEnabled(system.type, system.enabled);
        for (const [param, value] of Object.entries(system.params)) {
            particleStateManager.setParam(system.type, param, value);
        }
    }
}

/** Phase 9: 恢复物理设置 */
function restorePhysics(physicsArchive: PhysicsArchive, deps: ProjectRestorerDeps): void {
    if (PhysicsManager.hasInstance()) {
        PhysicsManager.getInstance().setGroundCollisionEnabled(physicsArchive.groundCollisionEnabled);
    }

    try {
        localStorage.setItem('mikuplay_shared_physics_world', String(physicsArchive.sharedPhysicsWorld));
    } catch { /* ignore */ }
}

/** Phase 10: 恢复相机设置 */
function restoreCamera(cameraArchive: CameraArchive, cameraManager: CameraManager | null): void {
    if (cameraManager) {
        if (cameraArchive.targetOffset) {
            cameraManager.setTargetOffset(
                cameraArchive.targetOffset.x,
                cameraArchive.targetOffset.y,
                cameraArchive.targetOffset.z
            );
        } else {
            // 兼容旧格式：heightCorrectionOffset（仅 Y 轴偏移）
            const legacyOffset = (cameraArchive as CameraArchive & { heightCorrectionOffset?: number }).heightCorrectionOffset;
            if (legacyOffset !== undefined) {
                cameraManager.setTargetOffset(0, legacyOffset, 0);
            }
        }
    }
}

/** Phase 11: 恢复音乐 */
async function restoreMusic(musicArchive: MusicArchive, musicManager: MusicManager, report?: RestoreReport): Promise<void> {
    let firstId: string | null = null;
    for (const track of musicArchive.tracks) {
        try {
            const info = await musicManager.importMusic(track.filePath, track.name);
            // 时长为 0 说明 Worker 无法获取文件，文件很可能已不存在
            if (info.duration === 0) {
                const msg = `音乐文件不存在: ${track.name}(${track.filePath})`;
                console.warn(`[ProjectRestorer] ${msg}`);
                report?.warnings.push(msg);
            }
            if (firstId === null) {
                firstId = info.id;
            }
        } catch (error) {
            const msg = `音乐加载失败: ${track.name} - ${error}`;
            console.warn(`[ProjectRestorer] ${msg}`);
            report?.warnings.push(msg);
        }
    }
    // 加载第一首音乐为当前音乐，使其可直接播放
    if (firstId) {
        await musicManager.loadMusic(firstId);
    }
}

/** Phase 12: 恢复应用设置 */
function restoreAppSettings(
    appSettings: AppSettingsArchive,
    themeStateManager: ThemeStateManager,
    animationManager: AnimationManager,
    sceneManager: SceneManager
): void {
    themeStateManager.setTheme(appSettings.theme);
    sceneManager.setFrustumCullingEnabled(appSettings.frustumCulling);

    if (appSettings.renderScale > 0) {
        sceneManager.setHardwareScalingLevel(appSettings.renderScale);
    }

    try {
        localStorage.setItem('mikuplay_frustum_culling', String(appSettings.frustumCulling));
        localStorage.setItem('mikuplay_render_scale', String(appSettings.renderScale));
    } catch { /* ignore */ }

    // 恢复动画播放状态
    if (appSettings.animationPlaying && appSettings.animationCurrentFrame > 0) {
        animationManager.seekAnimation(appSettings.animationCurrentFrame).then(() => {
            animationManager.playAnimation().catch(() => {});
        }).catch(() => {});
    }
}

/**
 * 恢复灯光管理器设置
 */
function restoreLights(lightsArchive: LightsArchive | undefined): void {
    if (!lightsArchive || !lightsArchive.settings) return;

    try {
        // 先清除旧的灯光管理器设置
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('lightMgr_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));

        // 恢复新的设置
        Object.entries(lightsArchive.settings).forEach(([key, value]) => {
            localStorage.setItem(`lightMgr_${key}`, JSON.stringify(value));
        });

        console.log('[ProjectRestorer] 灯光管理器设置已恢复');
    } catch (e) {
        console.warn('[ProjectRestorer] 恢复灯光管理器设置失败:', e);
    }
}

/**
 * 恢复导演模式设置
 */
function restoreDirector(directorArchive: DirectorArchive | undefined): void {
    if (!directorArchive) return;

    try {
        // 恢复镜头节点
        if (directorArchive.nodes) {
            localStorage.setItem('director_nodes', JSON.stringify({ nodes: directorArchive.nodes }));
        }

        // 恢复用户预设
        if (directorArchive.presets) {
            localStorage.setItem('director_presets', JSON.stringify({ presets: directorArchive.presets }));
        }

        console.log('[ProjectRestorer] 导演模式设置已恢复');
    } catch (e) {
        console.warn('[ProjectRestorer] 恢复导演模式设置失败:', e);
    }
}
