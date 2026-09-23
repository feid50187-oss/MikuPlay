// 水面顶点着色器 - 基于Shadertoy波浪算法
// 移植并适配Babylon.js

precision highp float;

// Babylon.js内置uniforms
uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
uniform float time;

// 水面参数uniforms
uniform float waveIntensity;
uniform float waveSpeed;
uniform float waterDepth;
uniform float waveScale;

// 属性
attribute vec3 position;
attribute vec2 uv;
attribute vec3 normal;

// 输出到片段着色器
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUV;
varying vec3 vWorldPosition;
varying float vWaveHeight;

// 常量
#define DRAG_MULT 0.38
#define ITERATIONS_NORMAL 24

// 波浪函数 - 来自Shadertoy
vec2 wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
    float x = dot(direction, position) * frequency + timeshift;
    float wave = exp(sin(x) - 1.0);
    float dx = wave * cos(x);
    return vec2(wave, -dx);
}

// 多层波浪叠加
float getwaves(vec2 position, int iterations) {
    float wavePhaseShift = length(position) * 0.1;
    float iter = 0.0;
    float frequency = 1.0;
    float timeMultiplier = 2.0;
    float weight = 1.0;
    float sumOfValues = 0.0;
    float sumOfWeights = 0.0;

    for(int i = 0; i < 24; i++) {
        if(i >= iterations) break;

        vec2 p = vec2(sin(iter), cos(iter));
        vec2 res = wavedx(position, p, frequency, time * timeMultiplier * waveSpeed + wavePhaseShift);

        position += p * res.y * weight * DRAG_MULT;

        sumOfValues += res.x * weight;
        sumOfWeights += weight;

        weight = mix(weight, 0.0, 0.2);
        frequency *= 1.18;
        timeMultiplier *= 1.07;
        iter += 1232.399963;
    }

    return sumOfValues / sumOfWeights;
}

// 计算法线
vec3 calculateNormal(vec2 pos, float e, float depth) {
    vec2 ex = vec2(e, 0.0);
    float H = getwaves(pos.xy, ITERATIONS_NORMAL) * depth;
    vec3 a = vec3(pos.x, H, pos.y);

    float h1 = getwaves(pos.xy - ex.xy, ITERATIONS_NORMAL) * depth;
    float h2 = getwaves(pos.xy + ex.yx, ITERATIONS_NORMAL) * depth;

    vec3 va = a - vec3(pos.x - e, h1, pos.y);
    vec3 vb = a - vec3(pos.x, h2, pos.y + e);

    return normalize(cross(va, vb));
}

void main() {
    vec3 worldPos = (world * vec4(position, 1.0)).xyz;

    // 使用UV坐标计算波浪，与地面世界尺寸完全解耦
    vec2 waveCoord = uv * waveScale;

    // 计算波浪高度
    float waveHeight = getwaves(waveCoord, ITERATIONS_NORMAL) * waterDepth * waveIntensity;

    // 应用波浪高度到顶点
    vec3 displacedPos = position;
    displacedPos.y += waveHeight;

    // 计算新的世界位置
    vec4 finalWorldPos = world * vec4(displacedPos, 1.0);
    vWorldPosition = finalWorldPos.xyz;

    // 计算法线 - 使用UV坐标，epsilon相应缩放
    vec3 worldNormal = calculateNormal(waveCoord, 0.01, waterDepth * waveIntensity);
    vNormal = mat3(world) * worldNormal;

    // 输出
    vPosition = displacedPos;
    vUV = uv;
    vWaveHeight = waveHeight;

    gl_Position = projection * view * finalWorldPos;
}
