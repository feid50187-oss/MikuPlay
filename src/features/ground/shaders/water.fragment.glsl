// 水面片段着色器 - 基于Shadertoy效果
// 包含Fresnel反射、大气散射、水下散射

precision highp float;

// Babylon.js内置uniforms
uniform mat4 view;
uniform vec3 cameraPosition;
uniform float time;

// 水面参数uniforms
uniform vec3 waterColor;
uniform float waterAlpha;
uniform float sunHeight;
uniform float scatteringIntensity;
uniform float edgeFade; // 边缘渐隐强度 0~1，按 UV 到中心距离衰减 alpha

// 从顶点着色器传入
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUV;
varying vec3 vWorldPosition;
varying float vWaveHeight;

// 常量
#define PI 3.14159265359

// 简化的大气散射计算
vec3 extra_cheap_atmosphere(vec3 raydir, vec3 sundir) {
    float special_trick = 1.0 / (raydir.y * 1.0 + 0.1);
    float special_trick2 = 1.0 / (sundir.y * 11.0 + 1.0);
    float raysundt = pow(abs(dot(sundir, raydir)), 2.0);
    float sundt = pow(max(0.0, dot(sundir, raydir)), 8.0);
    float mymie = sundt * special_trick * 0.2;

    vec3 suncolor = mix(vec3(1.0), max(vec3(0.0), vec3(1.0) - vec3(5.5, 13.0, 22.4) / 22.4), special_trick2);
    vec3 bluesky = vec3(5.5, 13.0, 22.4) / 22.4 * suncolor;
    vec3 bluesky2 = max(vec3(0.0), bluesky - vec3(5.5, 13.0, 22.4) * 0.002 * (special_trick + -6.0 * sundir.y * sundir.y));
    bluesky2 *= special_trick * (0.24 + raysundt * 0.24);

    return bluesky2 * (1.0 + 1.0 * pow(1.0 - raydir.y, 3.0));
}

// 计算太阳方向
vec3 getSunDirection() {
    float sunAngle = sunHeight * PI * 0.5;
    return normalize(vec3(-0.07735, sin(sunAngle), 0.57735));
}

// 获取大气颜色
vec3 getAtmosphere(vec3 dir) {
    return extra_cheap_atmosphere(dir, getSunDirection()) * 0.5;
}

// 获取太阳高光
float getSun(vec3 dir) {
    vec3 sundir = getSunDirection();
    return pow(max(0.0, dot(dir, sundir)), 720.0) * 210.0;
}

// ACES色调映射
vec3 aces_tonemap(vec3 color) {
    mat3 m1 = mat3(
        0.59719, 0.07600, 0.02840,
        0.35458, 0.90834, 0.13383,
        0.04823, 0.01566, 0.83777
    );
    mat3 m2 = mat3(
        1.60475, -0.10208, -0.00327,
        -0.53108,  1.10813, -0.07276,
        -0.07367, -0.00605,  1.07602
    );
    vec3 v = m1 * color;
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return pow(clamp(m2 * (a / b), 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
    // 计算视线方向
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);

    // 获取法线并确保朝上
    vec3 N = normalize(vNormal);
    N.y = abs(N.y);

    // 计算Fresnel系数
    float fresnel = 0.04 + (1.0 - 0.04) * pow(1.0 - max(0.0, dot(N, viewDir)), 5.0);

    // 计算反射方向
    vec3 R = reflect(-viewDir, N);
    R.y = abs(R.y);

    // 反射颜色（天空+太阳）
    vec3 reflection = getAtmosphere(R) + getSun(R);

    // 水下散射
    vec3 scattering = waterColor * 0.1 * scatteringIntensity * (0.2 + (vWaveHeight + 1.0) * 0.5);

    // 混合反射和散射
    vec3 finalColor = mix(scattering, reflection, fresnel);

    // 添加水体颜色影响
    finalColor = mix(finalColor, waterColor, 0.3 * (1.0 - fresnel));

    // 色调映射
    finalColor = aces_tonemap(finalColor * 2.0);

    // 边缘渐隐：按 UV 到中心的归一化距离衰减 alpha（与地面缩放解耦），
    // 外圈半径 (1-edgeFade)~1 范围内 alpha 平滑衰减到 0，
    // 使用 smoothstep 曲线消除线性衰减产生的可见分界线（白边）
    float edgeAlpha = 1.0;
    if (edgeFade > 0.0) {
        // 切比雪夫距离（max 分量）归一化：边中点 t=1 也完全衰减，
        // 避免欧几里得归一化时边中段 t≈0.707 衰减不足导致地平线硬边
        float distFromCenter = max(abs(vUV.x - 0.5), abs(vUV.y - 0.5)) * 2.0;
        float fadeStart = 1.0 - edgeFade;
        if (distFromCenter > fadeStart) {
            float s = clamp((distFromCenter - fadeStart) / (1.0 - fadeStart), 0.0, 1.0);
            edgeAlpha = 1.0 - s * s * (3.0 - 2.0 * s);
        }
    }

    gl_FragColor = vec4(finalColor, waterAlpha * edgeAlpha);
}
