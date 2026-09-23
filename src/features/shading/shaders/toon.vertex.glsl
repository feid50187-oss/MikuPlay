/*
 * Toon 顶点着色器
 * 移植自 reference/ToonShading 的 vertex.glsl，适配 Babylon.js ShaderMaterial。
 * 支持骨骼蒙皮（使用 Babylon 内置的 bonesDeclaration / instancesVertex / bonesVertex include）。
 */
precision highp float;

// Babylon.js 内置 uniform
uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
uniform vec3 cameraPosition;

// Babylon.js 顶点属性
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

// 骨骼声明（由 Babylon 提供，根据 mesh 自动注入 defines）
#include<bonesDeclaration>

// 顶点形态键（morph targets）：Babylon 在 isReady 时按 mesh.morphTargetManager
// 自动注入 MORPHTARGETS / NUM_MORPH_INFLUENCERS 等 defines 与属性缓冲；
// 这里仅消费官方 include 即可恢复 PMX 表情变形（详见 docs/toon-shader-issue-analysis.md）。
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldTangent;
varying vec3 vWorldBitangent;
varying vec3 vDirWs;
varying vec3 vWorldPos;
varying mat4 vViewMatrix;

// 由法线构造正交切线基（Phase 1 无切线属性时的兜底）
void buildTBN(in vec3 n, out vec3 tangent, out vec3 bitangent) {
    vec3 up = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    tangent = normalize(cross(up, n));
    bitangent = normalize(cross(n, tangent));
}

void main() {
    // 实例化 + 骨骼蒙皮（Babylon 标准变量 finalWorld）
    #include<instancesVertex>
    #include<bonesVertex>

    // 顶点形态键：在 local space 偏移（骨骼只算 finalWorld，先后顺序无冲突）。
    // PMX 顶点 morph 只有位置，故 normal 不受影响。
    vec3 positionUpdated = position;
    vec3 normalUpdated = normal;
    #include<morphTargetsVertexGlobal>
    #include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]

    vec4 worldPos = finalWorld * vec4(positionUpdated, 1.0);

    vUv = uv;
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize((finalWorld * vec4(normalUpdated, 0.0)).xyz);

    vec3 tb, bt;
    buildTBN(vWorldNormal, tb, bt);
    vWorldTangent = tb;
    vWorldBitangent = bt;

    vDirWs = normalize(cameraPosition - worldPos.xyz);
    vViewMatrix = view;

    gl_Position = projection * view * worldPos;
}