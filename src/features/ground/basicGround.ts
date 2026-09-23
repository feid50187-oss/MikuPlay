
/**
 * Basic Ground Module - 基础地面模块
 * 
 * 主要功能:
 * - 创建基础地面网格，支持颜色和纹理
 * - 提供内置纹理选择（混凝土、标准、木材、粗糙木材）
 * - 支持自定义纹理导入
 * - 可调整纹理缩放、自发光强度等参数
 * - 内置纹理支持法线贴图增强视觉效果
 * 
 * 调用关系:
 * - 被 GroundSection 调用: 创建和管理基础地面
 * - 使用 Babylon.js MeshBuilder: 创建地面网格
 * - 使用 Babylon.js StandardMaterial: 设置材质属性
 * 
 * 内置纹理列表:
 * - Concrete: 混凝土地面
 * - Standard: 标准地面
 * - Wood: 木质地面
 * - Wood Rough: 粗糙木质地面
 */

import { Scene, MeshBuilder, StandardMaterial, Color3, Texture, Vector2, AbstractMesh, VertexBuffer, Material } from '@babylonjs/core';
import { RGBColorPicker } from '../../UIComponents/shared/RGBColorPicker';
import { Slider } from '../../UIComponents/shared/Slider';
import { SceneManager } from '../scene/SceneManager';

/** 内置纹理列表 */
const presetTextures = [
    { name: 'Concrete', path: 'texture/Ground/concrete/tex.png', normalPath: 'texture/Ground/concrete/normal.png' },
    { name: 'Standard', path: 'texture/Ground/standard/tex.png', normalPath: 'texture/Ground/standard/normal.png' },
    { name: 'Wood', path: 'texture/Ground/wood/tex.png', normalPath: 'texture/Ground/wood/normal.png' },
    { name: 'Wood Rough', path: 'texture/Ground/wood_rough/tex.png', normalPath: 'texture/Ground/wood_rough/normal.png' }
];

/**
 * 创建滑块元素（复用共享 Slider 组件，统一为 mp-slider 样式与交互）
 * @param label - 标签文本
 * @param initialValue - 初始值
 * @param min - 最小值
 * @param max - 最大值
 * @param step - 步长
 * @param onChange - 值变化回调
 * @returns 滑块容器元素
 */
function createSlider(
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

/**
 * 创建箭头图标
 * @returns SVG 箭头图标元素
 */
function createArrowIcon(): SVGSVGElement {
    const arrowIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrowIcon.setAttribute('class', 'world-collapsible-arrow');
    arrowIcon.setAttribute('viewBox', '0 0 24 24');
    arrowIcon.setAttribute('fill', 'none');
    arrowIcon.setAttribute('stroke', 'currentColor');
    arrowIcon.setAttribute('stroke-width', '2');
    arrowIcon.setAttribute('stroke-linecap', 'round');
    arrowIcon.setAttribute('stroke-linejoin', 'round');
    arrowIcon.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>';
    return arrowIcon;
}

/**
 * 地面尺寸与细分（边缘渐隐依赖足够顶点数生成平滑 alpha 衰减）。
 * 尺寸固定为天空球（PhotoDome size=1000，即直径 1000）的外接正方形边长：1000。
 */
const GROUND_SIZE = 1000;
const GROUND_SUBDIVISIONS = 32;

export class BasicGround {
    private groundMesh: AbstractMesh | null = null;
    private groundMaterial: StandardMaterial | null = null;
    private currentScene: Scene | null = null;
    private color = new Color3(0.5, 0.5, 0.5);
    private texturePath: string | null = null;
    private textureScale = 10;
    private emissiveIntensity = 0.5;  
    private normalIntensity = 5;
    private roughness = 0; // 0 光滑（现状）~ 1 粗糙（哑光）
    private edgeFade = 0; // 边缘渐隐强度 0（关闭）~ 1（最大范围），外圈按径向 alpha 衰减到 0，消除地平线接缝

    /**
     * 创建基础地面
     * @param scene - Babylon.js 场景
     * @param height - 地面高度位置
     */
    create(scene: Scene, height: number): void {
        this.dispose();
        this.currentScene = scene;

        this.groundMesh = MeshBuilder.CreateGround('basicGround', {
            width: GROUND_SIZE,
            height: GROUND_SIZE,
            subdivisions: GROUND_SUBDIVISIONS
        }, scene);

        this.groundMesh.position.y = height;

        this.groundMaterial = new StandardMaterial('basicGroundMat', scene);
        this.groundMaterial.specularColor = new Color3(0.8, 0.8, 0.8);
        this.groundMaterial.specularPower = 60;
        this.applyRoughness();

        this.applyMaterialSettings();

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
    }

    /**
     * 应用材质设置
     * 根据当前纹理路径和参数配置材质
     */
    private applyMaterialSettings(): void {
        if (!this.groundMaterial) return;

        // 先清除现有纹理
        if (this.groundMaterial.diffuseTexture) {
            this.groundMaterial.diffuseTexture.dispose();
            this.groundMaterial.diffuseTexture = null;
        }
        if (this.groundMaterial.emissiveTexture) {
            this.groundMaterial.emissiveTexture.dispose();
            this.groundMaterial.emissiveTexture = null;
        }
        if (this.groundMaterial.bumpTexture) {
            this.groundMaterial.bumpTexture.dispose();
            this.groundMaterial.bumpTexture = null;
        }

        // 如果有纹理，使用纹理，否则使用颜色
        if (this.texturePath) {
            try {
                const texture = new Texture(this.texturePath, this.currentScene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
                // 统一使用重复模式
                texture.wrapU = Texture.WRAP_ADDRESSMODE;
                texture.wrapV = Texture.WRAP_ADDRESSMODE;
                // 设置纹理缩放
                texture.uScale = this.textureScale;
                texture.vScale = this.textureScale;
                this.groundMaterial.diffuseTexture = texture;
                // 注意：不设置 emissiveTexture（否则会完全覆盖阴影）
                // 使用与无纹理时相同的自发光计算公式，确保初始强度与滑块值1时一致
                this.groundMaterial.emissiveColor.set(
                    this.color.r * this.emissiveIntensity,
                    this.color.g * this.emissiveIntensity,
                    this.color.b * this.emissiveIntensity
                );

                // 检查是否是内置纹理，如果是则尝试加载法线贴图
                const preset = presetTextures.find(p => p.path === this.texturePath);
                if (preset && preset.normalPath) {
                    try {
                        const normalTexture = new Texture(preset.normalPath, this.currentScene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
                        normalTexture.wrapU = Texture.WRAP_ADDRESSMODE;
                        normalTexture.wrapV = Texture.WRAP_ADDRESSMODE;
                        normalTexture.uScale = this.textureScale;
                        normalTexture.vScale = this.textureScale;
                        // 设置为 normal map 模式（StandardMaterial 将 bumpTexture 当作 normal map 处理时，需要设置坐标模式）
                        normalTexture.coordinatesMode = Texture.SKYBOX_MODE;
                        // 设置法线强度
                        normalTexture.level = this.normalIntensity;
                        this.groundMaterial.bumpTexture = normalTexture;
                        // 反转法线方向（如果法线方向反了，可以调整这两个值）
                        this.groundMaterial.invertNormalMapX = true;
                        this.groundMaterial.invertNormalMapY = true;
                    } catch (e) {
                        console.warn('加载法线贴图失败:', e);
                    }
                }
            } catch (e) {
                console.error('加载纹理失败:', e);
                this.groundMaterial.diffuseColor = this.color;
                this.groundMaterial.emissiveColor.set(
                    this.color.r * this.emissiveIntensity,
                    this.color.g * this.emissiveIntensity,
                    this.color.b * this.emissiveIntensity
                );
            }
        } else {
            this.groundMaterial.diffuseColor = this.color;
            this.groundMaterial.emissiveColor.set(
                this.color.r * this.emissiveIntensity,
                this.color.g * this.emissiveIntensity,
                this.color.b * this.emissiveIntensity
            );
        }
    }

    /**
     * 释放地面资源
     */
    dispose(): void {
        if (this.groundMaterial) {
            if (this.groundMaterial.diffuseTexture) {
                this.groundMaterial.diffuseTexture.dispose();
            }
            if (this.groundMaterial.emissiveTexture) {
                this.groundMaterial.emissiveTexture.dispose();
            }
            if (this.groundMaterial.bumpTexture) {
                this.groundMaterial.bumpTexture.dispose();
            }
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

    /**
     * 设置地面高度
     * @param height - 高度值
     */
    setHeight(height: number): void {
        if (this.groundMesh) {
            this.groundMesh.position.y = height;
        }
    }

    /**
     * 设置地面颜色
     * @param r - 红色分量 (0-1)
     * @param g - 绿色分量 (0-1)
     * @param b - 蓝色分量 (0-1)
     */
    setColor(r: number, g: number, b: number): void {
        this.color = new Color3(r, g, b);
        if (!this.texturePath) {
            this.applyMaterialSettings();
        }
    }

    /**
     * 设置纹理路径
     * 内置纹理默认缩放为5，导入纹理默认缩放为1
     * @param path - 纹理路径，null 表示清除纹理
     */
    setTexturePath(path: string | null): void {
        this.texturePath = path;

        // 检查是否是内置纹理，如果是则默认缩放10，导入贴图默认缩放1
        if (path) {
            const isPresetTexture = presetTextures.some(preset => preset.path === path);
            this.textureScale = isPresetTexture ? 10 : 1;
        }

        this.applyMaterialSettings();
    }

    /**
     * 设置自发光强度
     * @param intensity - 强度值
     */
    setEmissiveIntensity(intensity: number): void {
        this.emissiveIntensity = intensity * 0.5;
        // 直接更新 emissiveColor，避免重建纹理
        if (this.groundMaterial) {
            this.groundMaterial.emissiveColor.set(
                this.color.r * this.emissiveIntensity,
                this.color.g * this.emissiveIntensity,
                this.color.b * this.emissiveIntensity
            );
        }
    }

    /**
     * 设置纹理缩放
     * @param value - 缩放值
     */
    setTextureScale(value: number): void {
        this.textureScale = value;
        // 直接更新纹理 scale，避免重建纹理
        if (this.groundMaterial) {
            const diffuseTexture = this.groundMaterial.diffuseTexture as Texture | null;
            const bumpTexture = this.groundMaterial.bumpTexture as Texture | null;
            if (diffuseTexture) {
                diffuseTexture.uScale = value;
                diffuseTexture.vScale = value;
            }
            if (bumpTexture) {
                bumpTexture.uScale = value;
                bumpTexture.vScale = value;
            }
        }
    }

    /**
     * 设置粗糙度（StandardMaterial 通过高光参数近似表达）
     * @param value - 0（光滑）~ 1（粗糙/哑光）
     */
    setRoughness(value: number): void {
        this.roughness = Math.max(0, Math.min(1, value));
        this.applyRoughness();
    }

    /** 按当前粗糙度更新高光参数：specularPower 60→1（高光变弥散），specularColor 0.8→0（高光渐弱） */
    private applyRoughness(): void {
        if (!this.groundMaterial) return;
        const r = this.roughness;
        this.groundMaterial.specularPower = 60 - 59 * r;
        const s = 0.8 * (1 - r);
        this.groundMaterial.specularColor.set(s, s, s);
    }

    /**
     * 应用边缘渐隐：按顶点到中心的归一化距离设置 Color4 顶点色 alpha，
     * 外圈半径 (1-edgeFade)~1 范围内 alpha 从 1 平滑衰减到 0，
     * 使用 smoothstep 曲线消除线性衰减产生的可见分界线（白边）。
     * 顶点色 RGB=1 不影响材质颜色。
     */
    private applyEdgeFade(): void {
        if (!this.groundMesh) return;
        const seg = GROUND_SUBDIVISIONS;
        const vertCount = (seg + 1) * (seg + 1);
        const colors = new Float32Array(vertCount * 4);
        const half = GROUND_SIZE / 2;
        const fadeStart = 1 - this.edgeFade; // edgeFade=0 → fadeStart=1（不衰减）
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
        // edgeFade=0 时所有顶点 alpha 为 1，透明混合下视觉与不透明完全一致，无副作用。
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
     * 获取内置纹理列表
     * @returns 内置纹理配置数组
     */
    getPresetTextures() {
        return presetTextures;
    }

    /**
     * 创建私有参数控制面板
     * @returns 参数控制容器元素
     */
    createPrivateParams(): HTMLElement {
        const self = this;
        const container = document.createElement('div');
        container.className = 'world-ground-private-params';

        // 保存滑块元素引用，以便后续更新
        let textureScaleSliderElement: Slider | null = null;

        // --- 内部辅助函数 ---

        /**
         * 应用纹理
         * @param path - 纹理路径
         * @param previewContainer - 预览容器
         * @param previewPlaceholder - 预览占位符
         */
        const applyTexture = (
            path: string,
            previewContainer: HTMLElement,
            previewPlaceholder: HTMLElement
        ): void => {
            self.setTexturePath(path);

            // 更新预览
            previewPlaceholder.style.display = 'none';
            let existingImg = previewContainer.querySelector('img');
            if (!existingImg) {
                existingImg = document.createElement('img');
                existingImg.style.width = '100%';
                existingImg.style.height = '100%';
                existingImg.style.objectFit = 'cover';
                existingImg.style.borderRadius = 'inherit';
                previewContainer.appendChild(existingImg);
            }
            (existingImg as HTMLImageElement).src = path;

            // 更新纹理缩放滑块
            textureScaleSliderElement?.setValue(self.textureScale);
        };

        /**
         * 清除纹理
         * @param previewContainer - 预览容器
         * @param previewPlaceholder - 预览占位符
         */
        const clearTexture = (
            previewContainer: HTMLElement,
            previewPlaceholder: HTMLElement
        ): void => {
            self.setTexturePath(null);

            // 更新预览
            previewPlaceholder.style.display = 'block';
            const existingImg = previewContainer.querySelector('img');
            if (existingImg) {
                existingImg.remove();
            }
        };

        /**
         * 处理纹理导入
         * @param previewContainer - 预览容器
         * @param previewPlaceholder - 预览占位符
         * @param overlay - 遮罩层元素
         */
        const handleImportTexture = (
            previewContainer: HTMLElement,
            previewPlaceholder: HTMLElement,
            overlay: HTMLElement
        ): void => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.addEventListener('change', (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) {
                    const url = URL.createObjectURL(file);
                    applyTexture(url, previewContainer, previewPlaceholder);
                    document.body.removeChild(overlay);
                }
            });
            input.click();
        };

        /**
         * 显示纹理选择器弹窗
         * @param previewContainer - 预览容器
         * @param previewPlaceholder - 预览占位符
         */
        const showTextureSelector = (
            previewContainer: HTMLElement,
            previewPlaceholder: HTMLElement
        ): void => {
            // 创建遮罩层
            const overlay = document.createElement('div');
            overlay.className = 'world-envmap-selector-overlay';

            // 创建弹窗容器
            const dialog = document.createElement('div');
            dialog.className = 'world-envmap-selector-dialog';

            // 标题
            const title = document.createElement('div');
            title.className = 'world-envmap-selector-title';
            title.textContent = '选择纹理';

            // 纹理列表容器
            const listContainer = document.createElement('div');
            listContainer.className = 'world-envmap-selector-list';

            // 渲染预置纹理列表
            presetTextures.forEach((preset) => {
                const item = document.createElement('div');
                item.className = 'world-envmap-selector-item';

                // 缩略图
                const thumbnail = document.createElement('div');
                thumbnail.className = 'world-envmap-selector-thumbnail';

                const img = document.createElement('img');
                img.src = preset.path;
                img.alt = preset.name;
                img.onerror = () => {
                    // 加载失败显示占位符
                    thumbnail.textContent = preset.name;
                };
                thumbnail.appendChild(img);

                // 名称
                const name = document.createElement('div');
                name.className = 'world-envmap-selector-name';
                name.textContent = preset.name;

                item.appendChild(thumbnail);
                item.appendChild(name);

                // 点击选择
                item.addEventListener('click', () => {
                    applyTexture(preset.path, previewContainer, previewPlaceholder);
                    document.body.removeChild(overlay);
                });

                listContainer.appendChild(item);
            });

            // 按钮容器
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'world-envmap-selector-buttons';

            // 导入按钮
            const importBtn = document.createElement('button');
            importBtn.className = 'world-envmap-selector-import';
            importBtn.textContent = '导入';
            importBtn.addEventListener('click', () => {
                handleImportTexture(previewContainer, previewPlaceholder, overlay);
            });

            // 清除按钮
            const clearBtn = document.createElement('button');
            clearBtn.className = 'world-envmap-selector-import';
            clearBtn.textContent = '清除';
            clearBtn.style.backgroundColor = 'red';
            clearBtn.addEventListener('click', () => {
                clearTexture(previewContainer, previewPlaceholder);
                document.body.removeChild(overlay);
            });

            // 关闭按钮
            const closeBtn = document.createElement('button');
            closeBtn.className = 'world-envmap-selector-close';
            closeBtn.textContent = '取消';
            closeBtn.addEventListener('click', () => {
                document.body.removeChild(overlay);
            });

            buttonContainer.appendChild(importBtn);
            buttonContainer.appendChild(clearBtn);
            buttonContainer.appendChild(closeBtn);

            // 组装弹窗
            dialog.appendChild(title);
            dialog.appendChild(listContainer);
            dialog.appendChild(buttonContainer);
            overlay.appendChild(dialog);

            // 点击遮罩关闭
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    document.body.removeChild(overlay);
                }
            });

            document.body.appendChild(overlay);
        };

        // --- UI 构建 ---

        // 颜色选择器 - 使用 mp-rgb-picker
        const colorPicker = new RGBColorPicker({
            label: '颜色',
            mode: 'popup',
            color: { r: this.color.r, g: this.color.g, b: this.color.b }
        });
        colorPicker.onChange((newColor) => {
            this.setColor(newColor.r, newColor.g, newColor.b);
        });
        container.appendChild(colorPicker.element);

        // 纹理选择器
        const textureItem = document.createElement('div');
        textureItem.className = 'world-color-item';

        const textureLabel = document.createElement('span');
        textureLabel.className = 'world-color-label';
        textureLabel.textContent = '纹理';

        const texturePreview = document.createElement('div');
        texturePreview.className = 'world-color-preview';
        texturePreview.style.display = 'flex';
        texturePreview.style.alignItems = 'center';
        texturePreview.style.justifyContent = 'center';

        // 初始状态显示占位符
        const texturePreviewPlaceholder = document.createElement('div');
        texturePreviewPlaceholder.style.fontSize = '12px';
        texturePreviewPlaceholder.style.color = '#999';
        texturePreviewPlaceholder.textContent = '无纹理';
        texturePreview.appendChild(texturePreviewPlaceholder);

        if (this.texturePath) {
            texturePreviewPlaceholder.style.display = 'none';
            const previewImg = document.createElement('img');
            previewImg.style.width = '100%';
            previewImg.style.height = '100%';
            previewImg.style.objectFit = 'cover';
            previewImg.style.borderRadius = 'inherit';
            previewImg.src = this.texturePath;
            texturePreview.appendChild(previewImg);
        }

        textureItem.appendChild(textureLabel);
        textureItem.appendChild(texturePreview);

        container.appendChild(textureItem);

        // 点击预览显示纹理选择弹窗
        texturePreview.addEventListener('click', (e) => {
            e.stopPropagation();
            showTextureSelector(texturePreview, texturePreviewPlaceholder);
        });

        // 创建纹理缩放滑块并保存引用
        const textureScaleSlider = new Slider({
            label: '纹理缩放',
            min: 1,
            max: 100,
            step: 1,
            value: this.textureScale
        });
        textureScaleSliderElement = textureScaleSlider;
        textureScaleSlider.onChange((value) => this.setTextureScale(value));
        container.appendChild(textureScaleSlider.element);

        // 自发光强度
        container.appendChild(createSlider('自发光强度', this.emissiveIntensity, 0, 2, 0.01, (value) => this.setEmissiveIntensity(value)));

        // 粗糙度（0 光滑 ~ 1 粗糙）
        container.appendChild(createSlider('粗糙度', this.roughness, 0, 1, 0.01, (value) => this.setRoughness(value)));

        // 边缘渐隐（0 关闭 ~ 1 最大范围，外圈 alpha 衰减融入背景）
        container.appendChild(createSlider('边缘渐隐', this.edgeFade, 0, 1, 0.01, (value) => this.setEdgeFade(value)));

        return container;
    }
}
