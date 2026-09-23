
import type { Material } from '@babylonjs/core/Materials/material';
import type { IMaterialAdapter, ParamValue } from '../../core/IMaterialAdapter';
import type { ControlDeclaration } from '../../core/IPlugin';
import { MmdStandardMaterial } from 'babylon-mmd/esm/Loader/mmdStandardMaterial';
import { MmdPluginMaterialSphereTextureBlendMode } from 'babylon-mmd/esm/Loader/mmdPluginMaterial';
import { Material as BabylonMaterial } from '@babylonjs/core/Materials/material';
import { Color4 } from '@babylonjs/core/Maths/math.color';

export class MmdStandardMaterialAdapter implements IMaterialAdapter {
    readonly typeId = 'mmd-standard';
    readonly displayName = 'MMD 标准';
    readonly supportsOutline = true;
    readonly supportsMorph = true;
    readonly createsMaterial = false;

    private static readonly _controlDeclarations: ControlDeclaration[] = [
        { param: 'useToonShadow', type: 'dropdown', label: '着色器分支',
          options: ['default', 'ToonShadow'],
          optionLabels: ['默认', '假阴影'] },
        { param: 'diffuse', type: 'color', label: '扩散色', group: '扩散色' },
        { param: 'ambient', type: 'color', label: '环境色', group: '环境色' },
        { param: 'specular', type: 'color', label: '反射色', group: '反射' },
        { param: 'shininess', type: 'slider', label: '强度', min: 0, max: 100, step: 1, group: '反射' },
        { param: 'emissive', type: 'color', label: '自发光', group: '自发光' },
        { param: 'emissiveIntensity', type: 'slider', label: '强度', min: 0, max: 1, step: 0.01, group: '自发光' },
        { param: 'alpha', type: 'slider', label: 'Alpha', min: 0, max: 1, step: 0.01, group: '透明度' },
        { param: 'alphaBlendMode', type: 'dropdown', label: '混合模式',
          options: ['opaque', 'alphaTest', 'alphaBlend', 'alphaTestAndBlend'],
          optionLabels: ['不透明', 'Alpha测试', 'Alpha混合', '测试+混合'], group: '透明度' },
        { param: 'cullMode', type: 'dropdown', label: '单双面',
          options: ['doubleSided', 'front', 'back'],
          optionLabels: ['双面', '里面', '外面'], group: '透明度' },
        { param: 'spaMode', type: 'dropdown', label: 'Spa贴图',
          options: ['off', 'multiply', 'add', 'subTexture'],
          optionLabels: ['关闭', '乘算', '加算', '副纹理'] },
        // Toon 阴影参数
        { param: 'toonShadowSampleThreshold', type: 'slider', label: '采样阈值', min: 0, max: 1, step: 0.01, group: 'Toon' },
        { param: 'toonShadowBlendThreshold', type: 'slider', label: '混合阈值', min: 0.2, max: 0.4, step: 0.001, group: 'Toon' },
    ];

    private readonly _toonShadowParamsColor = new Color4(0, 0, 0, 0);

    canHandle(material: Material): boolean {
        return material instanceof MmdStandardMaterial;
    }

    readState(material: Material): Record<string, ParamValue> {
        const mmdMat = material as MmdStandardMaterial;

        let spaMode: string = 'off';
        if (mmdMat.sphereTexture !== null) {
            if (mmdMat.sphereTextureBlendMode === MmdPluginMaterialSphereTextureBlendMode.Multiply) {
                spaMode = 'multiply';
            } else if (mmdMat.sphereTextureBlendMode === MmdPluginMaterialSphereTextureBlendMode.Add) {
                spaMode = 'add';
            } else if (mmdMat.sphereTextureBlendMode === MmdPluginMaterialSphereTextureBlendMode.SubTexture) {
                spaMode = 'subTexture';
            }
        }

        let alphaBlendMode: string = 'opaque';
        if (mmdMat.transparencyMode === BabylonMaterial.MATERIAL_ALPHATEST) {
            alphaBlendMode = 'alphaTest';
        } else if (mmdMat.transparencyMode === BabylonMaterial.MATERIAL_ALPHABLEND) {
            alphaBlendMode = 'alphaBlend';
        } else if (mmdMat.transparencyMode === BabylonMaterial.MATERIAL_ALPHATESTANDBLEND) {
            alphaBlendMode = 'alphaTestAndBlend';
        }

        let cullMode: string = 'back';
        if (!mmdMat.backFaceCulling) {
            cullMode = 'doubleSided';
        } else if (mmdMat.sideOrientation === BabylonMaterial.ClockWiseSideOrientation) {
            cullMode = 'front';
        }

        let shininess: number;
        const specularPower = mmdMat.specularPower;
        // 反转映射：specularPower 越小反射越强，所以 shininess=100 对应最小 specularPower
        if (specularPower >= 10) {
            shininess = (100 - specularPower) / 90 * 50;
        } else {
            shininess = 50 + (10 - specularPower) / 9.9 * 50;
        }
        shininess = Math.max(0, Math.min(100, Math.round(shininess)));

        const tsp = mmdMat.toonShadowParams;

        return {
            diffuse: { r: mmdMat.diffuseColor.r, g: mmdMat.diffuseColor.g, b: mmdMat.diffuseColor.b },
            ambient: { r: mmdMat.ambientColor.r, g: mmdMat.ambientColor.g, b: mmdMat.ambientColor.b },
            specular: { r: mmdMat.specularColor.r, g: mmdMat.specularColor.g, b: mmdMat.specularColor.b },
            emissive: { r: mmdMat.emissiveColor.r, g: mmdMat.emissiveColor.g, b: mmdMat.emissiveColor.b },
            emissiveIntensity: 1,
            shininess,
            alpha: mmdMat.alpha,
            alphaBlendMode,
            cullMode,
            spaMode,
            isVisible: true,
            useToonShadow: this.readUseToonShadow(mmdMat),
            toonShadowSampleThreshold: tsp?.r ?? 0.05,
            toonShadowBlendThreshold: tsp?.g ?? 0.240
        };
    }

    writeState(material: Material, state: Record<string, ParamValue>): void {
        const mmdMat = material as MmdStandardMaterial;

        if (state.diffuse && typeof state.diffuse === 'object' && 'r' in state.diffuse) {
            const c = state.diffuse as { r: number; g: number; b: number };
            mmdMat.diffuseColor.set(c.r, c.g, c.b);
        }

        if (state.ambient && typeof state.ambient === 'object' && 'r' in state.ambient) {
            const c = state.ambient as { r: number; g: number; b: number };
            mmdMat.ambientColor.set(c.r, c.g, c.b);
        }

        if (state.specular && typeof state.specular === 'object' && 'r' in state.specular) {
            const c = state.specular as { r: number; g: number; b: number };
            mmdMat.specularColor.set(c.r, c.g, c.b);
        }

        if (state.emissive && typeof state.emissive === 'object' && 'r' in state.emissive) {
            const c = state.emissive as { r: number; g: number; b: number };
            const intensity = typeof state.emissiveIntensity === 'number' ? state.emissiveIntensity : 1;
            mmdMat.emissiveColor.set(c.r * intensity, c.g * intensity, c.b * intensity);
        }

        if (typeof state.emissiveIntensity === 'number') {
            const emissive = state.emissive as { r: number; g: number; b: number } | undefined;
            if (emissive && 'r' in emissive) {
                mmdMat.emissiveColor.set(
                    emissive.r * state.emissiveIntensity,
                    emissive.g * state.emissiveIntensity,
                    emissive.b * state.emissiveIntensity
                );
            }
        }

        if (typeof state.shininess === 'number') {
            let specularPower: number;
            // 反转映射：滑块值越大反射越强（specularPower 越小）
            if (state.shininess <= 50) {
                specularPower = 100 - (state.shininess / 50) * 90;
            } else {
                specularPower = 10 - ((state.shininess - 50) / 50) * 9.9;
            }
            mmdMat.specularPower = specularPower;
        }

        if (typeof state.alpha === 'number') {
            mmdMat.alpha = state.alpha;
        }

        if (typeof state.alphaBlendMode === 'string') {
            const scene = mmdMat.getScene();
            switch (state.alphaBlendMode) {
                case 'opaque':
                    mmdMat.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
                    mmdMat.needDepthPrePass = false;
                    mmdMat.forceDepthWrite = false;
                    break;
                case 'alphaTest':
                    mmdMat.transparencyMode = BabylonMaterial.MATERIAL_ALPHATEST;
                    mmdMat.needDepthPrePass = false;
                    mmdMat.forceDepthWrite = false;
                    break;
                case 'alphaBlend':
                    // 保持 babylon-mmd builder 默认行为（forceDepthWrite=true）
                    // 注意：此模式下近处透明片元会挡住远处不透明片元（问题 2）
                    // 如需解决，请切换到 alphaTestAndBlend（二值透明）
                    mmdMat.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
                    mmdMat.needDepthPrePass = false;
                    mmdMat.forceDepthWrite = true;
                    break;
                case 'alphaTestAndBlend':
                    // 方案 A：解决二值透明材质的自透明穿透
                    // ALPHATESTANDBLEND 模式 → needAlphaTestingForMesh=true → ALPHATEST define 启用
                    // depth pre-pass: discard alpha<0.4 的片元 → 透明区不写深度 → 不挡远处不透明
                    // 正式渲染: ALPHABLEND 启用 → 半透明渐变仍混合
                    // 副作用：alpha 0~0.4 的渐变会被 discard → 边缘锯齿
                    mmdMat.transparencyMode = BabylonMaterial.MATERIAL_ALPHATESTANDBLEND;
                    mmdMat.needDepthPrePass = true;
                    mmdMat.forceDepthWrite = false;
                    break;
            }
        }

        if (typeof state.cullMode === 'string') {
            switch (state.cullMode) {
                case 'doubleSided':
                    mmdMat.backFaceCulling = false;
                    mmdMat.twoSidedLighting = true;
                    mmdMat.sideOrientation = BabylonMaterial.CounterClockWiseSideOrientation;
                    break;
                case 'front':
                    mmdMat.backFaceCulling = true;
                    mmdMat.twoSidedLighting = false;
                    mmdMat.sideOrientation = BabylonMaterial.ClockWiseSideOrientation;
                    break;
                case 'back':
                    mmdMat.backFaceCulling = true;
                    mmdMat.twoSidedLighting = false;
                    mmdMat.sideOrientation = BabylonMaterial.CounterClockWiseSideOrientation;
                    break;
            }
        }

        if (typeof state.spaMode === 'string') {
            if (state.spaMode === 'off') {
                mmdMat.sphereTexture = null;
            } else if (mmdMat.sphereTexture) {
                if (state.spaMode === 'multiply') {
                    mmdMat.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.Multiply;
                } else if (state.spaMode === 'add') {
                    mmdMat.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.Add;
                } else if (state.spaMode === 'subTexture') {
                    mmdMat.sphereTextureBlendMode = MmdPluginMaterialSphereTextureBlendMode.SubTexture;
                }
            }
        }

        // Shader 变体切换
        if (typeof state.useToonShadow === 'string') {
            mmdMat.useToonShadow = state.useToonShadow === 'ToonShadow';
        }

        // Toon 阴影参数（阈值模式：采样阈值 x → mix(x, 1-x), 混合阈值 y → clamp(y, 1-y)）
        const sampleThreshold = state.toonShadowSampleThreshold;
        const blendThreshold = state.toonShadowBlendThreshold;
        if (typeof sampleThreshold === 'number' || typeof blendThreshold === 'number') {
            const current = mmdMat.toonShadowParams;
            this._toonShadowParamsColor.r = typeof sampleThreshold === 'number' ? sampleThreshold : current.r;
            this._toonShadowParamsColor.g = typeof blendThreshold === 'number' ? blendThreshold : current.g;
            this._toonShadowParamsColor.b = 0;
            this._toonShadowParamsColor.a = 0;
            mmdMat.toonShadowParams = this._toonShadowParamsColor;
        }
    }

    getControlDeclarations(): ControlDeclaration[] {
        return MmdStandardMaterialAdapter._controlDeclarations;
    }

    getDefaultState(): Record<string, ParamValue> {
        return {
            diffuse: { r: 1, g: 1, b: 1 },
            ambient: { r: 0, g: 0, b: 0 },
            specular: { r: 0, g: 0, b: 0 },
            emissive: { r: 0, g: 0, b: 0 },
            emissiveIntensity: 1,
            shininess: 64, // 对应 specularPower≈5，适合大多数 MMD 模型
            alpha: 1,
            alphaBlendMode: 'alphaBlend',
            cullMode: 'back',
            spaMode: 'off',
            isVisible: true,
            useToonShadow: 'default',
            toonShadowSampleThreshold: 0.05,
            toonShadowBlendThreshold: 0.24
        };
    }

    private readUseToonShadow(mmdMat: MmdStandardMaterial): string {
        return mmdMat.useToonShadow ? 'ToonShadow' : 'default';
    }

    disposeMaterial(material: Material): void {
        material.dispose();
    }
}
