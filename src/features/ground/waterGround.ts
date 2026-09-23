
/**
 * Water Ground Module - 水面地面模块 (Shader版本)
 *
 * 主要功能:
 * - 使用自定义ShaderMaterial实现动态波浪水面
 * - 基于Shadertoy的波浪算法，使用GPU计算波浪
 * - 包含Fresnel反射、大气散射、水下散射效果
 * - 精简的参数控制，更易用
 *
 * 调用关系:
 * - 被 GroundSection 调用: 创建和管理水面地面
 * - 使用 Babylon.js ShaderMaterial: 自定义顶点和片段着色器
 * - 使用 scene.registerBeforeRender: 更新时间uniform实现动画
 */

import { Scene, MeshBuilder, ShaderMaterial, Color3, AbstractMesh, Effect } from '@babylonjs/core';
import { SceneManager } from '../scene/SceneManager';
import { RGBColorPicker } from '../../UIComponents/shared/RGBColorPicker';
import { Slider } from '../../UIComponents/shared/Slider';

// 引入着色器代码
import vertexShader from './shaders/water.vertex.glsl';
import fragmentShader from './shaders/water.fragment.glsl';

// 注册着色器到Babylon.js
Effect.ShadersStore['waterVertexShader'] = vertexShader;
Effect.ShadersStore['waterFragmentShader'] = fragmentShader;

/**
 * 创建滑块项（复用共享 Slider 组件，统一为 mp-slider 样式与交互）
 */
function createSliderItem(
    label: string,
    initialValue: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void
): HTMLElement {
    const slider = new Slider({ label, min, max, step, value: initialValue });
    slider.onChange(onChange);
    return slider.element;
}



export class WaterGround {
    private groundMesh: AbstractMesh | null = null;
    private waterMaterial: ShaderMaterial | null = null;
    private currentScene: Scene | null = null;

    // 精简后的参数（从10个减少到6个）
    private waveIntensity = 1.0;      // 波浪强度（综合幅度和层次感）
    private waveSpeed = 1.0;          // 波浪速度
    private waveScale = 15.0;        // 波浪缩放（UV坐标需要更大的值）
    private waterColor = new Color3(0.37, 0.8, 1.0);  // 水体颜色
    private waterAlpha = 0.7;         // 透明度
    private sunHeight = 1.0;          // 太阳高度（控制光照）
    private scatteringIntensity = 1.0; // 散射强度
    private edgeFade = 0;              // 边缘渐隐强度 0（关闭）~ 1（最大范围），外圈 alpha 衰减到 0，消除地平线接缝

    private registeredRenderFn: (() => void) | null = null;

    /**
     * 创建水面地面
     */
    create(scene: Scene, scale: number, height: number): void {
        this.dispose();
        this.currentScene = scene;

        // 创建地面网格
        const mesh = MeshBuilder.CreateGround('waterGround', {
            width: 100,
            height: 100,
            subdivisions: 128,
            updatable: false  // 不再需要CPU更新顶点
        }, scene);

        mesh.scaling.x = scale;
        mesh.scaling.z = scale;
        mesh.position.y = height;

        this.groundMesh = mesh;

        // 创建ShaderMaterial
        this.waterMaterial = new ShaderMaterial('waterShader', scene, {
            vertex: 'water',
            fragment: 'water'
        }, {
            attributes: ['position', 'normal', 'uv'],
            uniforms: [
                'world', 'view', 'projection', 'cameraPosition',
                'time', 'waveIntensity', 'waveSpeed', 'waveScale', 'waterDepth',
                'waterColor', 'waterAlpha', 'sunHeight', 'scatteringIntensity', 'edgeFade'
            ],
            needAlphaBlending: true
        });

        // 设置初始uniform值
        this.updateUniforms();

        // 应用材质
        this.groundMesh.material = this.waterMaterial;
        this.groundMesh.isPickable = false;

        // 注册阴影接收体
        const lightManager = SceneManager.getLightManager(scene);
        if (lightManager?.registerShadowReceiver) {
            lightManager.registerShadowReceiver(this.groundMesh);
        } else {
            this.groundMesh.receiveShadows = true;
        }

        // 注册动画更新
        this.registeredRenderFn = () => {
            if (this.waterMaterial) {
                this.waterMaterial.setFloat('time', performance.now() * 0.001);
            }
        };
        scene.registerBeforeRender(this.registeredRenderFn);
    }

    /**
     * 更新所有uniform值
     */
    private updateUniforms(): void {
        if (!this.waterMaterial) return;

        this.waterMaterial.setFloat('waveIntensity', this.waveIntensity);
        this.waterMaterial.setFloat('waveSpeed', this.waveSpeed);
        this.waterMaterial.setFloat('waveScale', this.waveScale);
        this.waterMaterial.setFloat('waterDepth', 1.0);
        this.waterMaterial.setColor3('waterColor', this.waterColor);
        this.waterMaterial.setFloat('waterAlpha', this.waterAlpha);
        this.waterMaterial.setFloat('sunHeight', this.sunHeight);
        this.waterMaterial.setFloat('scatteringIntensity', this.scatteringIntensity);
        this.waterMaterial.setFloat('edgeFade', this.edgeFade);
    }

    /**
     * 释放水面资源
     */
    dispose(): void {
        if (this.currentScene && this.registeredRenderFn) {
            this.currentScene.unregisterBeforeRender(this.registeredRenderFn);
            this.registeredRenderFn = null;
        }
        if (this.waterMaterial) {
            this.waterMaterial.dispose();
            this.waterMaterial = null;
        }
        if (this.groundMesh) {
            this.groundMesh.dispose();
            this.groundMesh = null;
        }
        this.currentScene = null;
    }

    /**
     * 设置地面缩放
     */
    setScale(scale: number): void {
        if (this.groundMesh) {
            this.groundMesh.scaling.x = scale;
            this.groundMesh.scaling.z = scale;
        }
    }

    /**
     * 设置地面高度
     */
    setHeight(height: number): void {
        if (this.groundMesh) {
            this.groundMesh.position.y = height;
        }
    }

    /**
     * 设置波浪强度
     */
    setWaveIntensity(intensity: number): void {
        this.waveIntensity = intensity;
        this.waterMaterial?.setFloat('waveIntensity', intensity);
    }

    /**
     * 设置波浪速度
     */
    setWaveSpeed(speed: number): void {
        this.waveSpeed = speed;
        this.waterMaterial?.setFloat('waveSpeed', speed);
    }

    /**
     * 设置波浪缩放
     */
    setWaveScale(scale: number): void {
        this.waveScale = scale;
        this.waterMaterial?.setFloat('waveScale', scale);
    }

    /**
     * 设置水色
     */
    setWaterColor(r: number, g: number, b: number): void {
        this.waterColor.set(r, g, b);
        this.waterMaterial?.setColor3('waterColor', this.waterColor);
    }

    /**
     * 设置透明度
     */
    setWaterAlpha(alpha: number): void {
        this.waterAlpha = alpha;
        this.waterMaterial?.setFloat('waterAlpha', alpha);
    }

    /**
     * 设置太阳高度
     */
    setSunHeight(height: number): void {
        this.sunHeight = height;
        this.waterMaterial?.setFloat('sunHeight', height);
    }

    /**
     * 设置散射强度
     */
    setScatteringIntensity(intensity: number): void {
        this.scatteringIntensity = intensity;
        this.waterMaterial?.setFloat('scatteringIntensity', intensity);
    }

    /**
     * 设置边缘渐隐强度
     * @param value 0（关闭）~ 1（最大范围渐隐）
     */
    setEdgeFade(value: number): void {
        this.edgeFade = Math.max(0, Math.min(1, value));
        this.waterMaterial?.setFloat('edgeFade', this.edgeFade);
    }

    /**
     * 创建参数控制面板（精简版）
     */
    createPrivateParams(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'world-ground-private-params';

        // 波浪强度 - 综合控制波浪高度和层次感
        container.appendChild(createSliderItem(
            '波浪强度',
            this.waveIntensity,
            0,
            2,
            0.01,
            (v) => this.setWaveIntensity(v)
        ));

        // 波浪速度
        container.appendChild(createSliderItem(
            '波浪速度',
            this.waveSpeed,
            0.5,
            5,
            0.1,
            (v) => this.setWaveSpeed(v)
        ));

        // 波浪缩放 - UV坐标频率控制
        container.appendChild(createSliderItem(
            '波浪缩放',
            this.waveScale,
            1,
            20,
            1,
            (v) => this.setWaveScale(v)
        ));

        // 水体颜色
        const colorPicker = new RGBColorPicker({
            label: '水体颜色',
            mode: 'popup',
            color: { r: this.waterColor.r, g: this.waterColor.g, b: this.waterColor.b }
        });
        colorPicker.onChange((newColor) => {
            this.setWaterColor(newColor.r, newColor.g, newColor.b);
        });
        container.appendChild(colorPicker.element);

        // 透明度
        container.appendChild(createSliderItem(
            '透明度',
            this.waterAlpha,
            0.1,
            1,
            0.01,
            (v) => this.setWaterAlpha(v)
        ));

        // 太阳高度 - 控制光照角度
        container.appendChild(createSliderItem(
            '太阳高度',
            this.sunHeight,
            -0.5,
            1,
            0.01,
            (v) => this.setSunHeight(v)
        ));

        // 散射强度
        container.appendChild(createSliderItem(
            '散射强度',
            this.scatteringIntensity,
            0,
            2,
            0.01,
            (v) => this.setScatteringIntensity(v)
        ));

        // 边缘渐隐（0 关闭 ~ 1 最大范围，外圈 alpha 衰减融入背景）
        container.appendChild(createSliderItem(
            '边缘渐隐',
            this.edgeFade,
            0,
            1,
            0.01,
            (v) => this.setEdgeFade(v)
        ));

        return container;
    }
}
