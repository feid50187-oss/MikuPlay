
import type { Material, Scene, Nullable } from '@babylonjs/core';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
import type { IMaterialAdapter, ParamValue } from '../../core/IMaterialAdapter';
import type { ControlDeclaration } from '../../core/IPlugin';
import { Material as BabylonMaterial } from '@babylonjs/core/Materials/material';

/** IBL 环境贴图文件相对于 Vite public 目录的路径 */
const IBL_ENV_URL = '/assets/IBL.env';

/** 日志前缀 */
const LOG_PREFIX = '[PBR Builtin]';

function log(message: string): void {
    console.log(LOG_PREFIX, message);
}

function logWarn(message: string): void {
    console.warn(LOG_PREFIX, message);
}

function logError(message: string): void {
    console.error(LOG_PREFIX, message);
}

export class PbrMaterialAdapter implements IMaterialAdapter {
    readonly typeId = 'pbr-advanced';
    readonly displayName = 'PBR材质';
    readonly supportsOutline = false;
    readonly supportsMorph = false;
    readonly createsMaterial = true;

    /** IBL 环境贴图缓存（类级别，所有实例共享） */
    private static _iblEnvironmentTexture: CubeTexture | null = null;

    /** IBL 全局旋转角度 */
    private static _iblRotationY = 0;

    /** 当前已设置 IBL 的场景引用，避免重复设置 */
    private static _currentScene: Scene | null = null;

    private static readonly _controlDeclarations: ControlDeclaration[] = [
        // 基础 PBR 参数
        { param: 'metallic', type: 'slider', label: '金属度', min: 0, max: 1, step: 0.01, group: '基础' },
        { param: 'roughness', type: 'slider', label: '粗糙度', min: 0, max: 1, step: 0.01, group: '基础' },
        { param: 'environmentIntensity', type: 'slider', label: 'IBL强度', min: 0, max: 1, step: 0.01, group: '基础' },
        { param: 'iblRotationY', type: 'slider', label: 'IBL旋转', min: 0, max: 6.28, step: 0.01, group: '基础' },

        // 自发光
        { param: 'emissiveIntensity', type: 'slider', label: '强度', min: 0, max: 1, step: 0.01, group: '自发光' },

        // 次表面散射 (SSS)
        { param: 'subSurfaceScattering', type: 'toggle', label: '次表面散射', group: '次表面散射' },
        { param: 'subSurfaceIntensity', type: 'slider', label: '强度', min: 0, max: 1, step: 0.01, group: '次表面散射' },
        { param: 'subSurfaceScatteringColor', type: 'color', label: '散射色', group: '次表面散射' },
        { param: 'sssDiffusionDistance', type: 'slider', label: '扩散距离', min: 0, max: 2, step: 0.01, group: '次表面散射' },
        { param: 'sssMinThickness', type: 'slider', label: '最小厚度', min: 0, max: 10, step: 0.1, group: '次表面散射' },
        { param: 'sssMaxThickness', type: 'slider', label: '最大厚度', min: 0, max: 10, step: 0.1, group: '次表面散射' },

        // 透射
        { param: 'transmissionIntensity', type: 'slider', label: '强度', min: 0, max: 1, step: 0.01, group: '透射' },
        { param: 'transmissionIndexOfRefraction', type: 'slider', label: '折射率', min: 1, max: 2.5, step: 0.01, group: '透射' },

        // 反射
        { param: 'indexOfRefraction', type: 'slider', label: '折射率', min: 1, max: 2.5, step: 0.01, group: '反射' },

        // 透明度和裁剪
        { param: 'alpha', type: 'slider', label: 'Alpha', min: 0, max: 1, step: 0.01, group: '透明度' },
        { param: 'alphaBlendMode', type: 'dropdown', label: '混合模式',
          options: ['opaque', 'alphaTest', 'alphaBlend', 'alphaTestAndBlend'],
          optionLabels: ['不透明', '测试', '混合', '测试+混合'], group: '透明度' },
        { param: 'cullMode', type: 'dropdown', label: '单双面',
          options: ['doubleSided', 'front', 'back'],
          optionLabels: ['双面', '里面', '外面'], group: '透明度' },
    ];

    canHandle(material: Material): boolean {
        return material.getClassName?.() === 'PBRMaterial';
    }

    readState(material: Material): Record<string, ParamValue> {
        const pbrMat = material as PBRMaterial;
        const subSurface = pbrMat.subSurface;

        let alphaBlendMode = 'opaque';
        if (pbrMat.transparencyMode === BabylonMaterial.MATERIAL_ALPHATEST) {
            alphaBlendMode = 'alphaTest';
        } else if (pbrMat.transparencyMode === BabylonMaterial.MATERIAL_ALPHABLEND) {
            alphaBlendMode = 'alphaBlend';
        } else if (pbrMat.transparencyMode === BabylonMaterial.MATERIAL_ALPHATESTANDBLEND) {
            alphaBlendMode = 'alphaTestAndBlend';
        }

        let cullMode = 'back';
        if (!pbrMat.backFaceCulling) {
            cullMode = 'doubleSided';
        } else if (pbrMat.sideOrientation === BabylonMaterial.ClockWiseSideOrientation) {
            cullMode = 'front';
        }

        const tc = subSurface.translucencyColor;

        return {
            metallic: pbrMat.metallic ?? 0,
            roughness: pbrMat.roughness ?? 0.5,
            environmentIntensity: pbrMat.environmentIntensity,
            iblRotationY: PbrMaterialAdapter._iblRotationY,
            emissiveIntensity: pbrMat.emissiveIntensity,
            subSurfaceScattering: subSurface.isTranslucencyEnabled || false,
            subSurfaceIntensity: subSurface.translucencyIntensity || 0,
            subSurfaceScatteringColor: tc ? { r: tc.r, g: tc.g, b: tc.b } : { r: 1, g: 0.5, b: 0.5 },
            sssDiffusionDistance: (subSurface as any).translucencyDiffusionDistance ?? 0,
            sssMinThickness: subSurface.minimumThickness ?? 0,
            sssMaxThickness: subSurface.maximumThickness ?? 1,
            transmissionIntensity: subSurface.refractionIntensity || 0,
            transmissionIndexOfRefraction: subSurface.indexOfRefraction || 1.5,
            indexOfRefraction: pbrMat.indexOfRefraction || 1.5,
            alpha: pbrMat.alpha,
            alphaBlendMode,
            cullMode,
            isVisible: true,
        };
    }

    writeState(material: Material, state: Record<string, ParamValue>): void {
        const pbrMat = material as PBRMaterial;

        if (typeof state.metallic === 'number') {
            pbrMat.metallic = state.metallic;
        }

        if (typeof state.roughness === 'number') {
            pbrMat.roughness = state.roughness;
        }

        if (typeof state.environmentIntensity === 'number') {
            pbrMat.environmentIntensity = state.environmentIntensity;
        }

        // IBL 旋转（全局共享）
        if (typeof state.iblRotationY === 'number') {
            PbrMaterialAdapter._iblRotationY = state.iblRotationY;
            if (PbrMaterialAdapter._iblEnvironmentTexture) {
                PbrMaterialAdapter._iblEnvironmentTexture.rotationY = PbrMaterialAdapter._iblRotationY;
            }
        }

        if (typeof state.emissiveIntensity === 'number') {
            pbrMat.emissiveIntensity = state.emissiveIntensity;
        }

        // 次表面散射 (Translucency)
        if (typeof state.subSurfaceScattering === 'boolean') {
            pbrMat.subSurface.isTranslucencyEnabled = state.subSurfaceScattering;

            // SSS 必须开启双面光照和禁用背面剔除，否则透光效果无法正确计算
            if (state.subSurfaceScattering) {
                pbrMat.backFaceCulling = false;
                pbrMat.twoSidedLighting = true;
            }
        }

        if (typeof state.subSurfaceIntensity === 'number') {
            pbrMat.subSurface.translucencyIntensity = state.subSurfaceIntensity;
        }

        if (state.subSurfaceScatteringColor && typeof state.subSurfaceScatteringColor === 'object' && 'r' in state.subSurfaceScatteringColor) {
            const sc = state.subSurfaceScatteringColor as { r: number; g: number; b: number };
            pbrMat.subSurface.translucencyColor = new Color3(sc.r, sc.g, sc.b);
        }

        if (typeof state.sssDiffusionDistance === 'number') {
            (pbrMat.subSurface as any).translucencyDiffusionDistance = state.sssDiffusionDistance;
        }

        if (typeof state.sssMinThickness === 'number') {
            pbrMat.subSurface.minimumThickness = state.sssMinThickness;
        }

        if (typeof state.sssMaxThickness === 'number') {
            pbrMat.subSurface.maximumThickness = state.sssMaxThickness;
        }

        // 透射参数 (Refraction)
        if (typeof state.transmissionIntensity === 'number') {
            pbrMat.subSurface.isRefractionEnabled = state.transmissionIntensity > 0;
            pbrMat.subSurface.refractionIntensity = state.transmissionIntensity;
        }

        if (typeof state.transmissionIndexOfRefraction === 'number') {
            pbrMat.subSurface.indexOfRefraction = state.transmissionIndexOfRefraction;
        }

        // 折射率（反射）
        if (typeof state.indexOfRefraction === 'number') {
            pbrMat.indexOfRefraction = state.indexOfRefraction;
        }

        // Alpha
        if (typeof state.alpha === 'number') {
            pbrMat.alpha = state.alpha;
        }

        // Alpha 混合模式
        if (typeof state.alphaBlendMode === 'string') {
            const scene = pbrMat.getScene();
            switch (state.alphaBlendMode) {
                case 'opaque':
                    pbrMat.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
                    pbrMat.needDepthPrePass = false;
                    pbrMat.forceDepthWrite = false;
                    break;
                case 'alphaTest':
                    pbrMat.transparencyMode = BabylonMaterial.MATERIAL_ALPHATEST;
                    pbrMat.needDepthPrePass = false;
                    pbrMat.forceDepthWrite = false;
                    break;
                case 'alphaBlend':
                    pbrMat.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
                    pbrMat.needDepthPrePass = false;
                    pbrMat.forceDepthWrite = false;
                    break;
                case 'alphaTestAndBlend':
                    // 解决二值透明材质的自透明穿透
                    pbrMat.transparencyMode = BabylonMaterial.MATERIAL_ALPHATESTANDBLEND;
                    pbrMat.needDepthPrePass = true;
                    pbrMat.forceDepthWrite = false;
                    break;
            }
        }

        // 裁剪模式（注意：SSS 开启时会强制双面光照，此设置会被覆盖）
        const sssEnabled = state.subSurfaceScattering === true;
        if (typeof state.cullMode === 'string' && !sssEnabled) {
            switch (state.cullMode) {
                case 'doubleSided':
                    pbrMat.backFaceCulling = false;
                    pbrMat.twoSidedLighting = true;
                    pbrMat.sideOrientation = BabylonMaterial.CounterClockWiseSideOrientation;
                    break;
                case 'front':
                    pbrMat.backFaceCulling = true;
                    pbrMat.twoSidedLighting = false;
                    pbrMat.sideOrientation = BabylonMaterial.ClockWiseSideOrientation;
                    break;
                case 'back':
                    pbrMat.backFaceCulling = true;
                    pbrMat.twoSidedLighting = false;
                    pbrMat.sideOrientation = BabylonMaterial.CounterClockWiseSideOrientation;
                    break;
            }
        }

        // 强制更新材质
        pbrMat.markAsDirty(BabylonMaterial.TextureDirtyFlag | BabylonMaterial.LightDirtyFlag);
    }

    getControlDeclarations(): ControlDeclaration[] {
        return PbrMaterialAdapter._controlDeclarations;
    }

    getDefaultState(): Record<string, ParamValue> {
        return {
            metallic: 0,
            roughness: 0.5,
            environmentIntensity: 0.5,
            iblRotationY: 0,
            emissiveIntensity: 0,
            subSurfaceScattering: false,
            subSurfaceIntensity: 0,
            subSurfaceScatteringColor: { r: 1, g: 0.68, b: 0.67 },
            sssDiffusionDistance: 0,
            sssMinThickness: 0,
            sssMaxThickness: 1,
            transmissionIntensity: 0,
            transmissionIndexOfRefraction: 1.5,
            indexOfRefraction: 1.5,
            alpha: 1,
            alphaBlendMode: 'opaque',
            cullMode: 'back',
            isVisible: true,
        };
    }

    convertFromMmd(mmdMaterial: Material, scene: Scene): Material {
        log('转换材质: ' + mmdMaterial.name + ' -> PBR');

        const pbrMaterial = new PBRMaterial(mmdMaterial.name, scene);

        // 加载 IBL 环境贴图（仅在首次加载时执行一次）
        this.ensureIBLEnvironment(scene);

        // Albedo 颜色
        const mmdAny = mmdMaterial as any;
        pbrMaterial.albedoColor = new Color3(
            mmdAny.diffuseColor.r,
            mmdAny.diffuseColor.g,
            mmdAny.diffuseColor.b
        );

        // 金属度
        pbrMaterial.metallic = 0;

        // 粗糙度：从 MMD 反射强度近似映射
        const specularPower = mmdAny.specularPower || 10;
        const roughness = 1 - Math.min(1, Math.log(specularPower + 1) / Math.log(101));
        pbrMaterial.roughness = Math.max(0.04, roughness);

        // Alpha
        pbrMaterial.alpha = mmdMaterial.alpha;
        if (mmdMaterial.alpha < 1) {
            pbrMaterial.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
        }

        // 纹理映射
        if (mmdAny.diffuseTexture) {
            pbrMaterial.albedoTexture = mmdAny.diffuseTexture;
            pbrMaterial.emissiveTexture = mmdAny.diffuseTexture;
            (pbrMaterial as any).useEmissiveAsIllumination = true;
        }

        pbrMaterial.emissiveColor = new Color3(1, 1, 1);
        pbrMaterial.emissiveIntensity = 0;

        // 法线贴图
        if (mmdAny.bumpTexture) {
            pbrMaterial.bumpTexture = mmdAny.bumpTexture;
        }

        // 双面
        if (!mmdMaterial.backFaceCulling) {
            pbrMaterial.backFaceCulling = false;
            pbrMaterial.twoSidedLighting = true;
        }

        pbrMaterial.environmentIntensity = 0.5;

        // 初始化次表面散射 (Translucency) — 优化扩散剖面
        pbrMaterial.subSurface.isTranslucencyEnabled = false;
        pbrMaterial.subSurface.translucencyIntensity = 0;
        pbrMaterial.subSurface.translucencyColor = new Color3(1.0, 0.68, 0.67);
        (pbrMaterial.subSurface as any).translucencyDiffusionDistance = 0.8;
        pbrMaterial.subSurface.minimumThickness = 0.5;
        pbrMaterial.subSurface.maximumThickness = 1;

        // 初始化透射 (Refraction)
        pbrMaterial.subSurface.isRefractionEnabled = false;
        pbrMaterial.subSurface.refractionIntensity = 0;
        pbrMaterial.subSurface.indexOfRefraction = 1.5;

        pbrMaterial.indexOfRefraction = 1.5;

        // 渲染特性
        pbrMaterial.directIntensity = 1.0;
        pbrMaterial.specularIntensity = 1.0;

        log('材质转换完成: ' + pbrMaterial.name);
        return pbrMaterial;
    }

    disposeMaterial(material: Material): void {
        material.dispose();
    }

    // ===== IBL 环境贴图管理 =====

    /** 确保场景已加载 IBL 环境贴图（首次调用时加载并缓存） */
    ensureIBLEnvironment(scene: Scene): void {
        if (PbrMaterialAdapter._iblEnvironmentTexture) {
            // 缓存可用，但确保当前场景也应用了它
            if (scene.environmentTexture !== PbrMaterialAdapter._iblEnvironmentTexture) {
                scene.environmentTexture = PbrMaterialAdapter._iblEnvironmentTexture;
                scene.environmentIntensity = 0.5;
                log('应用缓存的 IBL 环境贴图到场景');
            }
            return;
        }

        try {
            log('加载 IBL 环境贴图: ' + IBL_ENV_URL);
            const envTexture = CubeTexture.CreateFromPrefilteredData(IBL_ENV_URL, scene);

            if (envTexture) {
                envTexture.name = 'PBR_IBL_Environment';
                envTexture.gammaSpace = false;
                if (PbrMaterialAdapter._iblRotationY !== 0) {
                    envTexture.rotationY = PbrMaterialAdapter._iblRotationY;
                }

                PbrMaterialAdapter._iblEnvironmentTexture = envTexture;
                PbrMaterialAdapter._currentScene = scene;

                scene.environmentTexture = envTexture;
                scene.environmentIntensity = 0.5;

                log('IBL 环境贴图加载成功');
            } else {
                logWarn('IBL 环境贴图创建返回 null');
            }
        } catch (e) {
            logError('IBL 加载异常: ' + (e as Error).message);
        }
    }

    /** 释放 IBL 环境贴图缓存（通常在插件停用时调用） */
    static disposeIBL(): void {
        if (PbrMaterialAdapter._iblEnvironmentTexture) {
            PbrMaterialAdapter._iblEnvironmentTexture.dispose();
            PbrMaterialAdapter._iblEnvironmentTexture = null;
            PbrMaterialAdapter._currentScene = null;
            log('IBL 环境贴图已释放');
        }
    }
}
