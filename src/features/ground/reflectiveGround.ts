
/**
 * Reflective Ground Module - 反射地面模块
 * 
 * 主要功能:
 * - 创建具有实时反射效果的地面
 * - 使用 Babylon.js MirrorTexture 实现镜面反射
 * - 自动将场景中的网格添加到反射渲染列表
 * - 支持调整反射强度和模糊效果
 * 
 * 调用关系:
 * - 被 GroundSection 调用: 创建和管理反射地面
 * - 使用 Babylon.js MeshBuilder: 创建地面网格
 * - 使用 Babylon.js MirrorTexture: 实现反射效果
 * - 监听 scene.onNewMeshAddedObservable: 自动更新反射列表
 * 
 * 技术细节:
 * - 反射纹理分辨率: 1024x1024
 * - 使用自适应模糊内核: 0-128
 * - 反射平面: Y轴向下
 */

import { Scene, MeshBuilder, StandardMaterial, MirrorTexture, Color3, Plane, AbstractMesh, Camera, Matrix, VertexBuffer, Material } from '@babylonjs/core';
import { SceneManager } from '../scene/SceneManager';
import { Slider } from '../../UIComponents/shared/Slider';

/**
 * 地面尺寸与细分（边缘渐隐依赖足够顶点数生成平滑 alpha 衰减）。
 * 尺寸固定为天空球（PhotoDome size=1000，即直径 1000）的外接正方形边长：1000。
 */
const GROUND_SIZE = 1000;
const GROUND_SUBDIVISIONS = 32;

export class ReflectiveGround {
    private groundMesh: AbstractMesh | null = null;
    private groundMaterial: StandardMaterial | null = null;
    private mirrorTexture: MirrorTexture | null = null;
    private currentScene: Scene | null = null;
    private reflectionLevel = 0.8;
    private blurKernel = 0;
    private edgeFade = 0; // 边缘渐隐强度 0（关闭）~ 1（最大范围），外圈按径向 alpha 衰减到 0，消除地平线接缝
    private meshAddedObserver: ((mesh: AbstractMesh) => void) | null = null;
    private mirrorBeforeRenderObserver: (() => void) | null = null;
    private mirrorAfterRenderObserver: (() => void) | null = null;

    /**
     * 创建反射地面
     * @param scene - Babylon.js 场景
     * @param height - 地面高度位置
     */
    create(scene: Scene, height: number): void {
        this.dispose();
        this.currentScene = scene;

        this.groundMesh = MeshBuilder.CreateGround('reflectiveGround', {
            width: GROUND_SIZE,
            height: GROUND_SIZE,
            subdivisions: GROUND_SUBDIVISIONS
        }, scene);

        this.groundMesh.position.y = height;

        this.groundMaterial = new StandardMaterial('reflectiveGroundMat', scene);

        // 创建镜面反射纹理
        this.mirrorTexture = new MirrorTexture('mirrorTexture', 1024, scene, true);
        this.mirrorTexture.mirrorPlane = new Plane(0, -1.0, 0, height);
        this.mirrorTexture.level = this.reflectionLevel;
        this.mirrorTexture.adaptiveBlurKernel = this.blurKernel;

        // 离屏渲染修复：MirrorTexture 是 1024x1024 方形纹理，且 Babylon 内部硬编码
        // doNotChangeAspectRatio=true，导致镜像按活动相机（离屏渲染时被改成输出分辨率比例）
        // 的投影渲染进方形纹理，反射被水平拉伸。这里在镜像渲染前临时把投影强制为 1:1 方形，
        // 渲染后恢复，仅在线模式（camera.outputRenderTarget 非空）下生效，不影响实时预览。
        this.mirrorBeforeRenderObserver = () => {
            const scene = this.currentScene;
            const camera = scene?.activeCamera;
            if (!scene || !camera || !camera.outputRenderTarget || !this.mirrorTexture) return;
            // 正确 aspect = 分辨率宽 / 分辨率高。离线渲染时活动相机的宽高比已被改为输出分辨率比例，
            // 这里直接用渲染目标的分辨率计算，随分辨率变化自动适配。
            const rtw = camera.outputRenderTarget;
            const renderWidth = rtw.getRenderWidth();
            const renderHeight = rtw.getRenderHeight();
            if (!renderWidth || !renderHeight) return;
            const mirrorAspect = renderWidth / renderHeight;
            const engine = scene.getEngine();
            const maxZ = camera.maxZ;
            const minZ = camera.minZ <= 0 ? 0.1 : camera.minZ;
            const reverseDepth = engine.useReverseDepthBuffer;
            const squareProj = new Matrix();
            if (scene.useRightHandedSystem) {
                Matrix.PerspectiveFovRHToRef(camera.fov, mirrorAspect, reverseDepth ? maxZ : minZ, reverseDepth ? minZ : maxZ, squareProj,
                    camera.fovMode === Camera.FOVMODE_VERTICAL_FIXED, engine.isNDCHalfZRange, camera.projectionPlaneTilt, reverseDepth);
            } else {
                Matrix.PerspectiveFovLHToRef(camera.fov, mirrorAspect, reverseDepth ? maxZ : minZ, reverseDepth ? minZ : maxZ, squareProj,
                    camera.fovMode === Camera.FOVMODE_VERTICAL_FIXED, engine.isNDCHalfZRange, camera.projectionPlaneTilt, reverseDepth);
            }
            scene.setTransformMatrix(scene.getViewMatrix(), squareProj);
        };
        this.mirrorAfterRenderObserver = () => {
            const scene = this.currentScene;
            const camera = scene?.activeCamera;
            if (!scene || !camera) return;
            // 恢复活动相机的正常（非方形）投影，避免影响主场景渲染
            scene.setTransformMatrix(camera.getViewMatrix(), camera.getProjectionMatrix());
        };
        this.mirrorTexture.onBeforeRenderObservable.add(this.mirrorBeforeRenderObserver);
        this.mirrorTexture.onAfterRenderObservable.add(this.mirrorAfterRenderObserver);

        this.updateRenderList();

        this.groundMaterial.reflectionTexture = this.mirrorTexture;
        this.groundMaterial.diffuseColor = new Color3(0.2, 0.2, 0.2);
        this.groundMaterial.specularColor = new Color3(0.5, 0.5, 0.5);
        this.groundMaterial.alpha = 0.95;

        // 顶点色径向 alpha 渐隐（消除地平线接缝）
        this.groundMesh.useVertexColors = true;
        this.applyEdgeFade();

        this.groundMesh.material = this.groundMaterial;
        this.groundMesh.isPickable = false;

        // 通过 lightManager 注册阴影接收体以统一管理
        const lightManager = SceneManager.getLightManager(scene);
        if (lightManager?.registerShadowReceiver) {
            lightManager.registerShadowReceiver(this.groundMesh);
        } else {
            this.groundMesh.receiveShadows = true;
        }

        // 监听新网格添加事件，自动更新反射列表
        this.meshAddedObserver = (mesh: AbstractMesh) => {
            if (mesh !== this.groundMesh && this.mirrorTexture) {
                this.mirrorTexture.renderList?.push(mesh);
            }
        };
        scene.onNewMeshAddedObservable.add(this.meshAddedObserver);
    }

    /**
     * 更新反射渲染列表
     * 将所有非地面网格添加到反射渲染列表
     */
    private updateRenderList(): void {
        if (!this.mirrorTexture || !this.currentScene) return;
        // 直接操作 renderList 数组，避免 filter 创建新数组
        const renderList = this.mirrorTexture.renderList;
        if (renderList) {
            renderList.length = 0; // 清空数组
            const meshes = this.currentScene.meshes;
            for (let i = 0; i < meshes.length; i++) {
                const mesh = meshes[i];
                if (mesh !== this.groundMesh) {
                    renderList.push(mesh);
                }
            }
        } else {
            // 如果 renderList 不存在，创建新数组
            const meshes = this.currentScene.meshes;
            const newRenderList: AbstractMesh[] = [];
            for (let i = 0; i < meshes.length; i++) {
                const mesh = meshes[i];
                if (mesh !== this.groundMesh) {
                    newRenderList.push(mesh);
                }
            }
            this.mirrorTexture.renderList = newRenderList;
        }
    }

    /**
     * 释放反射地面资源
     */
    dispose(): void {
        if (this.currentScene && this.meshAddedObserver) {
            this.currentScene.onNewMeshAddedObservable.removeCallback(this.meshAddedObserver);
            this.meshAddedObserver = null;
        }
        if (this.mirrorTexture) {
            if (this.mirrorBeforeRenderObserver) {
                this.mirrorTexture.onBeforeRenderObservable.removeCallback(this.mirrorBeforeRenderObserver);
                this.mirrorBeforeRenderObserver = null;
            }
            if (this.mirrorAfterRenderObserver) {
                this.mirrorTexture.onAfterRenderObservable.removeCallback(this.mirrorAfterRenderObserver);
                this.mirrorAfterRenderObserver = null;
            }
            this.mirrorTexture.renderList = [];
            this.mirrorTexture.dispose();
            this.mirrorTexture = null;
        }
        if (this.groundMaterial) {
            this.groundMaterial.dispose();
            this.groundMaterial = null;
        }
        if (this.groundMesh) {
            this.groundMesh.dispose();
            this.groundMesh = null;
        }
        this.currentScene = null;
    }

    /**
     * 设置地面缩放
     * @param scale - 缩放比例
     */
    setScale(scale: number): void {
        if (this.groundMesh) {
            this.groundMesh.scaling.x = scale;
            this.groundMesh.scaling.z = scale;
        }
    }

    /** 预分配反射平面，避免每次创建新对象 */
    private mirrorPlane: Plane = new Plane(0, -1.0, 0, 0);

    /**
     * 设置地面高度
     * 同时更新反射平面位置
     * @param height - 高度值
     */
    setHeight(height: number): void {
        if (this.groundMesh) {
            this.groundMesh.position.y = height;
        }
        if (this.mirrorTexture) {
            this.mirrorPlane.normal.set(0, -1.0, 0);
            this.mirrorPlane.d = height;
            this.mirrorTexture.mirrorPlane = this.mirrorPlane;
        }
    }

    /**
     * 设置反射强度
     * @param level - 反射强度值 (0-1)
     */
    setReflectionLevel(level: number): void {
        this.reflectionLevel = level;
        if (this.mirrorTexture) {
            this.mirrorTexture.level = level;
        }
    }

    /**
     * 设置模糊核大小
     * @param kernel - 模糊核大小值 (0-64)
     */
    setBlurKernel(kernel: number): void {
        this.blurKernel = kernel;
        if (this.mirrorTexture) {
            this.mirrorTexture.adaptiveBlurKernel = kernel;
        }
    }

    /**
     * 应用边缘渐隐：按顶点到中心的归一化距离设置 Color4 顶点色 alpha，
     * 外圈半径 (1-edgeFade)~1 范围内 alpha 从 1 平滑衰减到 0，
     * 使用 smoothstep 曲线消除线性衰减产生的可见分界线（白边）。
     * 顶点色 RGB=1 不影响材质颜色。
     * 与材质自身的 alpha（0.95）叠加：中心 0.95，边缘 0。
     */
    private applyEdgeFade(): void {
        if (!this.groundMesh) return;
        const seg = GROUND_SUBDIVISIONS;
        const vertCount = (seg + 1) * (seg + 1);
        const colors = new Float32Array(vertCount * 4);
        const half = GROUND_SIZE / 2;
        const fadeStart = 1 - this.edgeFade;
        const step = GROUND_SIZE / seg;
        for (let z = 0; z <= seg; z++) {
            for (let x = 0; x <= seg; x++) {
                const px = x * step - half;
                const pz = z * step - half;
                // 切比雪夫距离（max 分量）归一化：边中点 t=1 也完全衰减，
                // 避免欧几里得归一化时边中段 t≈0.707 衰减不足导致地平线硬边
                const t = Math.max(Math.abs(px), Math.abs(pz)) / half;
                let alpha = 1;
                // edgeFade=0 → fadeStart=1，t 恒 ≤1，永不衰减
                if (t > fadeStart) {
                    // smoothstep 替代线性：消除过渡区"白线"伪影
                    const s = Math.min(1, (t - fadeStart) / (1 - fadeStart));
                    alpha = 1 - s * s * (3 - 2 * s);
                }
                const idx = (z * (seg + 1) + x) * 4;
                colors[idx] = 1;
                colors[idx + 1] = 1;
                colors[idx + 2] = 1;
                colors[idx + 3] = alpha;
            }
        }
        // 关键修复：必须从网格【首次绑定】就启用顶点 alpha 与透明混合，shader 才会编译进
        // VERTEXALPHA / ALPHABLEND 分支。此前按 edgeFade 动态启用会在运行期才切
        // hasVertexAlpha/transparencyMode，常因 shader define 缓存未刷新而根本不生效，
        // 结果地面始终不透明、边缘是硬边。
        // edgeFade=0 时所有顶点 alpha 为 1，透明混合（叠加材质的 0.95）下视觉与不透明完全一致。
        this.groundMesh.setVerticesData(VertexBuffer.ColorKind, colors, true);
        this.groundMesh.hasVertexAlpha = true;
        if (this.groundMaterial) {
            this.groundMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
        }
    }

    /**
     * 设置边缘渐隐强度
     * @param value 0（关闭）~ 1（最大范围渐隐）
     */
    setEdgeFade(value: number): void {
        this.edgeFade = Math.max(0, Math.min(1, value));
        this.applyEdgeFade();
    }

    /**
     * 创建私有参数控制面板
     * @returns 参数控制容器元素
     */
    createPrivateParams(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'world-ground-private-params';

        // 反射强度滑块
        const reflectionSlider = new Slider({
            label: '反射强度',
            min: 0,
            max: 1,
            step: 0.01,
            value: this.reflectionLevel
        });
        reflectionSlider.onChange((value) => this.setReflectionLevel(value));
        container.appendChild(reflectionSlider.element);

        // 模糊核大小滑块
        const blurSlider = new Slider({
            label: '模糊核大小',
            min: 0,
            max: 128,
            step: 1,
            value: this.blurKernel
        });
        blurSlider.onChange((value) => this.setBlurKernel(value));
        container.appendChild(blurSlider.element);

        // 边缘渐隐（0 关闭 ~ 1 最大范围，外圈 alpha 衰减融入背景）
        const edgeFadeSlider = new Slider({
            label: '边缘渐隐',
            min: 0,
            max: 1,
            step: 0.01,
            value: this.edgeFade
        });
        edgeFadeSlider.onChange((value) => this.setEdgeFade(value));
        container.appendChild(edgeFadeSlider.element);

        return container;
    }
}
