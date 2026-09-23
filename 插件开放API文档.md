# MikuPlay Reburn 插件开放 API 文档

> 版本: V2.0
> 更新日期: 2026-09-22
> 适用: 插件开发者
> 基于源码验证 + 插件创作规范手册

---

## 目录

### 第一部分：插件运行环境
1. [插件上下文 PluginContext](#1-插件上下文-plugincontext)
2. [事件总线 EventBus](#2-事件总线-eventbus)
3. [插件隔离存储 PluginStorage](#3-插件隔离存储-pluginstorage)
4. [全局变量（黑名单模式）](#4-全局变量黑名单模式)

### 第二部分：宿主扩展对象 mp
5. [mp 总览](#5-mp-总览)
6. [mp.particlePresetRegistry](#6-mpparticlepresetregistry)
7. [mp.materialAdapterRegistry](#7-mpmaterialadapterregistry)
8. [mp.postProcessAdapterRegistry](#8-mppostprocessadapterregistry)
9. [mp.ui 共享 UI 组件](#9-mpui-共享-ui-组件)
10. [mp.file 安全文件保存](#10-mpfile-安全文件保存)
11. [mp.model 模型读取](#11-mpmodel-模型读取)

### 第三部分：核心子系统 API
12. [渲染器 API](#12-渲染器-api)
13. [相机 API](#13-相机-api)
14. [灯光与阴影 API](#14-灯光与阴影-api)
15. [物理引擎 API](#15-物理引擎-api)
16. [后处理 API](#16-后处理-api)
17. [模型与材质 API](#17-模型与材质-api)
18. [场景 API](#18-场景-api)
19. [动画 API](#19-动画-api)
20. [内容库 API](#20-内容库-api)
21. [工程存档 API](#21-工程存档-api)

### 第四部分：适配器接口规范
22. [IMaterialAdapter 材质适配器](#22-imaterialadapter-材质适配器)
23. [IPostProcessAdapter 后处理适配器](#23-ipostprocessadapter-后处理适配器)
24. [ControlDeclaration 控件声明](#24-controldeclaration-控件声明)

### 第五部分：Babylon.js 与安全
25. [BABYLON 可用类列表](#25-babylon-可用类列表)
26. [插件清单 PluginManifest](#26-插件清单-pluginmanifest)
27. [安全约束机制](#27-安全约束机制)

---

## 第一部分：插件运行环境

---

## 1. 插件上下文 PluginContext

每个插件在运行时通过 `context` 参数接收一个 `PluginContext` 对象，这是插件与宿主交互的核心入口。

```typescript
interface PluginContext {
    scene: Scene;           // Babylon.js 场景实例
    engine: Engine;         // Babylon.js 引擎实例
    eventBus: EventBus;     // 事件总线
    storage: PluginStorage; // 插件隔离存储
    assetsDir: string;      // 插件资源目录 URL（WebView 可访问）
    app: PluginAppContext;  // 应用级上下文
}
```

### PluginAppContext

```typescript
interface PluginAppContext {
    getScene(): Scene;                          // 获取场景
    getEngine(): Engine;                        // 获取引擎
    getAnimationManager(): AnimationManager | null;  // 获取动画管理器
    getMusicManager(): MusicManager | null;     // 获取音乐管理器
    getModelManager(): ModelManager | null;     // 获取模型管理器
}
```

---

## 2. 事件总线 EventBus

### 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `on` | `on<T>(event: string, handler: (...args: T) => void): () => void` | 订阅事件，返回取消订阅函数 |
| `emit` | `emit<T>(event: string, ...args: T): void` | 发布事件 |
| `removeAll` | `removeAll(event?: string): void` | 移除指定事件或所有事件的订阅 |

### 完整事件列表

#### 模型事件
| 事件名 | 说明 |
|--------|------|
| `model:loaded` | 模型加载完成 |
| `model:removed` | 模型被移除 |
| `model:selected` | 模型被选中 |
| `model:visibility_changed` | 模型可见性变更 |

#### 动画事件
| 事件名 | 说明 |
|--------|------|
| `animation:loaded` | 动画加载完成 |
| `animation:removed` | 动画被移除 |
| `animation:ended` | 动画播放结束 |
| `frame:updated` | 帧更新 |

#### 音乐事件
| 事件名 | 说明 |
|--------|------|
| `music:loaded` | 音乐加载完成 |
| `music:removed` | 音乐被移除 |
| `music:changed` | 音乐变更 |
| `music:list_changed` | 音乐列表变更 |
| `music:state_changed` | 播放状态变更 |
| `music:time_updated` | 播放时间更新 |

#### 相机动画事件
| 事件名 | 说明 |
|--------|------|
| `camera_animation:loaded` | 相机动画加载完成 |
| `camera_animation:removed` | 相机动画被移除 |

#### 地面事件
| 事件名 | 说明 |
|--------|------|
| `ground:type_changed` | 地面类型变更 |
| `ground:scale_changed` | 地面缩放变更 |
| `ground:height_changed` | 地面高度变更 |

#### 灯光事件
| 事件名 | 说明 |
|--------|------|
| `light:ambient_changed` | 环境光变更 |
| `light:directional_changed` | 方向光变更 |

#### 背景事件
| 事件名 | 说明 |
|--------|------|
| `background:type_changed` | 背景类型变更 |
| `background:color_changed` | 背景颜色变更 |

#### 粒子事件
| 事件名 | 说明 |
|--------|------|
| `particle:system_changed` | 粒子系统变更 |
| `particle:params_changed` | 粒子参数变更 |

#### 后处理/着色事件
| 事件名 | 说明 |
|--------|------|
| `postproc:changed` | 后处理参数变更 |
| `postproc:adapter_registered` | 后处理适配器注册 |
| `postproc:adapter_unregistered` | 后处理适配器注销 |
| `shading:material_changed` | 材质变更 |
| `shading:adapter_registered` | 材质适配器注册 |
| `shading:adapter_unregistered` | 材质适配器注销 |

#### 物理/纹理事件
| 事件名 | 说明 |
|--------|------|
| `physics:toggled` | 物理模拟开关 |
| `gravity:changed` | 重力变更 |
| `texture:downsample_toggled` | 纹理降采样开关 |

#### 面板/渲染/全屏事件
| 事件名 | 说明 |
|--------|------|
| `panel:opened` | 面板打开 |
| `panel:closed` | 面板关闭 |
| `render:started` | 渲染开始 |
| `render:finished` | 渲染完成 |
| `fullscreen:changed` | 全屏状态变更 |
| `theme:changed` | 主题变更 |

#### 插件事件
| 事件名 | 说明 |
|--------|------|
| `plugin:installed` | 插件安装完成 |
| `plugin:uninstalled` | 插件卸载完成 |
| `plugin:updated` | 插件更新完成 |
| `plugin:enabledChanged` | 插件启用状态变更 |

---

## 3. 插件隔离存储 PluginStorage

每个插件拥有独立的持久化键值对存储，基于 Capacitor Filesystem 实现。

| 方法 | 签名 | 说明 |
|------|------|------|
| `set` | `set(key: string, value: unknown): Promise<void>` | 写入值（JSON 序列化） |
| `get` | `get<T>(key: string): Promise<T \| undefined>` | 读取值（JSON 反序列化） |
| `remove` | `remove(key: string): Promise<void>` | 删除指定 key |
| `clear` | `clear(): Promise<void>` | 清空所有存储 |

---

## 4. 全局变量（黑名单模式）

插件代码通过 `new Function()` 在宿主 realm 中执行（非隔离沙箱），以下变量由宿主挂载到全局命名空间：

| 全局变量 | 说明 |
|---------|------|
| `context` | 插件运行上下文（PluginContext） |
| `BABYLON` | Babylon.js 精简 re-export 模块 |
| `mp` | 宿主扩展对象（白名单 API 面） |
| `console` | 控制台（浏览器原生 console） |
| `document` | DOM 文档对象 |
| `window` | 窗口对象（宿主原生） |
| `setTimeout` / `clearTimeout` | 定时器 |
| `setInterval` / `clearInterval` | 循环定时器 |
| `requestAnimationFrame` / `cancelAnimationFrame` | 帧动画 |

> **黑名单边界**：宿主不暴露 `@capacitor/filesystem` 等写文件能力，写文件只能走 `mp.file.save`。

---

## 第二部分：宿主扩展对象 mp

---

## 5. mp 总览

通过全局变量 `mp` 访问宿主提供的扩展功能：

| 模块 | 说明 |
|------|------|
| `mp.particlePresetRegistry` | 粒子预设注册表 |
| `mp.materialAdapterRegistry` | 材质适配器注册表 |
| `mp.postProcessAdapterRegistry` | 后处理适配器注册表 |
| `mp.ui` | 共享 UI 组件工厂 |
| `mp.file` | 安全文件保存桥 |
| `mp.model` | 模型读取便利层 |

---

## 6. mp.particlePresetRegistry

粒子预设注册表，用于查询和注册粒子预设。

| 方法 | 签名 | 说明 |
|------|------|------|
| `getAll()` | `getAll(): ParticlePresetConfig[]` | 获取所有预设 |
| `get(type)` | `get(type: string): ParticlePresetConfig \| undefined` | 按类型获取预设 |
| `register(config)` | `register(config: ParticlePresetConfig): void` | 注册自定义预设 |
| `getTypes()` | `getTypes(): { value: string; label: string }[]` | 获取所有预设类型 |
| `unregister(type)` | `unregister(type: string): void` | 注销预设 |

---

## 7. mp.materialAdapterRegistry

材质适配器注册表，用于查询和注册材质适配器。

| 方法 | 签名 | 说明 |
|------|------|------|
| `register(adapter)` | `register(adapter: IMaterialAdapter): void` | 注册适配器 |
| `unregister(typeId)` | `unregister(typeId: string): void` | 注销适配器 |
| `get(typeId)` | `get(typeId: string): IMaterialAdapter \| undefined` | 按类型 ID 获取适配器 |
| `findAdapter(material)` | `findAdapter(material: Material): IMaterialAdapter \| undefined` | 根据材质实例自动查找适配器 |
| `getAll()` | `getAll(): IMaterialAdapter[]` | 获取所有适配器 |
| `hasMaterialCreatingAdapters()` | `hasMaterialCreatingAdapters(): boolean` | 是否存在 createsMaterial=true 的适配器 |
| `getMaterialCreatingAdapters()` | `getMaterialCreatingAdapters(): IMaterialAdapter[]` | 获取所有 createsMaterial=true 的适配器 |

---

## 8. mp.postProcessAdapterRegistry

后处理适配器注册表，用于查询和注册后处理适配器。

| 方法 | 签名 | 说明 |
|------|------|------|
| `register(adapter)` | `register(adapter: IPostProcessAdapter): void` | 注册适配器 |
| `unregister(typeId)` | `unregister(typeId: string): void` | 注销适配器 |
| `get(typeId)` | `get(typeId: string): IPostProcessAdapter \| undefined` | 按类型 ID 获取适配器 |
| `getAll()` | `getAll(): IPostProcessAdapter[]` | 获取所有适配器（按 order 升序） |
| `hasAdapters()` | `hasAdapters(): boolean` | 是否存在已注册适配器 |

---

## 9. mp.ui 共享 UI 组件

宿主提供的共享 UI 组件工厂，插件可用于创建与主应用风格一致的 UI 元素。

### 组件列表

| 属性 | 类型 | 说明 |
|------|------|------|
| `mp.ui.Slider` | `class` | 滑块组件构造函数 |
| `mp.ui.ToggleSwitch` | `class` | 开关组件构造函数 |
| `mp.ui.Dropdown` | `class` | 下拉选择组件构造函数 |
| `mp.ui.RGBColorPicker` | `class` | RGB 颜色选择器组件构造函数 |
| `mp.ui.VectorInput` | `class` | 向量输入组件构造函数 |
| `mp.ui.CollapsibleSection` | `class` | 折叠区域组件构造函数 |
| `mp.ui.toast` | `object` | Toast 消息服务单例 |
| `mp.ui.showConfirmDialog` | `function` | 确认对话框函数 |
| `mp.ui.icons` | `object` | SVG 图标对象集合 |

### 使用示例

```javascript
// Slider
var slider = new mp.ui.Slider({
    label: '强度',
    min: 0, max: 1, step: 0.01, value: 0.5
});
slider.onChange(function(value) { console.log(value); });
container.appendChild(slider.element);

// ToggleSwitch
var toggle = new mp.ui.ToggleSwitch({
    label: '启用',
    initialState: true
});
toggle.onChange(function(enabled) { console.log(enabled); });
container.appendChild(toggle.element);

// Dropdown
var dropdown = new mp.ui.Dropdown({
    label: '选项',
    options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    selectedValue: 'a'
});
dropdown.onChange(function(value) { console.log(value); });
container.appendChild(dropdown.element);

// CollapsibleSection
var section = new mp.ui.CollapsibleSection({
    title: '分组标题',
    initiallyExpanded: true
});
var content = section.getContentContainer();
content.appendChild(slider.element);
container.appendChild(section.element);

// RGBColorPicker
var picker = new mp.ui.RGBColorPicker({
    label: '颜色',
    color: { r: 1, g: 0, b: 0 },
    mode: 'inline'
});
picker.onChange(function(color) { console.log(color); });
container.appendChild(picker.element);

// Toast
mp.ui.toast.success('操作成功', 2000);
mp.ui.toast.error('出错了');
var loading = mp.ui.toast.loading('处理中...');
loading.dismiss();

// Confirm Dialog
mp.ui.showConfirmDialog({
    title: '确认',
    message: '确定要执行此操作吗？',
    confirmText: '确认',
    cancelText: '取消',
    danger: false
}).then(function(confirmed) {
    if (confirmed) { /* ... */ }
});
```

### 组件通用约定
- 所有组件均为 **配置对象构造**（`new mp.ui.Xxx(config)`）
- 通过 `component.element`（HTMLElement 属性）获取 DOM
- `onChange(callback)` 返回取消订阅函数
- 组件需在 `dispose()` 时调用 `component.dispose()` 释放监听器

---

## 10. mp.file 安全文件保存

宿主提供的**安全文件保存桥**。插件无文件系统权限，仅能发起保存请求；宿主先弹窗询问，用户同意后由宿主以"只新增、绝不覆盖/修改/删除"的安全方式写入外部共享存储的 `MikuPlay/PluginOutput/<插件ID>/` 目录。

| 属性 | 类型 | 说明 |
|------|------|------|
| `mp.file.save` | `function` | 请求保存文件 |

### 入参 PluginFileSaveOptions

| 字段 | 类型 | 说明 |
|------|------|------|
| `data` | `Blob \| string` | 文件内容（与 dataProducer 二选一） |
| `dataProducer` | `() => Blob \| string \| Promise<...>` | 惰性数据生成器（与 data 二选一） |
| `filename` | `string` | 建议文件名 |
| `mime` | `string` | MIME 类型 |

### 返回值 PluginFileSaveResult

| 字段 | 类型 | 说明 |
|------|------|------|
| `ok` | `boolean` | 是否保存成功 |
| `canceled` | `boolean` | 用户拒绝保存时为 true |
| `path` | `string` | 保存后的相对路径 |
| `uri` | `string` | 可访问的 URI |
| `filename` | `string` | 实际落盘的文件名 |
| `reason` | `string` | 失败原因 |

> **安全说明**：
> - 插件只能**新增**文件，无法覆盖/修改/删除已有文件
> - 文件写入仅限定在 `MikuPlay/PluginOutput/<插件ID>/` 下
> - 同名冲突时宿主自动追加 `_1`、`_2`… 序号

---

## 11. mp.model 模型读取

宿主提供的**模型读取便利层**。返回真实的 `ModelInfo`（含 mesh/container 引用）。

| 方法 | 签名 | 说明 |
|------|------|------|
| `list` | `list(): ModelInfo[]` | 返回当前全部模型 |
| `get` | `get(id: string): ModelInfo \| undefined` | 按 ModelId 查询单个模型 |
| `count` | `count(): number` | 当前模型数量 |
| `onChanged` | `onChanged(cb: (model: ModelInfo, added: boolean) => void): () => void` | 订阅模型增删 |

### ModelInfo 数据类型

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 模型唯一标识 |
| `name` | `string` | 模型名称 |
| `filePath` | `string` | 模型文件路径 |
| `fileType` | `'pmx' \| 'pmd' \| 'bpmx'` | MMD 模型文件类型 |
| `mesh` | `AbstractMesh \| null` | 模型根网格 |
| `container` | `AssetContainer \| null` | 模型资源容器 |

> **说明**：该 API 仅提供"读取 + 订阅"，不包含导入/删除方法。

---

## 第三部分：核心子系统 API

---

## 12. 骨骼操作 API

### BoneApiService

```typescript
import { boneApiService } from './features/mmd/BoneApiService';

// 获取骨骼
const bone = boneApiService.getBone(modelId, '头部');

// 骨骼变换
boneApiService.applyTranslation(modelId, '头部', 'x', 0.5);
boneApiService.applyRotation(modelId, '头部', 'y', 30);
boneApiService.applyScale(modelId, '头部', 'z', 1.2);

// 应用/恢复/重置
boneApiService.applyCurrentTransform();
boneApiService.restoreTransform(modelId, '头部');
boneApiService.resetTransform(modelId, '头部');

// 缩放传播
boneApiService.setPropagateScaleToChildren(modelId, true);
boneApiService.getPropagateScaleToChildren(modelId);
```

---

## 13. 表情/变形 API

### 13.1 MorphApiService 接口

### MorphApiService

```typescript
import { morphApiService } from './features/mmd/MorphApiService';

// 获取 morph 列表
const morphs = morphApiService.getMorphList(model);

// 设置 morph 权重（自动 clamp 0-1）
morphApiService.setMorphWeight(model, '微笑', 0.8);

// 获取 morph 权重
const weight = morphApiService.getMorphWeight(model, '微笑');

// 批量设置
morphApiService.setMorphWeights(model, {
    '微笑': 0.8,
    '眨眼': 0.3
});

// 重置所有 morph
morphApiService.resetAllMorphs(model);
```

---

## 14. 渲染器 API

### 12.1 RenderManager（实时渲染）

```typescript
const renderManager = RenderManager.getInstance();

renderManager.initialize(animationManager, sceneManager, cameraManager);

// 事件回调
renderManager.onStartRender((settings) => { ... });
renderManager.onRenderComplete((outputPath) => { ... });
renderManager.onRenderError((error) => { ... });

// 打开/关闭渲染窗口
await renderManager.open();
await renderManager.close();
await renderManager.toggle();
renderManager.isOpened();
```

### 12.2 OfflineRenderManager（离线渲染）

```typescript
const offlineRender = new OfflineRenderManager();

await offlineRender.startRender({
    renderMode: 'video' | 'frame',
    fps: 30,
    quality: 'high'
});
```

---

## 15. 相机 API

### 13.1 CameraManager（MMD 相机管理）

```typescript
const cameraManager = CameraManager.getInstance();

// 加载相机动画（VMD）
const info = await cameraManager.loadCameraAnimation(filePath, fileName);

// 手动控制
cameraManager.enableManualControl();
cameraManager.disableManualControl();
const inputManager = cameraManager.getInputManager();

// 动画控制
cameraManager.startAnimation();
cameraManager.pauseAnimation();
cameraManager.stopAnimation();
cameraManager.updateAnimation(mmdFrameTime);
cameraManager.deleteCameraAnimation();

// 状态查询
cameraManager.getCurrentAnimation();
cameraManager.hasCameraAnimation();
cameraManager.isAnimationPlaying();

// 相机参数
const mainCamera = cameraManager.getMainCamera();
const mmdCamera = cameraManager.getMmdCamera();

// 偏移与限制
cameraManager.setTargetOffset(x, y, z);
cameraManager.getTargetOffset();
cameraManager.setClampToGround(enabled);
cameraManager.isClampToGroundEnabled();
```

---

## 16. 灯光与阴影 API

### LightManager

```typescript
const lightManager = sceneManager.getLightManager();

// 阴影控制
lightManager.setShadowEnabled(enabled);
const shadowGen = lightManager.getShadowGenerator();

// 阴影投射/接收
lightManager.addShadowCaster(mesh);
lightManager.removeShadowCaster(mesh);
lightManager.registerShadowReceiver(mesh);
lightManager.unregisterShadowReceiver(mesh);

// 阴影参数
lightManager.setShadowConfig({
    resolution: 2048,
    filterMode: 'PCF',
    bias: 0.001,
    normalBias: 0.01,
    darkness: 0.5,
    frustumEdgeFalloff: 0.1,
    area: 10,
    autoFrustum: true
});

lightManager.setShadowResolution(resolution);
lightManager.setShadowFilterMode(mode);
lightManager.setShadowBias(bias);
lightManager.setShadowNormalBias(normalBias);
lightManager.setShadowDarkness(darkness);
lightManager.setShadowFrustumEdgeFalloff(falloff);
lightManager.setShadowArea(area);
lightManager.setAutoFrustum(auto);

// 环境光
lightManager.setAmbientIntensity(intensity);
lightManager.setAmbientColor(r, g, b);

// 方向光
lightManager.setDirectionalColor(r, g, b);
lightManager.setDirectionalIntensity(intensity);
lightManager.setDirectionalDirection(x, y, z);
```

---

## 17. 物理引擎 API

### PhysicsManager

```typescript
const physicsManager = PhysicsManager.getInstance();

await physicsManager.waitForInitialization();

// 地面碰撞
await physicsManager.createGroundCollider();
physicsManager.setGroundCollisionEnabled(enabled);
physicsManager.isGroundCollisionEnabled();

// 模型物理开关
await physicsManager.enablePhysics(mmdModel, enabled);
physicsManager.isPhysicsEnabled(mmdModel);

// 重力
await physicsManager.setGravity(x, y, z);
physicsManager.getGravity();

// 物理精度
physicsManager.setPhysicsPrecision(maxSubSteps, fixedTimeStep);
physicsManager.getPhysicsPrecision();

// 获取运行时
physicsManager.getPhysicsRuntime();
```

---

## 18. 后处理 API

### PostProcessManager

```typescript
const postProcess = new PostProcessManager();
postProcess.initialize(scene, camera, modelProvider);

// 应用完整状态
postProcess.applyState({ /* ... */ });

// 抗锯齿
postProcess.setAAEnabled(enabled);
postProcess.setSamples(value);

// 曝光/饱和度/对比度
postProcess.setExposure(value);
postProcess.setSaturation(value);
postProcess.setContrast(value);

// Bloom
postProcess.setBloomEnabled(enabled);
postProcess.setBloomIntensity(value);
postProcess.setBloomThreshold(value);
postProcess.setBloomKernel(value);

// DOF（景深）
postProcess.setDOFEnabled(enabled);
postProcess.setDOFBlurIntensity(value);
postProcess.setDOFFocusDistance(value);
postProcess.setDOFDepth(value);
postProcess.setDOFAutoFocusEnabled(enabled);
postProcess.setDOFAutoFocusModelId(modelId);

// 暗角
postProcess.setVignetteEnabled(enabled);
postProcess.setVignetteIntensity(value);
postProcess.setVignetteSoftness(value);
```

---

## 19. 模型与材质 API

### 17.1 ModelManager

```typescript
const modelManager = ModelManager.getInstance();

// 加载模型
const modelInfo = await modelManager.loadModel(filePath, fileName, options);

// 模型列表
modelManager.getAllModels();
modelManager.getModel(modelId);
modelManager.hasModel(modelId);
modelManager.getMmdModel(modelId);

// 可见性
modelManager.setModelVisible(modelId, visible);
modelManager.isModelVisible(modelId);

// 删除/清空
await modelManager.deleteModel(modelId);
await modelManager.clearAllModels();

// 事件
modelManager.onModelChanged((model, added) => { ... });

// 纹理降采样
modelManager.setTextureDownsampleEnabled(enabled);
modelManager.isTextureDownsampleEnabled();
```

---

## 20. 场景 API

### SceneManager

```typescript
const sceneManager = new SceneManager();
await sceneManager.initialize(canvas);

// 渲染控制
sceneManager.pauseScreenRender();
sceneManager.resumeScreenRender();
sceneManager.isScreenRenderPaused();

// 视锥剔除
sceneManager.setFrustumCullingEnabled(enabled);
sceneManager.isFrustumCullingEnabled();

// 硬件缩放
sceneManager.setHardwareScalingLevel(level);

// 背景
sceneManager.setBackgroundColor(hex);
sceneManager.setTransparentBackground(enabled);

// 网格
sceneManager.setGridVisible(visible);
sceneManager.getGridVisible();

// 获取子系统
sceneManager.getLightManager();
sceneManager.getParticleManager();
sceneManager.getGridManager();
sceneManager.getScene();
sceneManager.getEngine();
sceneManager.getCamera();
sceneManager.getConfig();
sceneManager.getLightConfig();
```

---

## 21. 动画 API

### AnimationManager

```typescript
animationManager.play();
animationManager.pause();
animationManager.stop();
animationManager.seekTo(frame);
animationManager.getCurrentFrame();
animationManager.setSpeed(speed);
```

---

## 22. 内容库 API

```typescript
import { contentLibraryApi } from './features/library/ContentLibraryApi';

// 文件操作
contentLibraryApi.listAssets(category);
contentLibraryApi.listAllAssets();
contentLibraryApi.getAsset(id);
await contentLibraryApi.addAsset(file, category, name);
await contentLibraryApi.renameAsset(id, newName);
await contentLibraryApi.deleteAsset(id);

// 文件读写
await contentLibraryApi.readFile(path);
await contentLibraryApi.writeFile(path, data);

// 预览
await contentLibraryApi.getImagePreview(id);
await contentLibraryApi.getAudioPreview(id);

// ZIP 解压
await contentLibraryApi.extractZip(zipFile);

// 扫描整理
await contentLibraryApi.scanDirectory(fileList);

// 视频导出
await contentLibraryApi.saveRenderedVideo(blob, name);

// 插件统一接口
contentLibraryApi.pluginApi.readFile(path);
contentLibraryApi.pluginApi.listAssets(category);
contentLibraryApi.pluginApi.addAsset(file, category, name);
```

---

## 23. 工程存档 API

```typescript
import { autoSaveService } from './features/project/AutoSaveService';

// 自动存档设置
autoSaveService.setInterval(0 | 5 | 10); // 分钟
autoSaveService.getStatus();

// 手动保存
await autoSaveService.manualSave(name);

// 自动保存
await autoSaveService.autoSave();

// 渲染前保存
await autoSaveService.saveBeforeRender();

// 存档列表
await autoSaveService.listArchives();

// 读取/删除
await autoSaveService.loadArchive(filePath);
await autoSaveService.deleteArchive(filePath);
```

---

## 24. 截图 API

### ScreenshotApiService

```typescript
import { screenshotApiService } from './features/render/ScreenshotApiService';

// 初始化（宿主启动时调用）
screenshotApiService.initialize(scene, engine);

// 截取当前画面
const blob = await screenshotApiService.capture({
    width: 1920,
    height: 1080,
    mimeType: 'image/png'
});

// 截取并保存到内容库
const fileName = await screenshotApiService.captureAndSave('screenshot.png');

// 截取为 base64
const base64 = await screenshotApiService.captureBase64();
```

---

## 25. 快捷键 API

### ShortcutApiService

```typescript
import { shortcutApiService } from './features/ui/ShortcutApiService';

// 注册快捷键
const shortcutId = shortcutApiService.register({
    key: 'ctrl+shift+p',
    description: '打开后处理面板',
    handler: () => {
        console.log('快捷键触发');
    },
    preventDefault: true
});

// 注销快捷键
shortcutApiService.unregister(shortcutId);

// 注销所有
shortcutApiService.unregisterAll();
```

---

## 26. 通知 API

### NotificationApiService

```typescript
import { notificationApiService } from './features/ui/NotificationApiService';

// 显示通知
const toast = notificationApiService.show({
    message: '操作成功',
    type: 'success',
    duration: 3000
});

// 快捷方法
notificationApiService.info('普通提示');
notificationApiService.success('操作成功');
notificationApiService.error('操作失败');
notificationApiService.warning('警告信息');

// Loading（不自动关闭）
const loading = notificationApiService.loading('处理中...');
loading.dismiss(); // 手动关闭
```

---

## 27. 设置持久化 API

### SettingsApiService

```typescript
import { settingsApiService } from './features/settings/SettingsApiService';

// 设置插件 ID（初始化时调用）
settingsApiService.setPluginId('com.example.my-plugin');

// 保存设置
await settingsApiService.set('mySetting', { enabled: true, value: 42 });

// 读取设置
const setting = await settingsApiService.get('mySetting', { enabled: false, value: 0 });

// 删除设置
await settingsApiService.remove('mySetting');

// 清空所有设置
await settingsApiService.clear();

// 获取所有 key
const keys = await settingsApiService.getAllKeys();
```

---

## 第四部分：适配器接口规范

---

## 28. IMaterialAdapter 材质适配器

材质适配器是着色插件的核心接口，每种材质类型对应一个适配器实现。

```typescript
type ParamValue = number | string | boolean | { r: number; g: number; b: number } | number[];

interface IMaterialAdapter {
    readonly typeId: string;              // 适配器唯一标识
    readonly displayName: string;         // 显示名称
    readonly supportsOutline: boolean;    // 是否支持轮廓线
    readonly supportsMorph: boolean;      // 是否支持材质变形
    readonly createsMaterial: boolean;    // 是否需要创建新材质替换原始材质

    canHandle(material: Material): boolean;
    readState(material: Material): Record<string, ParamValue>;
    writeState(material: Material, state: Record<string, ParamValue>): void;
    getControlDeclarations(): ControlDeclaration[];
    getDefaultState(): Record<string, ParamValue>;
    convertFromMmd?(mmdMaterial: Material, scene: Scene, textureMap?: Map<string, Texture>): Material;
    convertToMmd?(material: Material, scene: Scene): Material;
    disposeMaterial(material: Material): void;
}
```

---

## 29. IPostProcessAdapter 后处理适配器

后处理适配器是后处理插件的核心接口，每种后处理效果对应一个适配器实现。

```typescript
interface IPostProcessAdapter {
    readonly typeId: string;              // 适配器唯一标识
    readonly displayName: string;         // 显示名称
    readonly order: number;               // 管线顺序（值越小越先执行）

    getControlDeclarations(): ControlDeclaration[];
    getDefaultState(): Record<string, ParamValue>;
    readState(): Record<string, ParamValue>;
    writeState(state: Record<string, ParamValue>): void;

    initialize(scene: Scene, camera: Camera): void;
    isInitialized(): boolean;
    setEnabled(enabled: boolean): void;
    isEnabled(): boolean;
    dispose(): void;
}
```

> **内置效果基准 order**：0=FXAA, 10=ImageProcessing, 20=Bloom, 30=DOF

---

## 30. ControlDeclaration 控件声明

宿主根据此声明动态生成 UI。

```typescript
interface ControlDeclaration {
    key: string;           // 参数键名
    label: string;         // 显示标签
    type: 'slider' | 'toggle' | 'dropdown' | 'color' | 'vector';  // 控件类型
    min?: number;          // slider 最小值
    max?: number;          // slider 最大值
    step?: number;         // slider 步长
    options?: { label: string; value: string }[];  // dropdown 选项
}
```

---

## 第五部分：Babylon.js 与安全

---

## 31. BABYLON 可用类列表

`BABYLON` 模块是精简 re-export（非完整 `@babylonjs/core`），实际可用类如下：

### 数学类型
- `BABYLON.Vector3` / `Vector2` / `Vector4` — 2D/3D/4D 向量
- `BABYLON.Matrix` — 4x4 矩阵
- `BABYLON.Quaternion` — 四元数
- `BABYLON.TmpVectors` — 临时向量池
- `BABYLON.Color3` / `Color4` — RGB/RGBA 颜色（0-1 范围）

### 场景核心
- `BABYLON.Scene` — 场景
- `BABYLON.Engine` — 渲染引擎

### 网格/节点
- `BABYLON.Mesh` — 3D 网格对象
- `BABYLON.AbstractMesh` — 抽象网格基类
- `BABYLON.MeshBuilder` — 网格构建工具
- `BABYLON.TransformNode` — 变换节点

### 材质/纹理
- `BABYLON.Material` — 材质基类
- `BABYLON.StandardMaterial` — 标准材质
- `BABYLON.PBRMaterial` — PBR 材质
- `BABYLON.Texture` — 2D 纹理
- `BABYLON.CubeTexture` — 立方体贴图
- `BABYLON.BaseTexture` — 纹理基类

### 光源
- `BABYLON.Light` — 光源基类
- `BABYLON.DirectionalLight` — 方向光
- `BABYLON.HemisphericLight` — 半球光（环境光）
- `BABYLON.PointLight` — 点光源
- `BABYLON.SpotLight` — 聚光灯

### Gizmo
- `BABYLON.GizmoManager` — Gizmo 管理器

### 相机
- `BABYLON.Camera` — 相机基类
- `BABYLON.FreeCamera` — 自由相机
- `BABYLON.ArcRotateCamera` — 环绕相机

### 粒子
- `BABYLON.ParticleSystem` — 粒子系统
- `BABYLON.ParticleSystemSet` — 粒子系统集

### 动画
- `BABYLON.Animation` — 单个动画曲线
- `BABYLON.AnimationGroup` — 动画组

### 后处理/着色器
- `BABYLON.PostProcess` — 自定义后处理
- `BABYLON.Effect` — 着色器包装（含 Effect.ShadersStore）

### 工具/事件
- `BABYLON.Tools` — 通用工具函数
- `BABYLON.Observable` — 观察者模式事件
- `BABYLON.PointerEventTypes` — 指针事件类型常量

> **注意**：`BABYLON.GPUParticleSystem` **并未在 re-export 中导出**，请使用 `BABYLON.ParticleSystem`。

---

## 32. 插件清单 PluginManifest

每个插件必须包含一个 `manifest.json` 文件。

```typescript
interface PluginManifest {
    id: string;                          // 插件唯一标识符（推荐：com.author.plugin-name）
    name: string;                        // 插件显示名称
    version: string;                     // 版本号（语义化版本，如 "1.0.0"）
    type: 'functional' | 'ui';          // 插件类型
    target?: 'ground' | 'particle' | 'shading' | 'postproc' | 'background';  // 功能型插件作用模块
    mount?: 'tab' | 'overlay';          // UI 型插件挂载方式
    author?: string;                     // 作者
    description?: string;                // 描述
}
```

---

## 33. 安全约束机制

### 27.1 参数范围约束

所有 API 参数都有内置范围校验，超出范围自动截断：

| 参数类型 | 范围 | 说明 |
|---------|------|------|
| 强度/透明度 | 0.0 ~ 1.0 | 自动 clamp |
| 颜色 RGB | 0 ~ 255 | 自动 clamp |
| 分辨率 | 128 ~ 4096 | 2 的幂次 |
| 阴影偏置 | -1.0 ~ 1.0 | 防止阴影失真 |
| 重力 | -100 ~ 100 | 防止物理爆炸 |
| 帧率 | 1 ~ 120 | 防止性能崩溃 |
| 曝光 | -5.0 ~ 5.0 | 防止过曝/过暗 |

### 27.2 资源安全

- 模型数量限制（默认 10 个）
- 纹理自动降采样（内存不足时）
- 加载失败自动回滚
- 不允许加载可执行文件
- 材质复用池（避免重复创建）

### 27.3 渲染安全

- 渲染前自动保存工程
- 渲染中断自动恢复
- 输出目录权限检查
- 磁盘空间检查（剩余 < 100MB 时警告）
- 后处理链限制（最多 20 个）

### 27.4 物理安全

- 最大子步数限制（防止死循环）
- 固定时间步长保护（防止穿透）
- 地面碰撞自动创建
- 物理崩溃自动重置

### 27.5 相机安全

- 目标偏移范围限制
- 地面贴合开关（防止相机穿地）
- 手动/自动切换平滑过渡
- 相机动画加载失败自动清理

### 27.6 内存与性能保护

- 纹理降采样开关
- 视锥剔除默认开启
- 硬件缩放级别自动调整
- 离屏资源自动回收
- WebGL 上下文丢失自动恢复

### 27.7 文件安全

- 插件只能**新增**文件，不能覆盖/修改/删除
- 文件写入仅限 `MikuPlay/PluginOutput/<插件ID>/` 目录
- 同名冲突自动追加序号
- 插件无直接文件系统权限

---

## 附录：获取 API 实例的方式

```typescript
// 通过插件上下文
const scene = context.scene;
const engine = context.engine;
const eventBus = context.eventBus;
const storage = context.storage;

const modelManager = context.app.getModelManager();
const animationManager = context.app.getAnimationManager();
const musicManager = context.app.getMusicManager();

// 通过 mp 对象
const models = mp.model.list();
const slider = new mp.ui.Slider(config);
await mp.file.save(options);
mp.ui.toast.success('操作成功');
```

---

> **注意**: 插件开发者请遵循安全约束机制，不要绕过参数范围校验。
> 所有 API 都有完整的 TypeScript 类型定义，IDE 会自动提示。
