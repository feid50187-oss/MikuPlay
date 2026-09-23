import {
    Scene,
    HemisphericLight,
    DirectionalLight,
    Color3,
    Vector3,
    ShadowGenerator,
    AbstractMesh
} from '@babylonjs/core';
import type { ILightManager, LightConfig, ShadowConfig } from './types';

/**
 * 光照管理器
 * 管理环境光和方向光
 */
export class LightManager implements ILightManager {
    /** Babylon 场景实例 */
    private scene: Scene;

    /** 环境光 */
    private ambientLight: HemisphericLight;

    /** 方向光 */
    private directionalLight: DirectionalLight;

    /** 阴影生成器 */
    private shadowGenerator: ShadowGenerator | null = null;

    /** 当前光照配置 */
    private config: LightConfig;

    /** 阴影配置 */
    private shadowConfig: ShadowConfig;

    /** 方向光初始方向 - 必须与 config.directionalDirection 语义一致（归一化后方向相同）
     *  滑块 (0,0) 对应此方向，旋转计算以此为基准 */
    private readonly initialDirection: Vector3 = new Vector3(0, -0.3, 1);

    /** 当前旋转角度（弧度） */
    private currentRotationX: number = 0;
    private currentRotationY: number = 0;
    private currentRotationZ: number = 0;

    /** 方向光亮度 */
    private directionalIntensity: number = 1;

    /** 预分配临时对象，消除旋转时分配 */
    private static readonly _TmpBaseDir = new Vector3();
    private static readonly _TmpBaseDirNorm = new Vector3();
    private static readonly _TmpRotated1 = new Vector3();
    private static readonly _TmpRotated2 = new Vector3();
    private static readonly _TmpFinalDir = new Vector3();

    /** 阴影接收体列表 */
    private shadowReceivers: Set<AbstractMesh> = new Set();

    /** 阴影投射体列表 */
    private shadowCasters: Set<AbstractMesh> = new Set();

    /** 阴影是否启用 */
    private shadowEnabled: boolean = false;

    /**
     * 构造函数
     * @param scene Babylon 场景实例
     */
    constructor(scene: Scene) {
        this.scene = scene;

        this.shadowConfig = {
            enabled: false,
            resolution: 1024,
            selfShadow: true,
            quality: 'medium',
            intensity: 1.0,
            filterMode: 'pcf',
            bias: 0.0003,
            normalBias: 0,
            darkness: 0,
            frustumEdgeFalloff: 0.1,
            transparencyShadow: true,
            shadowArea: 12,
            autoFrustum: false
        };

        this.config = {
            ambientIntensity: 0.25,
            ambientColor: { r: 0.5, g: 0.5, b: 0.5 },
            directionalIntensity: 1,
            directionalColor: { r: 1, g: 1, b: 1 },
            directionalDirection: { x: 0, y: -0.3, z: 1 },
            shadow: this.shadowConfig
        };

        this.ambientLight = this.createAmbientLight();
        this.directionalLight = this.createDirectionalLight();

        this.syncRotationFromDirection();
    }

    /**
     * 根据当前方向光方向向量同步旋转角度状态
     */
    private syncRotationFromDirection(): void {
        const dir = this.directionalLight.direction.normalize();
        const baseDir = LightManager._TmpBaseDirNorm.copyFrom(this.initialDirection).normalize();

        const dot = Vector3.Dot(baseDir, dir);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

        if (Math.abs(angle) < 0.0001) {
            this.currentRotationX = 0;
            this.currentRotationY = 0;
            return;
        }

        const axis = Vector3.Cross(baseDir, dir).normalize();
        if (axis.length() < 0.0001) {
            this.currentRotationX = 0;
            this.currentRotationY = 0;
            return;
        }

        const up = Vector3.Up();
        const right = Vector3.Right();

        const projY = Vector3.Dot(axis, up);
        const projX = Vector3.Dot(axis, right);

        const total = Math.abs(projX) + Math.abs(projY);
        if (total > 0.0001) {
            this.currentRotationY = angle * (projY / total) * (axis.z >= 0 ? 1 : -1);
            this.currentRotationX = angle * (projX / total) * (axis.z >= 0 ? 1 : -1);
        } else {
            this.currentRotationX = angle;
            this.currentRotationY = 0;
        }
    }

    /**
     * 创建环境光
     * @returns 环境光实例
     */
    private createAmbientLight(): HemisphericLight {
        const light = new HemisphericLight(
            'ambientLight',
            new Vector3(0, 1, 0),
            this.scene
        );

        light.intensity = this.config.ambientIntensity;
        light.diffuse = new Color3(
            this.config.ambientColor.r,
            this.config.ambientColor.g,
            this.config.ambientColor.b
        );
        light.groundColor = new Color3(0.2, 0.2, 0.2);

        return light;
    }

    /**
     * 创建方向光
     * @returns 方向光实例
     */
    private createDirectionalLight(): DirectionalLight {
        const direction = new Vector3(
            this.config.directionalDirection.x,
            this.config.directionalDirection.y,
            this.config.directionalDirection.z
        ).normalize();

        const light = new DirectionalLight(
            'directionalLight',
            direction,
            this.scene
        );

        light.intensity = 1;
        light.diffuse = new Color3(
            this.config.directionalColor.r,
            this.config.directionalColor.g,
            this.config.directionalColor.b
        );

        // 设置方向光阴影参数
        // autoFrustum=true 时使用 Babylon.js 自动视锥体计算（精度最高，仅覆盖投射体附近）
        // autoFrustum=false 时使用 shadowArea 手动控制覆盖范围（适合全身舞台 + PCF/PCSS）
        light.autoCalcShadowZBounds = true;
        light.autoUpdateExtends = this.shadowConfig.autoFrustum;
        light.shadowOrthoScale = 0.1;

        // 先赋值给 this.directionalLight，以便 updateShadowFrustum() 能访问 light 属性
        this.directionalLight = light;

        // 手动模式下应用基于 shadowArea 的视锥参数
        if (!this.shadowConfig.autoFrustum) {
            this.updateShadowFrustum();
        }

        // 创建阴影生成器
        this.initializeShadowGenerator(light);

        // 显式按当前配置（默认 enabled=false）初始化阴影开关：
        // 把 directionalLight.shadowEnabled 置为与配置一致，
        // 否则它会停在 Babylon 默认 true，导致阴影贴图在“关”状态仍每帧渲染（纯浪费）。
        this.setShadowEnabled(this.shadowConfig.enabled);

        return light;
    }

    /**
     * 初始化阴影生成器
     * @param light 方向光
     */
    private initializeShadowGenerator(light: DirectionalLight): void {
        this.shadowGenerator = new ShadowGenerator(
            this.shadowConfig.resolution,
            light,
            true
        );

        this.updateShadowGeneratorConfig();

        // 重新添加所有阴影投射体
        for (const mesh of this.shadowCasters) {
            if (!mesh.isDisposed()) {
                this.shadowGenerator.addShadowCaster(mesh);
            }
        }
    }

    /**
     * 更新阴影生成器配置
     */
    private updateShadowGeneratorConfig(): void {
        if (!this.shadowGenerator) return;

        const config = this.shadowConfig;

        // 基础配置
        this.shadowGenerator.transparencyShadow = config.transparencyShadow;
        this.shadowGenerator.frustumEdgeFalloff = config.frustumEdgeFalloff;
        this.shadowGenerator.bias = config.bias;
        this.shadowGenerator.normalBias = config.normalBias;
        this.shadowGenerator.darkness = config.darkness;

        // 过滤模式设置
        this.applyFilterMode(config.filterMode);

        // 质量设置
        switch (config.quality) {
            case 'low':
                this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_LOW;
                break;
            case 'high':
                this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
                break;
            default:
                this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
        }
    }

    /**
     * 应用阴影过滤模式
     * @param mode 过滤模式
     */
    private applyFilterMode(mode: string): void {
        if (!this.shadowGenerator) return;

        // 重置所有过滤模式
        this.shadowGenerator.useBlurCloseExponentialShadowMap = false;
        this.shadowGenerator.usePercentageCloserFiltering = false;
        this.shadowGenerator.useContactHardeningShadow = false;

        switch (mode) {
            case 'blurCloseEsm':
                this.shadowGenerator.useBlurCloseExponentialShadowMap = true;
                break;
            case 'pcf':
                this.shadowGenerator.usePercentageCloserFiltering = true;
                break;
            case 'pcss':
                this.shadowGenerator.useContactHardeningShadow = true;
                break;
            case 'none':
            default:
                // 不启用任何过滤
                break;
        }
    }

    /**
     * 设置阴影启用状态
     * @param enabled 是否启用
     */
    public setShadowEnabled(enabled: boolean): void {
        this.shadowConfig.enabled = enabled;
        this.config.shadow.enabled = enabled;
        this.shadowEnabled = enabled;

        // 通过方向光的 shadowEnabled 控制阴影生成
        if (this.directionalLight) {
            this.directionalLight.shadowEnabled = enabled;
        }

        // 同步更新所有阴影接收体的 receiveShadows 状态
        for (const mesh of this.shadowReceivers) {
            if (!mesh.isDisposed()) {
                mesh.receiveShadows = enabled;
            }
        }
    }

    /**
     * 获取阴影生成器
     * @returns 阴影生成器实例
     */
    public getShadowGenerator(): any {
        return this.shadowGenerator;
    }

    /**
     * 添加阴影投射体
     * @param mesh 网格对象
     */
    public addShadowCaster(mesh: AbstractMesh): void {
        this.shadowCasters.add(mesh);
        this.shadowGenerator?.addShadowCaster(mesh);
    }

    /**
     * 移除阴影投射体
     * @param mesh 网格对象
     */
    public removeShadowCaster(mesh: AbstractMesh): void {
        this.shadowCasters.delete(mesh);
        this.shadowGenerator?.removeShadowCaster(mesh);
    }

    /**
     * 注册阴影接收体
     * @param mesh 网格对象
     */
    public registerShadowReceiver(mesh: AbstractMesh): void {
        this.shadowReceivers.add(mesh);
        mesh.receiveShadows = this.shadowEnabled;
    }

    /**
     * 注销阴影接收体
     * @param mesh 网格对象
     */
    public unregisterShadowReceiver(mesh: AbstractMesh): void {
        this.shadowReceivers.delete(mesh);
    }

    /**
     * 设置阴影配置
     * @param config 阴影配置
     */
    public setShadowConfig(config: Partial<ShadowConfig>): void {
        Object.assign(this.shadowConfig, config);
        Object.assign(this.config.shadow, config);
        this.updateShadowGeneratorConfig();
    }

    /**
     * 设置阴影分辨率
     * @param resolution 分辨率 (如 512, 1024, 2048, 4096)
     */
    public setShadowResolution(resolution: number): void {
        this.shadowConfig.resolution = resolution;
        this.config.shadow.resolution = resolution;

        // 需要重新创建阴影生成器以应用新的分辨率
        if (this.shadowGenerator && this.directionalLight) {
            this.shadowGenerator.dispose();
            this.initializeShadowGenerator(this.directionalLight);
        }
    }

    /**
     * 设置阴影过滤模式
     * @param mode 过滤模式
     */
    public setShadowFilterMode(mode: string): void {
        this.shadowConfig.filterMode = mode as any;
        this.config.shadow.filterMode = mode as any;
        this.applyFilterMode(mode);
    }

    /**
     * 设置阴影偏移
     * @param bias 偏移值
     */
    public setShadowBias(bias: number): void {
        this.shadowConfig.bias = bias;
        this.config.shadow.bias = bias;
        if (this.shadowGenerator) {
            this.shadowGenerator.bias = bias;
        }
    }

    /**
     * 设置法线偏移
     * @param normalBias 法线偏移值
     */
    public setShadowNormalBias(normalBias: number): void {
        this.shadowConfig.normalBias = normalBias;
        this.config.shadow.normalBias = normalBias;
        if (this.shadowGenerator) {
            this.shadowGenerator.normalBias = normalBias;
        }
    }

    /**
     * 设置阴影深度
     * @param darkness 深度值 (0-1)
     */
    public setShadowDarkness(darkness: number): void {
        this.shadowConfig.darkness = darkness;
        this.config.shadow.darkness = darkness;
        if (this.shadowGenerator) {
            this.shadowGenerator.darkness = darkness;
        }
    }



    /**
     * 设置视锥边缘衰减
     * @param falloff 衰减值 (0-1)
     */
    public setShadowFrustumEdgeFalloff(falloff: number): void {
        this.shadowConfig.frustumEdgeFalloff = falloff;
        this.config.shadow.frustumEdgeFalloff = falloff;
        if (this.shadowGenerator) {
            this.shadowGenerator.frustumEdgeFalloff = falloff;
        }
    }

    /**
     * 设置阴影投射范围
     * @param area 半边长 (10-200)，控制正交投影覆盖区域大小
     */
    public setShadowArea(area: number): void {
        const clampedArea = Math.max(10, Math.min(200, area));
        this.shadowConfig.shadowArea = clampedArea;
        this.config.shadow.shadowArea = clampedArea;
        this.updateShadowFrustum();
    }

    /**
     * 设置是否自动计算阴影视锥体
     * @param auto true=自动适配投射体（高精度小范围），false=手动范围
     */
    public setAutoFrustum(auto: boolean): void {
        this.shadowConfig.autoFrustum = auto;
        this.config.shadow.autoFrustum = auto;

        if (this.directionalLight) {
            this.directionalLight.autoUpdateExtends = auto;
            if (!auto) {
                // 切回手动模式时立即应用手动参数
                this.updateShadowFrustum();
            }
        }
    }

    /**
     * 设置环境光亮度
     * @param intensity 亮度值 (0-1)
     */
    public setAmbientIntensity(intensity: number): void {
        const clampedIntensity = Math.max(0, Math.min(1, intensity));
        this.config.ambientIntensity = clampedIntensity;
        this.ambientLight.intensity = clampedIntensity;
    }

    /**
     * 设置环境光颜色
     * @param r 红色分量 (0-1)
     * @param g 绿色分量 (0-1)
     * @param b 蓝色分量 (0-1)
     */
    public setAmbientColor(r: number, g: number, b: number): void {
        const clampedR = Math.max(0, Math.min(1, r));
        const clampedG = Math.max(0, Math.min(1, g));
        const clampedB = Math.max(0, Math.min(1, b));

        this.config.ambientColor.r = clampedR;
        this.config.ambientColor.g = clampedG;
        this.config.ambientColor.b = clampedB;
        this.ambientLight.diffuse.set(clampedR, clampedG, clampedB);
    }

    /**
     * 设置方向光颜色
     * @param r 红色分量 (0-1)
     * @param g 绿色分量 (0-1)
     * @param b 蓝色分量 (0-1)
     */
    public setDirectionalColor(r: number, g: number, b: number): void {
        const clampedR = Math.max(0, Math.min(1, r));
        const clampedG = Math.max(0, Math.min(1, g));
        const clampedB = Math.max(0, Math.min(1, b));

        this.config.directionalColor.r = clampedR;
        this.config.directionalColor.g = clampedG;
        this.config.directionalColor.b = clampedB;
        this.directionalLight.diffuse.set(clampedR, clampedG, clampedB);
    }

    /**
     * 设置方向光亮度
     * @param intensity 亮度值 (0-2)
     */
    public setDirectionalIntensity(intensity: number): void {
        const clampedIntensity = Math.max(0, Math.min(2, intensity));
        this.config.directionalIntensity = clampedIntensity;
        this.directionalIntensity = clampedIntensity;
        this.directionalLight.intensity = clampedIntensity;
    }

    /**
     * 设置方向光方向
     * @param x X分量
     * @param y Y分量
     * @param z Z分量
     */
    public setDirectionalDirection(x: number, y: number, z: number): void {
        this.directionalLight.direction.set(x, y, z).normalize();
        this.config.directionalDirection.x = x;
        this.config.directionalDirection.y = y;
        this.config.directionalDirection.z = z;

        this.syncRotationFromDirection();
        this.updateShadowFrustum();
    }

    /**
     * 根据光照方向动态调整阴影正交投影参数
     *
     * 使用 shadowArea 作为基础半边长，根据光照垂直度动态扩展。
     * 光照越垂直，阴影投影面积越大，需要更大的正交范围。
     *
     * PCF/PCSS 滤波核会在阴影贴图边缘采样，因此需要足够的覆盖范围。
     * 用户可通过 shadowArea 参数在精度和覆盖范围之间平衡。
     */
    private updateShadowFrustum(): void {
        if (this.shadowConfig.autoFrustum) return;

        const dir = this.directionalLight.direction.normalize();
        const verticality = Math.abs(dir.y); // 垂直程度：1表示完全垂直

        // 基础范围由用户配置的 shadowArea 决定
        const base = this.shadowConfig.shadowArea;

        // 当光照接近垂直时，扩大正交投影范围以确保阴影完整
        const expansionFactor = 1 + verticality * 1.5;

        this.directionalLight.orthoTop = base * expansionFactor;
        this.directionalLight.orthoBottom = -base * expansionFactor;
        this.directionalLight.orthoLeft = -base * expansionFactor;
        this.directionalLight.orthoRight = base * expansionFactor;

        // 深度范围也需要相应扩大
        this.directionalLight.shadowMaxZ = base * 4 * expansionFactor;
        this.directionalLight.shadowMinZ = -base * 4 * expansionFactor;
    }

    /**
     * 通过欧拉角旋转方向光
     * @param angleX X轴旋转角度（弧度），null表示保持当前值
     * @param angleY Y轴旋转角度（弧度），null表示保持当前值
     * @param angleZ Z轴旋转角度（弧度），null表示保持当前值
     */
    public rotateDirectionalLight(angleX: number | null, angleY: number | null, angleZ: number | null): void {
        if (angleX !== null) {
            this.currentRotationX = angleX;
        }
        if (angleY !== null) {
            this.currentRotationY = angleY;
        }
        if (angleZ !== null) {
            this.currentRotationZ = angleZ;
        }

        const baseDirection = LightManager._TmpBaseDir.copyFrom(this.initialDirection);

        const rotatedX = this.rotateAroundAxisToRef(baseDirection, Vector3.Up(), this.currentRotationY, LightManager._TmpRotated1);
        const rotatedY = this.rotateAroundAxisToRef(rotatedX, Vector3.Right(), this.currentRotationX, LightManager._TmpRotated2);
        const finalDirection = this.rotateAroundAxisToRef(rotatedY, Vector3.Forward(), this.currentRotationZ, LightManager._TmpFinalDir);

        this.directionalLight.direction = finalDirection.normalize();
        this.config.directionalDirection = {
            x: finalDirection.x,
            y: finalDirection.y,
            z: finalDirection.z
        };

        this.updateShadowFrustum();
    }

    /**
     * 绕轴旋转向量，结果写入预分配向量
     */
    private rotateAroundAxisToRef(vector: Vector3, axis: Vector3, angle: number, result: Vector3): Vector3 {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const oneMinusCos = 1 - cos;

        const x = vector.x;
        const y = vector.y;
        const z = vector.z;

        const u = axis.x;
        const v = axis.y;
        const w = axis.z;

        result.set(
            (u * (u * x + v * y + w * z)) * oneMinusCos + x * cos + (v * z - w * y) * sin,
            (v * (u * x + v * y + w * z)) * oneMinusCos + y * cos + (w * x - u * z) * sin,
            (w * (u * x + v * y + w * z)) * oneMinusCos + z * cos + (u * y - v * x) * sin
        );

        return result;
    }

    /**
     * 获取当前光照配置
     * @returns 光照配置
     */
    public getConfig(): LightConfig {
        return { ...this.config };
    }

    /**
     * 释放资源
     */
    public dispose(): void {
        this.ambientLight.dispose();
        this.directionalLight.dispose();
    }
}
