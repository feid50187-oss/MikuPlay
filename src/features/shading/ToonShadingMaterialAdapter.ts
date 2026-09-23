import type { Material, Scene } from '@babylonjs/core';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Material as BabylonMaterial } from '@babylonjs/core/Materials/material';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { IMaterialAdapter, ParamValue } from '../../core/IMaterialAdapter';
import type { ControlDeclaration } from '../../core/IPlugin';
import { ToonShadingSharedParams, TOON_TEXTURE_PARAMS, type ToonTextureParam } from './ToonShadingSharedParams';

/** 变体贴图 uniform / 存在标志（每材质作用域） */
const TEXTURE_UNIFORM: Record<ToonTextureParam, string> = {
    normalMap: 'uNormalMap',
};
const TEXTURE_FLAG: Record<ToonTextureParam, string> = {
    normalMap: 'uHasNormalMap',
};

/** 每材质的变体贴图状态 */
interface PerMaterialTex {
    path: string;
    texture?: Texture;
    has: number;
}

// GLSL 着色器
import vertexShader from './shaders/toon.vertex.glsl';
import fragmentShader from './shaders/toon.fragment.glsl';

// 注册着色器到 Babylon ShadersStore
Effect.ShadersStore['toonVertexShader'] = vertexShader;
Effect.ShadersStore['toonFragmentShader'] = fragmentShader;

/** 日志前缀 */
const LOG_PREFIX = '[Toon Builtin]';

function log(message: string): void {
    console.log(LOG_PREFIX, message);
}

function logWarn(message: string): void {
    console.warn(LOG_PREFIX, message);
}

/**
 * Toon 材质适配器
 *
 * 统一使用程序化照明模型，已移除 rampMap 分支。
 * 保留法线贴图（normalMap）作为可选输入。
 */
export class ToonShadingMaterialAdapter implements IMaterialAdapter {
    readonly typeId = 'toon-shading';
    readonly displayName = 'Toon卡通(Dev)';
    readonly supportsOutline = true;
    readonly supportsMorph = true;
    readonly createsMaterial = true;

    /** 全局共享风格参数（光照/阴影/边缘光/环境光/time） */
    private readonly _shared = ToonShadingSharedParams.instance;

    /** 每材质的变体贴图状态（normalMap） */
    private readonly _textures = new WeakMap<ShaderMaterial, Record<ToonTextureParam, PerMaterialTex>>();

    /** 每材质的阴影采样器同步观察器（scene.onBeforeRender，dispose 时移除） */
    private readonly _shadowPreRenderObservers = new WeakMap<ShaderMaterial, Observer<Scene>>();

    private static readonly _controlDeclarations: ControlDeclaration[] = [
        // 光照
        { param: 'ambient', type: 'slider', label: '明亮度', min: 0, max: 1, step: 0.01, group: '光照' },
        { param: 'unlit', type: 'dropdown', label: '无光照', options: ['off', 'on'], optionLabels: ['关闭', '开启'], group: '光照' },
        // 边缘光
        { param: 'rimLightWidth', type: 'slider', label: '宽度', min: 0, max: 1, step: 0.01, group: '边缘光' },
        { param: 'rimLightIntensity', type: 'slider', label: '强度', min: 0, max: 5, step: 0.01, group: '边缘光' },
        // 透明度
        { param: 'alpha', type: 'slider', label: 'Alpha', min: 0, max: 1, step: 0.01, group: '透明度' },
        { param: 'alphaBlendMode', type: 'dropdown', label: '混合模式',
          options: ['opaque', 'alphaTest', 'alphaBlend', 'alphaTestAndBlend'],
          optionLabels: ['不透明', '测试', '混合', '测试+混合'], group: '透明度' },
        { param: 'cullMode', type: 'dropdown', label: '单双面',
          options: ['doubleSided', 'front', 'back'],
          optionLabels: ['双面', '里面', '外面'], group: '透明度' },
        // 法线贴图
        { param: 'normalMap', type: 'texture', label: '法线贴图' },
    ];

    /** 从材质实例读取当前 uniform 状态（未直接暴露时返回默认值） */
    canHandle(material: Material): boolean {
        return material.getClassName?.() === 'ShaderMaterial' && (material as any)._isToonShading === true;
    }

    readState(material: Material): Record<string, ParamValue> {
        const mat = material as ShaderMaterial;
        const shared = this._shared;

        let alphaBlendMode = 'opaque';
        if (mat.transparencyMode === BabylonMaterial.MATERIAL_ALPHATEST) {
            alphaBlendMode = 'alphaTest';
        } else if (mat.transparencyMode === BabylonMaterial.MATERIAL_ALPHABLEND) {
            alphaBlendMode = 'alphaBlend';
        } else if (mat.transparencyMode === BabylonMaterial.MATERIAL_ALPHATESTANDBLEND) {
            alphaBlendMode = 'alphaTestAndBlend';
        }

        let cullMode = 'back';
        if (!mat.backFaceCulling) {
            cullMode = 'doubleSided';
        } else if (mat.sideOrientation === BabylonMaterial.ClockWiseSideOrientation) {
            cullMode = 'front';
        }

        const state: Record<string, ParamValue> = {
            // 共享风格参数（全局单例）
            rimLightWidth: shared.rimLightWidth,
            rimLightIntensity: shared.rimLightIntensity,
            ambient: shared.ambient,
            unlit: shared.unlit ? 'on' : 'off',
            // 每材质参数（toon 默认，非 MMD 拷贝）
            alpha: mat.alpha,
            alphaBlendMode,
            cullMode,
            isVisible: true,
        };

        // 每材质变体贴图路径
        const texState = this._textureState(mat);
        for (const p of TOON_TEXTURE_PARAMS) {
            state[p] = texState[p].path;
        }
        return state;
    }

    writeState(material: Material, state: Record<string, ParamValue>): void {
        const mat = material as ShaderMaterial;
        const shared = this._shared;
        const scene = mat.getScene();

        // --- 共享风格参数：更新全局单例并广播到所有 toon 材质 ---
        let sharedChanged = false;

        if (typeof state.rimLightWidth === 'number') { shared.rimLightWidth = state.rimLightWidth; sharedChanged = true; }
        if (typeof state.rimLightIntensity === 'number') { shared.rimLightIntensity = state.rimLightIntensity; sharedChanged = true; }
        if (typeof state.ambient === 'number') { shared.ambient = state.ambient; sharedChanged = true; }
        if (state.unlit === 'on') { shared.unlit = 1; sharedChanged = true; }
        else if (state.unlit === 'off') { shared.unlit = 0; sharedChanged = true; }

        // --- 每材质变体贴图（按材质作用域，空串表示清除回退白色兜底） ---
        const texState = this._textureState(mat);
        for (const p of TOON_TEXTURE_PARAMS) {
            const path = state[p];
            if (typeof path === 'string' && path !== texState[p].path) {
                this._loadTexture(mat, scene, p, path, texState);
            }
        }

        if (sharedChanged) shared.syncAll();

        // --- 每材质参数（toon 默认，非 MMD 拷贝） ---
        if (typeof state.alpha === 'number') {
            mat.alpha = state.alpha;
            mat.setFloat('uAlpha', state.alpha);
        }

        if (typeof state.alphaBlendMode === 'string') {
            const scene = mat.getScene();
            switch (state.alphaBlendMode) {
                case 'opaque':
                    mat.transparencyMode = BabylonMaterial.MATERIAL_OPAQUE;
                    mat.needDepthPrePass = false;
                    mat.forceDepthWrite = false;
                    break;
                case 'alphaTest':
                    mat.transparencyMode = BabylonMaterial.MATERIAL_ALPHATEST;
                    mat.needDepthPrePass = false;
                    mat.forceDepthWrite = false;
                    break;
                case 'alphaBlend':
                    // needDepthPrePass：正式渲染前先做只写深度的 pre-pass，
                    // shader 的 discard 仍生效，使近处片元（如瞳孔）的深度被写入，
                    // 正式渲染时远处片元（如眼白）深度测试失败 → 瞳孔可见。
                    // 比 forceDepthWrite 优：正式渲染不写深度，半透明片元不会挡远处片元。
                    mat.transparencyMode = BabylonMaterial.MATERIAL_ALPHABLEND;
                    mat.needDepthPrePass = true;
                    mat.forceDepthWrite = false;
                    break;
                case 'alphaTestAndBlend':
                    mat.transparencyMode = BabylonMaterial.MATERIAL_ALPHATESTANDBLEND;
                    mat.needDepthPrePass = true;
                    mat.forceDepthWrite = false;
                    break;
            }
        }

        if (typeof state.cullMode === 'string') {
            switch (state.cullMode) {
                case 'doubleSided':
                    mat.backFaceCulling = false;
                    mat.sideOrientation = BabylonMaterial.CounterClockWiseSideOrientation;
                    break;
                case 'front':
                    mat.backFaceCulling = true;
                    mat.sideOrientation = BabylonMaterial.ClockWiseSideOrientation;
                    break;
                case 'back':
                    mat.backFaceCulling = true;
                    mat.sideOrientation = BabylonMaterial.CounterClockWiseSideOrientation;
                    break;
            }
        }

        mat.markAsDirty(BabylonMaterial.TextureDirtyFlag | BabylonMaterial.LightDirtyFlag);
    }

    getControlDeclarations(): ControlDeclaration[] {
        return ToonShadingMaterialAdapter._controlDeclarations;
    }

    getDefaultState(): Record<string, ParamValue> {
        return {
            ambient: 0.15,
            unlit: 'off',
            rimLightWidth: 1,
            rimLightIntensity: 1,
            alpha: 1,
            alphaBlendMode: 'opaque',
            cullMode: 'back',
            normalMap: '',
            isVisible: true,
        };
    }

    convertFromMmd(mmdMaterial: Material, scene: Scene): Material {
        log('转换材质: ' + mmdMaterial.name + ' -> Toon');

        const anyMmd = mmdMaterial as any;
        const matName = mmdMaterial.name || '';

        const material = new ShaderMaterial('toon_' + matName, scene, {
            vertex: 'toon',
            fragment: 'toon',
        }, {
            attributes: ['position', 'normal', 'uv', 'matricesIndices', 'matricesWeights'],
            uniforms: [
                'world', 'view', 'projection', 'cameraPosition',
                'uRimLightWidth', 'uRimLightIntensity',
                'uAmbient', 'uUnlit', 'uAlpha', 'uDiffuseColor', 'uHasDiffuseMap',
                'uHasNormalMap',
                'lightMatrix0', 'uShadowEnable', 'uShadowDarkness', 'uShadowFalloff', 'uShadowDepthValues', 'uShadowDepthScale', 'uShadowMapSizeInv', 'uShadowBiasTexels',
                'mBones', 'boneTextureInfo',
            ],
            samplers: [
                'uDiffuseMap', 'uNormalMap', 'shadowTexture0', 'boneSampler',
            ],
            defines: ['#define GLSL3'],
        });

        // 标为 Toon 材质（供 canHandle 识别）
        (material as any)._isToonShading = true;

        // 阴影采样器类型：PCF/PCSS 用深度-模板纹理（sampler2DShadow），其余用颜色纹理（sampler2D）。
        // 在首次编译前设置好 define，避免首帧 GL_INVALID_OPERATION。
        let useDepthShadow = false;
        let useCloseEsmShadow = false;
        let foundSg: any = null;
        for (const l of scene.lights) {
            const sg = (l as any).getShadowGenerator?.();
            if ((l as any).shadowEnabled && sg) {
                foundSg = sg;
                useDepthShadow = sg.usePercentageCloserFiltering || sg.useContactHardeningShadow;
                useCloseEsmShadow = sg.useCloseExponentialShadowMap || sg.useBlurCloseExponentialShadowMap;
                break;
            }
        }
        material.setDefine('TOON_SHADOW_DEPTH', useDepthShadow);
        material.setDefine('TOON_SHADOW_CLOSEESM', useCloseEsmShadow);
        if (foundSg) {
            // 首次编译前定好多 tap 等级，避免首帧单点采样再触发一次重编译
            this._applyPcfQualityDefines(material, foundSg);
        }

        // 阴影绑定：每帧把方向光阴影贴图/矩阵写入材质 uniform
        this._bindShadowObservable(scene, material);

        // 基础色
        const diffuseColor = anyMmd.diffuseColor ?? new Color3(1, 1, 1);
        material.setColor4('uDiffuseColor', new Color4(diffuseColor.r, diffuseColor.g, diffuseColor.b, 1));

        // 漫反射贴图（MMD 主纹理，唯一保留的 MMD 参数）
        const white = this._shared.getWhite(scene);
        const diffuseTex = anyMmd.diffuseTexture ?? null;
        if (diffuseTex) {
            material.setTexture('uDiffuseMap', diffuseTex);
            material.setFloat('uHasDiffuseMap', 1);
        } else {
            material.setTexture('uDiffuseMap', white);
            material.setFloat('uHasDiffuseMap', 0);
        }

        // 每材质参数：从 MMD 材质拷贝 Alpha 信息（透明度值与混合模式）
        const mmdAlpha = anyMmd.alpha ?? 1;
        material.alpha = mmdAlpha;
        material.setFloat('uAlpha', mmdAlpha);
        const mmdTransparency = anyMmd.transparencyMode ?? BabylonMaterial.MATERIAL_OPAQUE;
        material.transparencyMode = mmdTransparency;
        // 混合模式启用 depth pre-pass，使近处片元（如瞳孔）写深度保护。
        // 不用 forceDepthWrite：它会令正式渲染也写深度，半透明片元挡远处片元（问题 2）。
        material.needDepthPrePass =
            mmdTransparency === BabylonMaterial.MATERIAL_ALPHABLEND ||
            mmdTransparency === BabylonMaterial.MATERIAL_ALPHATESTANDBLEND;
        material.forceDepthWrite = false;
        material.backFaceCulling = true;
        material.sideOrientation = BabylonMaterial.CounterClockWiseSideOrientation;

        // 每材质变体贴图：初始为空，回退白色兜底（Phase 2 由控件逐个载入）
        const texState = this._textureState(material);
        for (const p of TOON_TEXTURE_PARAMS) {
            texState[p] = { path: '', has: 0 };
            material.setTexture(TEXTURE_UNIFORM[p], white);
            material.setFloat(TEXTURE_FLAG[p], 0);
        }

        // --- 复用 babylon-mmd 的 MmdOutlineRenderer（屏幕空间法线偏移）---
        // 此处从原版 MMD 材质拷贝描边属性，切到 Toon 后描边即可复用同一渲染通道。
        const mmdOutline = anyMmd as { renderOutline?: boolean; outlineWidth?: number; outlineColor?: Color3; outlineAlpha?: number };
        (material as any).renderOutline = mmdOutline.renderOutline ?? false;
        (material as any).outlineWidth = mmdOutline.outlineWidth ?? 0.01;
        (material as any).outlineColor = mmdOutline.outlineColor ? new Color3(mmdOutline.outlineColor.r, mmdOutline.outlineColor.g, mmdOutline.outlineColor.b) : new Color3(0, 0, 0);
        (material as any).outlineAlpha = mmdOutline.outlineAlpha ?? 1;

        // 注册到全局共享：写入光照/风格等共享参数
        this._shared.register(scene, material);

        log('材质转换完成: ' + material.name);
        return material;
    }

    disposeMaterial(material: Material): void {
        const anyMat = material as any;
        if (anyMat._isToonShading === true) {
            this._shared.unregister(material as ShaderMaterial);
            // 移除每帧渲染前的阴影采样器同步观察器（挂在 scene 上，需手动移除）
            const preRenderObserver = this._shadowPreRenderObservers.get(material as ShaderMaterial);
            if (preRenderObserver) {
                preRenderObserver.remove();
                this._shadowPreRenderObservers.delete(material as ShaderMaterial);
            }
            // 释放每材质变体贴图
            const texState = this._textures.get(material as ShaderMaterial);
            if (texState) {
                for (const p of TOON_TEXTURE_PARAMS) {
                    const t = texState[p].texture;
                    if (t) t.dispose();
                }
                this._textures.delete(material as ShaderMaterial);
            }
        }
        material.dispose();
    }

    /**
     * 找到第一个启用阴影的方向光 ShadowGenerator（无则 null）。
     * 项目阴影开关的实际信号是逐网格 mesh.receiveShadows + directionalLight.shadowEnabled。
     */
    private _findShadowGenerator(scene: Scene): any {
        for (const l of scene.lights) {
            const sg = (l as any).getShadowGenerator?.();
            if ((l as any).shadowEnabled && sg) {
                return sg;
            }
        }
        return null;
    }

    /**
     * 每帧把方向光阴影贴图/矩阵写入材质 uniform，实现自阴影接收。
     * 阴影是否生效跟随：
     *  1) 被绑定网格本身 mesh.receiveShadows（与标准/PBR 材质一致，项目阴影开关的实际信号）；
     *  2) 场景与方向光阴影开关。
     *
     * 阴影采样器类型由编译期 define 决定（sampler2DShadow / sampler2D）。若在 onBind
     * （isReady 之后）里改 define，翻转帧仍会用旧程序绘制、而纹理已绑成新类型，触发
     * GL_INVALID_OPERATION（sampler 类型与纹理格式不匹配）。因此 define 改到每帧渲染前
     * （先于 isReady）同步：翻转帧首个 isReady 即按新类型重编译，onBind 再按同一判定绑定
     * 同类型纹理 —— 程序与纹理始终一致，消除报错帧。阴影关闭（无启用光源）时不改 define，
     * 与上次绑定保持冻结，避免旧纹理失配。
     */
    private _bindShadowObservable(scene: Scene, material: ShaderMaterial): void {
        const initialSg = this._findShadowGenerator(scene);
        let lastDepth = !!initialSg && (initialSg.usePercentageCloserFiltering || initialSg.useContactHardeningShadow);
        let lastCloseEsm = !!initialSg && (initialSg.useCloseExponentialShadowMap || initialSg.useBlurCloseExponentialShadowMap);
        let lastQuality = initialSg ? initialSg.filteringQuality : -1;

        const preRenderObserver = scene.onBeforeRenderObservable.add(() => {
            // 材质 dispose 后 drawWrapper.effect 被置 null（material.js:1368），
            // 以此作为「材质存活 + 已有可编译 effect」的判定；首次编译前为 null 时
            // 不翻转 defines（此时初始 defines 已由 convertFromMmd 按同一扫描设好）。
            if (!material.getEffect() || !scene.shadowsEnabled) return;

            const shadowGenerator = this._findShadowGenerator(scene);
            if (!shadowGenerator) return; // 阴影关：defines 冻结，与上次绑定保持一致

            const useDepthTexture = shadowGenerator.usePercentageCloserFiltering || shadowGenerator.useContactHardeningShadow;
            const useCloseEsm = shadowGenerator.useCloseExponentialShadowMap || shadowGenerator.useBlurCloseExponentialShadowMap;
            const quality = shadowGenerator.filteringQuality;
            if (useDepthTexture !== lastDepth || useCloseEsm !== lastCloseEsm || quality !== lastQuality) {
                lastDepth = useDepthTexture;
                lastCloseEsm = useCloseEsm;
                lastQuality = quality;
                material.setDefine('TOON_SHADOW_DEPTH', useDepthTexture);
                material.setDefine('TOON_SHADOW_CLOSEESM', useCloseEsm);
                this._applyPcfQualityDefines(material, shadowGenerator);
            }
        });
        this._shadowPreRenderObservers.set(material, preRenderObserver);

        material.onBindObservable.add((mesh?: any) => {
            const effect = material.getEffect();
            if (!effect) return;

            // 与标准/PBR 材质一致：仅当本网格接收阴影时才显示阴影。
            // 项目启动时并不会把 directionalLight.shadowEnabled 置 false，
            // 但 ShadowGenerator 早就以「1024 分辨率 + PCF」创建好并持续渲染；
            // 若只看全局开关，切换到 Toon 后会误把这张“默认就存在”的阴影贴图显示出来。
            if (mesh && mesh.receiveShadows === false) {
                material.setFloat('uShadowEnable', 0);
                return;
            }

            const shadowGenerator = this._findShadowGenerator(scene);
            if (!scene.shadowsEnabled || !shadowGenerator) {
                material.setFloat('uShadowEnable', 0);
                return;
            }

            const shadowMap = shadowGenerator.getShadowMapForRendering?.() ?? shadowGenerator.getShadowMap();
            if (!shadowMap) {
                material.setFloat('uShadowEnable', 0);
                return;
            }

            material.setFloat('uShadowEnable', 1);
            effect.setMatrix('lightMatrix0', shadowGenerator.getTransformMatrix());

            // PCF/PCSS 深度在深度模板纹理中，需用阴影采样器（sampler2DShadow）；
            // 其余滤波（ESM/无过滤）深度在浮点颜色纹理中，用普通采样器。
            // defines 已在 onBeforeRender 按同一判定同步，这里绑定同类型纹理，保证一致。
            const useDepthTexture = shadowGenerator.usePercentageCloserFiltering || shadowGenerator.useContactHardeningShadow;
            if (useDepthTexture) {
                effect.setDepthStencilTexture('shadowTexture0', shadowMap);
            } else {
                effect.setTexture('shadowTexture0', shadowMap);
            }

            const camera = scene.activeCamera;
            const dl = shadowGenerator.getLight();
            const minZ = dl.getDepthMinZ(camera);
            const maxZ = dl.getDepthMaxZ(camera);
            effect.setFloat2('uShadowDepthValues', minZ, minZ + maxZ);
            effect.setFloat('uShadowDarkness', shadowGenerator.getDarkness());
            effect.setFloat('uShadowFalloff', shadowGenerator.frustumEdgeFalloff);
            effect.setFloat('uShadowDepthScale', shadowGenerator.depthScale);

            // 多 tap 双三次软阴影所需：贴图尺寸倒数
            // （对齐 Babylon 原生 shadowMapSizeAndInverse，解决 Toon 在 2048+PCF 下严重锯齿、
            // 且 UI filteringQuality 对 Toon 完全无效的问题）
            const mapSize = shadowMap.getSize().width;
            material.setFloat('uShadowMapSizeInv', 1.0 / mapSize);

            // Toon 专属比较期偏置：以 texel 为单位向光源方向回退参考深度，
            // 压掉平涂表面上的拐角 acne/自阴影条纹（bake 期 bias 共享，无法按风格单独调）。
            // 默认 1.0 texel（2048 + shadowArea 12 约 6mm 世界尺寸，视觉无感、peter-panning 可忽略）。
            material.setFloat('uShadowBiasTexels', 1.0);
        });
    }

    /**
     * 按 ShadowGenerator.filteringQuality 选择 Toon 阴影的多 tap 等级，
     * 与 Babylon 原生 lightFragment 完全一致：HIGH→PCF5(9-tap) / MEDIUM→PCF3(4-tap) / LOW→PCF1(单点)。
     * 两个 define 都不设即走 PCF1（#else 分支），故未命中 HIGH/MEDIUM 时显式移除。
     * shadowGenerator 为 null（阴影关闭）时等价于移除两个 define。
     */
    private _applyPcfQualityDefines(material: ShaderMaterial, shadowGenerator: any): void {
        const q = shadowGenerator ? shadowGenerator.filteringQuality : -1;
        material.setDefine('TOON_SHADOW_PCF5', q === ShadowGenerator.QUALITY_HIGH);
        material.setDefine('TOON_SHADOW_PCF3', q === ShadowGenerator.QUALITY_MEDIUM);
    }

    /** 获取（或惰性初始化）某材质的变体贴图状态 */
    private _textureState(mat: ShaderMaterial): Record<ToonTextureParam, PerMaterialTex> {
        let m = this._textures.get(mat);
        if (!m) {
            m = {} as Record<ToonTextureParam, PerMaterialTex>;
            for (const p of TOON_TEXTURE_PARAMS) {
                m[p] = { path: '', has: 0 };
            }
            this._textures.set(mat, m);
        }
        return m;
    }

    /** 载入/清除某材质的单张变体贴图（空串清除，回退白色兜底） */
    private _loadTexture(
        mat: ShaderMaterial,
        scene: Scene,
        p: ToonTextureParam,
        path: string,
        texState: Record<ToonTextureParam, PerMaterialTex>,
    ): void {
        const entry = texState[p];
        if (entry.texture) {
            entry.texture.dispose();
            entry.texture = undefined;
        }
        entry.path = path;
        if (!path) {
            entry.has = 0;
            mat.setTexture(TEXTURE_UNIFORM[p], this._shared.getWhite(scene));
            mat.setFloat(TEXTURE_FLAG[p], 0);
        } else {
            entry.texture = new Texture(path, scene);
            entry.has = 1;
            mat.setTexture(TEXTURE_UNIFORM[p], entry.texture);
            mat.setFloat(TEXTURE_FLAG[p], 1);
        }
    }
}