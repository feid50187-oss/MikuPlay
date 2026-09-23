import {
    Scene,
    Camera,
    DefaultRenderingPipeline,
    ImageProcessingConfiguration,
    ColorCurves,
    PostProcess,
    Texture,
    Constants,
    Effect
} from '@babylonjs/core';
import { type PostProcState } from '../state/PostProcStateManager';
import { CustomDepthOfField } from './CustomDepthOfField';
import { AutoFocusController, type MmdModelProvider } from './AutoFocusController';

export interface IPostProcessManager {
    initialize(scene: Scene, camera: Camera, modelProvider?: MmdModelProvider): void;
    applyState(state: PostProcState): void;
    setAAEnabled(enabled: boolean): void;
    setSamples(value: number): void;
    setExposure(value: number): void;
    setSaturation(value: number): void;
    setContrast(value: number): void;
    setBloomEnabled(enabled: boolean): void;
    setBloomIntensity(value: number): void;
    setBloomThreshold(value: number): void;
    setBloomKernel(value: number): void;
    setDOFEnabled(enabled: boolean): void;
    setDOFBlurIntensity(value: number): void;
    setDOFFocusDistance(value: number): void;
    setDOFDepth(value: number): void;
    setDOFAutoFocusEnabled(enabled: boolean): void;
    setDOFAutoFocusModelId(modelId: string): void;
    // 特效
    setVignetteEnabled(enabled: boolean): void;
    setVignetteIntensity(value: number): void;
    setVignetteSoftness(value: number): void;
    setVignetteColor(r: number, g: number, b: number): void;
    setCAEnabled(enabled: boolean): void;
    setCAIntensity(value: number): void;
    setGrainEnabled(enabled: boolean): void;
    setGrainIntensity(value: number): void;
    setSoftFocusEnabled(enabled: boolean): void;
    setSoftFocusIntensity(value: number): void;
    // 色调滤镜
    setHueEnabled(enabled: boolean): void;
    setHueShift(value: number): void;

    dispose(): void;
}

//Babylon的后处理会将第一个特效的分辨率作为最终画面的分辨率，
// 所以在自定义景深中创建了一个虚拟的特效PassPostProcess，保证最终分辨率与处理前的分辨率相同。

// GLSL 着色器
// 暗角
const VIGNETTE_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uVignetteIntensity;
uniform float uVignetteSoftness;
uniform vec3 uVignetteColor;

void main() {
    vec4 color = texture2D(textureSampler, vUV);
    vec2 center = vec2(0.5, 0.5);
    float dist = distance(vUV, center);
    float vignette = smoothstep(0.65 - uVignetteSoftness, 0.65, dist);
    vec3 result = mix(color.rgb, uVignetteColor, vignette * uVignetteIntensity);
    gl_FragColor = vec4(result, color.a);
}
`;

// 色散
const CHROMATIC_ABERRATION_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uCAIntensity;

void main() {
    vec2 center = vec2(0.5, 0.5);
    vec2 dir = vUV - center;
    float dist = length(dir);
    vec2 offset = dir * dist * uCAIntensity;

    float r = texture2D(textureSampler, vUV + offset).r;
    float g = texture2D(textureSampler, vUV).g;
    float b = texture2D(textureSampler, vUV - offset).b;
    float a = texture2D(textureSampler, vUV).a;

    gl_FragColor = vec4(r, g, b, a);
}
`;

// 颗粒
const FILM_GRAIN_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uGrainIntensity;
uniform float uTime;

// 基于黄金比例的伪随机函数，避免条纹伪影
float random(vec2 st) {
    vec2 k = vec2(0.3183099, 0.3678794);
    float val = sin(dot(st, k * 100.0)) * 43758.5453;
    return fract(val);
}

void main() {
    vec4 color = texture2D(textureSampler, vUV);

    // 使用屏幕像素坐标而非 UV 坐标，避免浮点精度问题
    vec2 pixelCoord = vUV * 1000.0;

    // 时间量化，减少闪烁
    float timeQuantized = floor(uTime * 30.0);

    // 添加非线性偏移打破条纹模式（速度固定为1）
    vec2 seed = pixelCoord * 0.5 + vec2(timeQuantized * 0.13, timeQuantized * 0.07);

    // 使用多层随机减少模式化
    float grain = random(seed);
    grain = mix(grain, random(seed * 1.618 + 0.5), 0.5);

    // 映射到 [-1, 1] 范围
    grain = grain * 2.0 - 1.0;
    grain *= uGrainIntensity;

    vec3 result = clamp(color.rgb + vec3(grain), 0.0, 1.0);
    gl_FragColor = vec4(result, color.a);
}
`;

// 柔焦
// 组合效果：
//   1) 圆形均匀模糊：在圆盘内均匀采样，完全各向同性，彻底消除方向性伪影
//   2) 高阈值低强度 bloom：仅对亮度高于阈值的像素做柔化提取并模糊后低强度叠加，
//      让高光区域产生轻微的辉光扩散，避免整体提亮
const SOFT_FOCUS_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uSoftFocusIntensity;

// 高阈值亮度提取（带软过渡，避免硬边）
vec3 extractHighlights(vec3 color, float threshold, float softness) {
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float mask = smoothstep(threshold, threshold + softness, lum);
    return color * mask;
}

// 旋转噪声函数：基于 UV 坐标生成稳定的伪随机旋转角度
float noiseAngle(vec2 p) {
    float n = sin(dot(p, vec2(12.9898, 78.233)) + 1.7) * 43758.5453;
    return fract(n) * 6.2831853;
}

void main() {
    vec4 originalColor = texture2D(textureSampler, vUV);
    vec3 originalRGB = originalColor.rgb;

    // 固定模糊半径为 1
    float blurRadius = 0.03;

    // 使用圆盘均匀采样替代方形核
    // 基于 UV 坐标生成固定旋转角度，保证同一帧内每像素采样分布一致，
    // 同时相邻帧之间图案不同（如果需要动态效果可通过时间扰动）
    float baseAngle = noiseAngle(vUV * 100.0);

    // 4 个同心环，每环 8 个采样点，共 32 个采样
    // 环半径均匀分布在 [0, blurRadius] 内
    // 每环相对于上一环旋转 22.5°，形成均匀覆盖
    vec3 diskBlur = vec3(0.0);
    vec3 diskBloom = vec3(0.0);

    float ringCount = 4.0;
    float sampleCount = 8.0;

    for (float ring = 1.0; ring <= ringCount; ring += 1.0) {
        float ringRadius = blurRadius * (ring / ringCount);
        float ringRotation = baseAngle + (ring - 1.0) * 0.3927; // 每环旋转 22.5°

        for (float i = 0.0; i < sampleCount; i += 1.0) {
            float angle = ringRotation + i * 0.7854; // 每环 8 个点，间隔 45°
            vec2 offset = vec2(cos(angle), sin(angle)) * ringRadius;
            vec2 sampleUV = vUV + offset;

            // 圆盘边界裁剪：确保采样在圆内
            float dist = length(offset) / blurRadius;
            float boundaryWeight = smoothstep(1.0, 0.85, dist);

            vec3 sampleColor = texture2D(textureSampler, sampleUV).rgb;
            diskBlur += sampleColor * boundaryWeight;
            diskBloom += extractHighlights(sampleColor, 0.75, 0.25) * boundaryWeight;
        }
    }

    float totalSamples = 32.0; // 4 rings * 8 samples
    vec3 blurred = diskBlur / totalSamples;
    vec3 bloomed = diskBloom / totalSamples;

    // 1) 大范围低强度高斯模糊：低比例混合，避免画面被模糊吞没
    vec3 withBlur = mix(originalRGB, blurred, 0.35);

    // 2) 高阈值低强度 bloom：低强度叠加，仅为高光区带来轻微光晕
    vec3 withBloom = withBlur + bloomed * 0.2;

    // uSoftFocusIntensity 控制整体效果强度
    vec3 finalColor = mix(originalRGB, withBloom, uSoftFocusIntensity);

    gl_FragColor = vec4(finalColor, originalColor.a);
}
`;

// 色调滤镜：RGB ↔ HSV 色相旋转（uHueShift 单位：度，-180 ~ 180）
const HUE_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uHueShift;

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec4 color = texture2D(textureSampler, vUV);
    vec3 hsv = rgb2hsv(color.rgb);
    hsv.x = fract(hsv.x + uHueShift / 360.0);
    gl_FragColor = vec4(hsv2rgb(hsv), color.a);
}
`;

export class PostProcessManager implements IPostProcessManager {
    private scene: Scene | null = null;
    private camera: Camera | null = null;
    private pipeline: DefaultRenderingPipeline | null = null;
    private colorCurves: ColorCurves | null = null;
    private customDOF: CustomDepthOfField | null = null;
    private autoFocusController: AutoFocusController | null = null;
    private currentState: PostProcState | null = null;
    private _beforeRenderObserver: any = null;
    private _isPipelineAttached = false;

    // 特效 PostProcess
    private vignetteProcess: PostProcess | null = null;
    private caProcess: PostProcess | null = null;
    private grainProcess: PostProcess | null = null;
    private softFocusProcess: PostProcess | null = null;
    private hueProcess: PostProcess | null = null;

    public initialize(scene: Scene, camera: Camera, modelProvider?: MmdModelProvider): void {
        this.scene = scene;
        this.camera = camera;
        this.createPipeline();
        this.createCustomDOF();
        this.createSpecialEffects();
        this.createAutoFocusController(modelProvider);
    }

    private createAutoFocusController(modelProvider?: MmdModelProvider): void {
        if (!this.scene || !this.camera || !modelProvider) return;

        if (this.autoFocusController) {
            this.autoFocusController.dispose();
            if (this._beforeRenderObserver) {
                this.scene!.onBeforeRenderObservable.remove(this._beforeRenderObserver);
                this._beforeRenderObserver = null;
            }
        }

        this.autoFocusController = new AutoFocusController(this.scene, this.camera, modelProvider);

        this.autoFocusController.onFocusUpdate = (distance: number) => {
            if (this.customDOF) {
                this.customDOF.focusDistance = distance;
            }
        };

        this._beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (this.autoFocusController) {
                this.autoFocusController.update();
            }
        });
    }

    private createPipeline(): void {
        if (!this.scene) return;

        if (this.pipeline) {
            this.pipeline.dispose();
        }

        this.pipeline = new DefaultRenderingPipeline(
            'defaultPipeline',
            false,
            this.scene
        );

        this.pipeline.samples = 1;
        this.pipeline.fxaaEnabled = false;
        this.pipeline.bloomEnabled = false;
        this.pipeline.depthOfFieldEnabled = false;

        this.colorCurves = new ColorCurves();
        this.pipeline.imageProcessing.colorCurves = this.colorCurves;
        this.pipeline.imageProcessing.colorCurvesEnabled = false;
    }

    private createCustomDOF(): void {
        if (!this.scene || !this.camera) return;

        if (this.customDOF) {
            this.customDOF.dispose();
        }

        this.customDOF = new CustomDepthOfField(this.scene, this.camera);
        // 延迟初始化，直到用户首次启用 DOF 时
    }

    private createSpecialEffects(): void {
        if (!this.scene || !this.camera) return;

        // 注册着色器
        Effect.ShadersStore['vignetteSpecialFragmentShader'] = VIGNETTE_FRAGMENT_SHADER;
        Effect.ShadersStore['caSpecialFragmentShader'] = CHROMATIC_ABERRATION_FRAGMENT_SHADER;
        Effect.ShadersStore['grainSpecialFragmentShader'] = FILM_GRAIN_FRAGMENT_SHADER;
        Effect.ShadersStore['softFocusSpecialFragmentShader'] = SOFT_FOCUS_FRAGMENT_SHADER;
        Effect.ShadersStore['hueSpecialFragmentShader'] = HUE_FRAGMENT_SHADER;

        // 创建色调滤镜 PostProcess
        this.hueProcess = new PostProcess(
            'hueSpecial',
            'hueSpecial',
            ['uHueShift'],
            [],
            1.0,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            this.scene.getEngine(),
            false,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        this.hueProcess.onApply = (effect) => {
            const state = this.currentState;
            if (state) {
                effect.setFloat('uHueShift', state.hueShift);
            }
        };

        // 创建暗角 PostProcess
        this.vignetteProcess = new PostProcess(
            'vignetteSpecial',
            'vignetteSpecial',
            ['uVignetteIntensity', 'uVignetteSoftness', 'uVignetteColor'],
            [],
            1.0,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            this.scene.getEngine(),
            false,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        this.vignetteProcess.onApply = (effect) => {
            const state = this.currentState;
            if (state) {
                effect.setFloat('uVignetteIntensity', state.vignetteIntensity);
                effect.setFloat('uVignetteSoftness', state.vignetteSoftness);
                effect.setFloat3('uVignetteColor',
                    state.vignetteColor.r,
                    state.vignetteColor.g,
                    state.vignetteColor.b
                );
            }
        };

        // 创建色散 PostProcess
        this.caProcess = new PostProcess(
            'caSpecial',
            'caSpecial',
            ['uCAIntensity'],
            [],
            1.0,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            this.scene.getEngine(),
            false,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        this.caProcess.onApply = (effect) => {
            const state = this.currentState;
            if (state) {
                effect.setFloat('uCAIntensity', state.caIntensity);
            }
        };

        // 创建胶片颗粒 PostProcess
        this.grainProcess = new PostProcess(
            'grainSpecial',
            'grainSpecial',
            ['uGrainIntensity', 'uTime'],
            [],
            1.0,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            this.scene.getEngine(),
            false,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        this.grainProcess.onApply = (effect) => {
            const state = this.currentState;
            if (state) {
                effect.setFloat('uGrainIntensity', state.grainIntensity);
                effect.setFloat('uTime', performance.now() * 0.001);
            }
        };

        // 创建柔焦滤镜 PostProcess
        this.softFocusProcess = new PostProcess(
            'softFocusSpecial',
            'softFocusSpecial',
            ['uSoftFocusIntensity'],
            [],
            1.0,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            this.scene.getEngine(),
            false,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        this.softFocusProcess.onApply = (effect) => {
            const state = this.currentState;
            if (state) {
                effect.setFloat('uSoftFocusIntensity', state.softFocusIntensity);
            }
        };
    }

    /**
     * 判断 DefaultRenderingPipeline 是否需要被附加到相机。
     * 当任何一个管线级效果处于非默认/启用状态时，就需要附加管线。
     */
    private _shouldPipelineBeAttached(): boolean {
        if (!this.currentState) return false;
        return (
            this.currentState.aaEnabled ||
            this.currentState.samples > 1 ||
            this.currentState.exposure !== 0 ||
            this.currentState.saturation !== 1 ||
            this.currentState.contrast !== 1 ||
            this.currentState.bloomEnabled
        );
    }

    /**
     * 根据当前状态动态附加/分离 DefaultRenderingPipeline。
     * 当没有任何管线级效果需要工作时，分离管线以消除不必要的渲染开销。
     */
    private _syncPipelineAttachment(): void {
        if (!this.camera || !this.pipeline) return;

        const shouldAttach = this._shouldPipelineBeAttached();

        if (shouldAttach && !this._isPipelineAttached) {
            this.pipeline.addCamera(this.camera);
            this._isPipelineAttached = true;
        } else if (!shouldAttach && this._isPipelineAttached) {
            this.pipeline.removeCamera(this.camera);
            this._isPipelineAttached = false;
        }
    }

    public applyState(state: PostProcState): void {
        this.currentState = { ...state };
        this.setAAEnabled(state.aaEnabled);
        this.setSamples(state.samples);
        this.setExposure(state.exposure);
        this.setSaturation(state.saturation);
        this.setContrast(state.contrast);
        this.setBloomEnabled(state.bloomEnabled);
        this.setBloomIntensity(state.bloomIntensity);
        this.setBloomThreshold(state.bloomThreshold);
        this.setBloomKernel(state.bloomKernel);
        this.setDOFEnabled(state.dofEnabled);
        this.setDOFBlurIntensity(state.dofBlurIntensity);
        this.setDOFFocusDistance(state.dofFocusDistance);
        this.setDOFDepth(state.dofDepth);
        this.setDOFAutoFocusEnabled(state.dofAutoFocusEnabled);
        this.setDOFAutoFocusModelId(state.dofAutoFocusModelId);
        // 特效
        this.setVignetteEnabled(state.vignetteEnabled);
        this.setVignetteIntensity(state.vignetteIntensity);
        this.setVignetteSoftness(state.vignetteSoftness);
        this.setVignetteColor(state.vignetteColor.r, state.vignetteColor.g, state.vignetteColor.b);
        this.setCAEnabled(state.caEnabled);
        this.setCAIntensity(state.caIntensity);
        this.setGrainEnabled(state.grainEnabled);
        this.setGrainIntensity(state.grainIntensity);
        this.setSoftFocusEnabled(state.softFocusEnabled);
        this.setSoftFocusIntensity(state.softFocusIntensity);
        // 色调滤镜
        this.setHueEnabled(state.hueEnabled === true);
        this.setHueShift(state.hueShift ?? 0);
        // 最后同步管线附加状态
        this._syncPipelineAttachment();
    }

    public setAAEnabled(enabled: boolean): void {
        if (!this.pipeline) return;
        this.pipeline.fxaaEnabled = enabled;
        this._syncPipelineAttachment();
    }

    public setSamples(value: number): void {
        if (!this.pipeline) return;
        this.pipeline.samples = value;
        this._syncPipelineAttachment();
    }

    public setExposure(value: number): void {
        if (!this.pipeline) return;
        this.pipeline.imageProcessing.exposure = Math.pow(2, value);
        this._syncPipelineAttachment();
    }

    public setSaturation(value: number): void {
        if (!this.pipeline || !this.colorCurves) return;
        const hasEffect = value !== 1;
        this.pipeline.imageProcessing.colorCurvesEnabled = hasEffect;
        this.colorCurves.globalSaturation = (value - 1) * 100;
        this._syncPipelineAttachment();
    }

    public setContrast(value: number): void {
        if (!this.pipeline) return;
        this.pipeline.imageProcessing.contrast = value;
        this._syncPipelineAttachment();
    }

    public setBloomEnabled(enabled: boolean): void {
        if (!this.pipeline) return;
        this.pipeline.bloomEnabled = enabled;
        this._syncPipelineAttachment();
    }

    public setBloomIntensity(value: number): void {
        if (!this.pipeline) return;
        this.pipeline.bloomWeight = value;
    }

    public setBloomThreshold(value: number): void {
        if (!this.pipeline) return;
        this.pipeline.bloomThreshold = value;
    }

    public setBloomKernel(value: number): void {
        if (!this.pipeline) return;
        this.pipeline.bloomKernel = value;
    }

    public setDOFEnabled(enabled: boolean): void {
        if (!this.customDOF) return;

        if (enabled && !this.customDOF.isInitialized) {
            this.customDOF.initialize();
        }

        this.customDOF.isEnabled = enabled;
    }

    public setDOFBlurIntensity(value: number): void {
        if (!this.customDOF) return;
        this.customDOF.blurIntensity = value;
    }

    public setDOFFocusDistance(value: number): void {
        if (!this.customDOF) return;
        this.customDOF.focusDistance = value;
    }

    public setDOFDepth(value: number): void {
        if (!this.customDOF) return;
        this.customDOF.dofDepth = value;
    }

    public setDOFAutoFocusEnabled(enabled: boolean): void {
        if (!this.autoFocusController) return;
        this.autoFocusController.isEnabled = enabled;
    }

    public setDOFAutoFocusModelId(modelId: string): void {
        if (!this.autoFocusController) return;
        this.autoFocusController.targetModelId = modelId === '__none__' ? '' : modelId;
    }

    // ===== 特效方法 =====

    /** 按指定顺序重新同步所有特效 PostProcess（色调 → CA → 暗角 → 柔焦 → 颗粒） */
    private _syncSpecialEffectsOrder(): void {
        if (!this.camera) return;

        // 先分离所有已附加的特效
        if (this.hueProcess) this.camera.detachPostProcess(this.hueProcess);
        if (this.caProcess) this.camera.detachPostProcess(this.caProcess);
        if (this.vignetteProcess) this.camera.detachPostProcess(this.vignetteProcess);
        if (this.softFocusProcess) this.camera.detachPostProcess(this.softFocusProcess);
        if (this.grainProcess) this.camera.detachPostProcess(this.grainProcess);

        // 按顺序重新附加：色调 → 全屏色散 → 暗角 → 柔焦 → 胶片颗粒
        if (this.currentState?.hueEnabled && this.hueProcess) {
            this.camera.attachPostProcess(this.hueProcess);
        }
        if (this.currentState?.caEnabled && this.caProcess) {
            this.camera.attachPostProcess(this.caProcess);
        }
        if (this.currentState?.vignetteEnabled && this.vignetteProcess) {
            this.camera.attachPostProcess(this.vignetteProcess);
        }
        if (this.currentState?.softFocusEnabled && this.softFocusProcess) {
            this.camera.attachPostProcess(this.softFocusProcess);
        }
        if (this.currentState?.grainEnabled && this.grainProcess) {
            this.camera.attachPostProcess(this.grainProcess);
        }
    }

    public setVignetteEnabled(enabled: boolean): void {
        if (!this.currentState || !this.vignetteProcess || !this.camera) return;
        this.currentState.vignetteEnabled = enabled;
        this._syncSpecialEffectsOrder();
    }

    public setVignetteIntensity(value: number): void {
        if (!this.currentState) return;
        this.currentState.vignetteIntensity = value;
    }

    public setVignetteSoftness(value: number): void {
        if (!this.currentState) return;
        this.currentState.vignetteSoftness = value;
    }

    public setVignetteColor(r: number, g: number, b: number): void {
        if (!this.currentState) return;
        this.currentState.vignetteColor = { r, g, b };
    }

    public setCAEnabled(enabled: boolean): void {
        if (!this.currentState || !this.caProcess || !this.camera) return;
        this.currentState.caEnabled = enabled;
        this._syncSpecialEffectsOrder();
    }

    public setCAIntensity(value: number): void {
        if (!this.currentState) return;
        this.currentState.caIntensity = value;
    }

    public setGrainEnabled(enabled: boolean): void {
        if (!this.currentState || !this.grainProcess || !this.camera) return;
        this.currentState.grainEnabled = enabled;
        this._syncSpecialEffectsOrder();
    }

    public setGrainIntensity(value: number): void {
        if (!this.currentState) return;
        this.currentState.grainIntensity = value;
    }

    public setSoftFocusEnabled(enabled: boolean): void {
        if (!this.currentState || !this.softFocusProcess || !this.camera) return;
        this.currentState.softFocusEnabled = enabled;
        this._syncSpecialEffectsOrder();
    }

    public setSoftFocusIntensity(value: number): void {
        if (!this.currentState) return;
        this.currentState.softFocusIntensity = value;
    }

    public setHueEnabled(enabled: boolean): void {
        if (!this.currentState || !this.hueProcess || !this.camera) return;
        this.currentState.hueEnabled = !!enabled;
        this._syncSpecialEffectsOrder();
    }

    public setHueShift(value: number): void {
        if (!this.currentState) return;
        this.currentState.hueShift = value;
    }

    public dispose(): void {
        // 分离并释放特效 PostProcess
        if (this.camera) {
            if (this.vignetteProcess) {
                this.camera.detachPostProcess(this.vignetteProcess);
                this.vignetteProcess.dispose();
                this.vignetteProcess = null;
            }
            if (this.caProcess) {
                this.camera.detachPostProcess(this.caProcess);
                this.caProcess.dispose();
                this.caProcess = null;
            }
            if (this.softFocusProcess) {
                this.camera.detachPostProcess(this.softFocusProcess);
                this.softFocusProcess.dispose();
                this.softFocusProcess = null;
            }
            if (this.grainProcess) {
                this.camera.detachPostProcess(this.grainProcess);
                this.grainProcess.dispose();
                this.grainProcess = null;
            }
            if (this.hueProcess) {
                this.camera.detachPostProcess(this.hueProcess);
                this.hueProcess.dispose();
                this.hueProcess = null;
            }
        }
        if (this.autoFocusController) {
            this.autoFocusController.dispose();
            this.autoFocusController = null;
        }
        if (this._beforeRenderObserver) {
            if (this.scene) {
                this.scene.onBeforeRenderObservable.remove(this._beforeRenderObserver);
            }
            this._beforeRenderObserver = null;
        }
        if (this.customDOF) {
            this.customDOF.dispose();
            this.customDOF = null;
        }
        if (this.pipeline) {
            if (this._isPipelineAttached && this.camera) {
                this.pipeline.removeCamera(this.camera);
                this._isPipelineAttached = false;
            }
            this.pipeline.dispose();
            this.pipeline = null;
        }
        this.colorCurves = null;
        this.scene = null;
        this.camera = null;
    }
}
