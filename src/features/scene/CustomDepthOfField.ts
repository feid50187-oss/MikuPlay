
import {
    Scene,
    Camera,
    PostProcess,
    PassPostProcess,
    DepthRenderer,
    Effect,
    Texture,
    Constants
} from '@babylonjs/core';

const COC_SHADER = 'customDOFCoc';
const BLUR_SHADER = 'customDOFBlur';
const MERGE_SHADER = 'customDOFMerge';

Effect.ShadersStore[`${COC_SHADER}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D depthSampler;
uniform float uFocusDistance;
uniform float uDofDepth;
uniform float uBlurIntensity;

void main() {
    float cameraSpaceZ = texture2D(depthSampler, vUV).r;
    float distance = abs(cameraSpaceZ);
    float distFromFocus = abs(distance - uFocusDistance);
    float halfDepth = uDofDepth * 0.5;
    float gradient = max(halfDepth * 0.5, 0.1);
    float coc = smoothstep(halfDepth, halfDepth + gradient, distFromFocus) * uBlurIntensity;
    gl_FragColor = vec4(coc, coc, coc, 1.0);
}
`;

Effect.ShadersStore[`${BLUR_SHADER}FragmentShader`] = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D circleOfConfusionSampler;
uniform vec2 uDirection;
uniform float uMaxBlurRadius;
uniform vec2 uTexelSize;

void main() {
    float centerCoC = texture2D(circleOfConfusionSampler, vUV).r;
    vec4 color = texture2D(textureSampler, vUV);
    float totalWeight = 1.0;

    float blurRadius = centerCoC * uMaxBlurRadius;

    for (int i = 1; i <= 4; i++) {
        float t = float(i) / 4.0;
        float offset = t * blurRadius;
        vec2 delta = uDirection * offset * uTexelSize;

        vec2 uv1 = vUV + delta;
        float coc1 = texture2D(circleOfConfusionSampler, uv1).r;
        float w1 = max(coc1, 0.001);
        color += texture2D(textureSampler, uv1) * w1;
        totalWeight += w1;

        vec2 uv2 = vUV - delta;
        float coc2 = texture2D(circleOfConfusionSampler, uv2).r;
        float w2 = max(coc2, 0.001);
        color += texture2D(textureSampler, uv2) * w2;
        totalWeight += w2;
    }

    gl_FragColor = color / totalWeight;
}
`;

Effect.ShadersStore[`${MERGE_SHADER}FragmentShader`] = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D circleOfConfusionSampler;
uniform sampler2D blurSampler;

void main() {
    vec4 original = texture2D(textureSampler, vUV);
    vec4 blurred = texture2D(blurSampler, vUV);
    float coc = texture2D(circleOfConfusionSampler, vUV).r;
    gl_FragColor = mix(original, blurred, coc);
}
`;

export interface CustomDOFSettings {
    isEnabled: boolean;
    focusDistance: number;
    dofDepth: number;
    blurIntensity: number;
}

const DEFAULT_SETTINGS: CustomDOFSettings = {
    isEnabled: false,
    focusDistance: 50,
    dofDepth: 20,
    blurIntensity: 0.6
};

export class CustomDepthOfField {
    private _scene: Scene;
    private _camera: Camera;
    private _depthRenderer: DepthRenderer | null = null;
    private _passProcess: PassPostProcess | null = null;
    private _cocProcess: PostProcess | null = null;
    private _blurYProcess: PostProcess | null = null;
    private _blurXProcess: PostProcess | null = null;
    private _mergeProcess: PostProcess | null = null;
    private _settings: CustomDOFSettings = { ...DEFAULT_SETTINGS };
    private _isInitialized = false;
    private _allProcesses: PostProcess[] = [];
    private _isAttached = false;
    private _cachedTexelSize: { x: number; y: number } = { x: 0, y: 0 };
    private _resizeObserver: ResizeObserver | null = null;

    constructor(scene: Scene, camera: Camera) {
        this._scene = scene;
        this._camera = camera;
    }

    get isInitialized(): boolean {
        return this._isInitialized;
    }

    get isEnabled(): boolean {
        return this._settings.isEnabled;
    }

    set isEnabled(value: boolean) {
        if (this._settings.isEnabled === value) return;
        this._settings.isEnabled = value;
        if (this._isInitialized) {
            this._applyEnabled();
        }
    }

    get focusDistance(): number {
        return this._settings.focusDistance;
    }

    set focusDistance(value: number) {
        this._settings.focusDistance = Math.max(0, value);
    }

    get dofDepth(): number {
        return this._settings.dofDepth;
    }

    set dofDepth(value: number) {
        this._settings.dofDepth = Math.max(0.1, value);
    }

    get blurIntensity(): number {
        return this._settings.blurIntensity;
    }

    set blurIntensity(value: number) {
        this._settings.blurIntensity = Math.max(0, Math.min(1, value));
    }

    initialize(): void {
        if (this._isInitialized) return;

        const engine = this._scene.getEngine();
        const canvas = engine.getRenderingCanvas();

        this._updateTexelSize(canvas);

        if (canvas) {
            this._resizeObserver = new ResizeObserver(() => {
                this._updateTexelSize(canvas);
            });
            this._resizeObserver.observe(canvas);
        }

        this._depthRenderer = this._scene.enableDepthRenderer(
            undefined,
            false,
            true,
            undefined,
            true
        );

        const depthTexture = this._depthRenderer.getDepthMap();

        this._passProcess = new PassPostProcess(
            'customDOFPass',
            1.0,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            engine,
            false,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );

        this._cocProcess = new PostProcess(
            'customDOFCoc',
            COC_SHADER,
            ['uFocusDistance', 'uDofDepth', 'uBlurIntensity'],
            ['depthSampler'],
            0.5,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            engine,
            false,
            null,
            Constants.TEXTURETYPE_HALF_FLOAT
        );
        this._cocProcess.onApply = (effect) => {
            effect.setTexture('depthSampler', depthTexture);
            effect.setFloat('uFocusDistance', this._settings.focusDistance);
            effect.setFloat('uDofDepth', this._settings.dofDepth);
            effect.setFloat('uBlurIntensity', this._settings.blurIntensity);
        };

        this._blurYProcess = new PostProcess(
            'customDOFBlurY',
            BLUR_SHADER,
            ['uDirection', 'uMaxBlurRadius', 'uTexelSize'],
            ['circleOfConfusionSampler'],
            0.5,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            engine,
            false,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        this._blurYProcess.onApply = (effect) => {
            effect.setTextureFromPostProcess('textureSampler', this._cocProcess);
            effect.setTextureFromPostProcessOutput('circleOfConfusionSampler', this._cocProcess);
            effect.setFloat2('uDirection', 0.0, 1.0);
            effect.setFloat('uMaxBlurRadius', 16.0);
            effect.setFloat2('uTexelSize', this._cachedTexelSize.x, this._cachedTexelSize.y);
        };

        this._blurXProcess = new PostProcess(
            'customDOFBlurX',
            BLUR_SHADER,
            ['uDirection', 'uMaxBlurRadius', 'uTexelSize'],
            ['circleOfConfusionSampler'],
            0.5,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            engine,
            false,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        this._blurXProcess.onApply = (effect) => {
            effect.setTextureFromPostProcessOutput('circleOfConfusionSampler', this._cocProcess);
            effect.setFloat2('uDirection', 1.0, 0.0);
            effect.setFloat('uMaxBlurRadius', 16.0);
            effect.setFloat2('uTexelSize', this._cachedTexelSize.x, this._cachedTexelSize.y);
        };

        this._mergeProcess = new PostProcess(
            'customDOFMerge',
            MERGE_SHADER,
            [],
            ['circleOfConfusionSampler', 'blurSampler'],
            1.0,
            null,
            Texture.BILINEAR_SAMPLINGMODE,
            engine,
            false,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        this._mergeProcess.onApply = (effect) => {
            effect.setTextureFromPostProcess('textureSampler', this._passProcess);
            effect.setTextureFromPostProcessOutput('circleOfConfusionSampler', this._cocProcess);
            effect.setTextureFromPostProcessOutput('blurSampler', this._blurXProcess);
        };

        this._allProcesses = [
            this._passProcess,
            this._cocProcess,
            this._blurYProcess,
            this._blurXProcess,
            this._mergeProcess
        ];

        this._applyEnabled();
        this._isInitialized = true;
    }

    private _updateTexelSize(canvas: HTMLCanvasElement | OffscreenCanvas | null): void {
        const width = canvas?.width ?? 1920;
        const height = canvas?.height ?? 1080;
        this._cachedTexelSize.x = 2.0 / width;
        this._cachedTexelSize.y = 2.0 / height;
    }

    private _applyEnabled(): void {
        if (this._settings.isEnabled && !this._isAttached) {
            for (const process of this._allProcesses) {
                this._camera.attachPostProcess(process);
            }
            this._isAttached = true;
        } else if (!this._settings.isEnabled && this._isAttached) {
            for (let i = this._allProcesses.length - 1; i >= 0; i--) {
                this._camera.detachPostProcess(this._allProcesses[i]);
            }
            this._isAttached = false;
        }
    }

    dispose(): void {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this._isAttached) {
            for (let i = this._allProcesses.length - 1; i >= 0; i--) {
                this._camera.detachPostProcess(this._allProcesses[i]);
            }
            this._isAttached = false;
        }
        for (const process of this._allProcesses) {
            process.dispose(this._camera);
        }
        this._allProcesses = [];
        this._passProcess = null;
        this._cocProcess = null;
        this._blurYProcess = null;
        this._blurXProcess = null;
        this._mergeProcess = null;
        if (this._depthRenderer) {
            this._scene.disableDepthRenderer();
            this._depthRenderer = null;
        }
        this._isInitialized = false;
    }
}
