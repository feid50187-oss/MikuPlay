/**
 * 精简的 Babylon.js re-export 模块
 * 仅导出插件系统需要的 API，避免整个 @babylonjs/core 被打包到插件 chunk
 */

// 基础数学类型
export { Vector3, Vector2, Vector4, Matrix, Quaternion, TmpVectors } from '@babylonjs/core/Maths/math.vector';
export { Color3, Color4 } from '@babylonjs/core/Maths/math.color';

// 场景核心
export { Scene } from '@babylonjs/core/scene';
export { Engine } from '@babylonjs/core/Engines/engine';

// 网格与材质
export { Mesh } from '@babylonjs/core/Meshes/mesh';
export { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
export { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
export { TransformNode } from '@babylonjs/core/Meshes/transformNode';
export { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
export { Material } from '@babylonjs/core/Materials/material';
export { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
export { Texture } from '@babylonjs/core/Materials/Textures/texture';
export { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
export { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';

// 光源
export { Light } from '@babylonjs/core/Lights/light';
export { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
export { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
export { PointLight } from '@babylonjs/core/Lights/pointLight';
export { SpotLight } from '@babylonjs/core/Lights/spotLight';

// Gizmo（UI 型插件使用，如灯光管理器）
export { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager';

// 相机
export { Camera } from '@babylonjs/core/Cameras/camera';
export { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
export { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';

// 粒子系统
export { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
export { ParticleSystemSet } from '@babylonjs/core/Particles/particleSystemSet';

// 动画
export { Animation } from '@babylonjs/core/Animations/animation';
export { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';

// 后处理
export { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
export { Effect } from '@babylonjs/core/Materials/effect';

// 工具类
export { Tools } from '@babylonjs/core/Misc/tools';
export { Observable } from '@babylonjs/core/Misc/observable';

// 事件类型
export { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';