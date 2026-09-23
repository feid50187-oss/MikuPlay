/*
 * Toon 主体（身体/头发/服装）片段着色器
 * 适配 Babylon.js ShaderMaterial（GLSL ES 3.0）。
 *
 * 已彻底移除方向光项（uLightPosition/uLightIntensity/uShadowColor），
 * 采用纯环境光平涂 + 边缘光模型：
 *   - 环境光（uAmbient）控制整体亮度，无明暗对比
 *   - 边缘光（uRimLightIntensity）基于视线角度
 */
precision highp float;

// varying 输入（对应 toon.vertex.glsl）
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorldTangent;
varying vec3 vWorldBitangent;
varying vec3 vDirWs;
varying vec3 vWorldPos;

// 光照 uniform
uniform float uRimLightWidth;
uniform float uRimLightIntensity;
uniform float uAmbient;
uniform float uUnlit;

// 阴影 uniform（由适配器每帧绑定，对应阳光 ShadowGenerator）
uniform float uShadowEnable;
uniform float uShadowDarkness;
uniform float uShadowFalloff;
uniform float uShadowDepthScale;
uniform float uShadowMapSizeInv;   // 1.0 / shadowMap.width，对应 Babylon 的 shadowMapSizeAndInverse.y
uniform float uShadowBiasTexels;   // 比较期偏置（以阴影贴图 texel 为单位的参考深度回退量），仅作用于 Toon 深度比较
uniform vec2 uShadowDepthValues;
uniform mat4 lightMatrix0;
// PCF/PCSS 使用深度-模板纹理，需用阴影采样器做硬件深度比较；
// ESM/无过滤使用浮点颜色纹理，用普通采样器读取。
#ifdef TOON_SHADOW_DEPTH
uniform highp sampler2DShadow shadowTexture0;
#else
uniform highp sampler2D shadowTexture0;
#endif

// 材质透明度（来自 material.alpha，乘到最终输出 alpha）
uniform float uAlpha;

// 基础色（来自 MMD 材质：diffuse * diffuseTexture）
uniform vec4 uDiffuseColor;
uniform sampler2D uDiffuseMap;
uniform float uHasDiffuseMap;

// 法线贴图（允许为空）
uniform sampler2D uNormalMap;
uniform float uHasNormalMap;

/* -- 内联 GranTurismo 色调映射（对齐参考项目运行时参数 P=2, a=1, m=0.1, l=0.12, c=1.2, b=0）-- */
float gtTonemap(float x) {
    float P = 2.0;
    float a = 1.0;
    float m = 0.1;
    float l = 0.12;
    float c = 1.2;
    float b = 0.0;
    float l0 = (P - m) * l / a;
    float S0 = m + l0;
    float S1 = m + a * l0;
    float C2 = a * P / (P - S1);

    float L_x = m + a * (x - m);
    float T_x = m * pow(x / m, c) + b;
    float S_x = P - (P - S1) * exp(-(C2 * (x - S0) / P));

    float w0;
    if (x <= 0.0)      w0 = 1.0;
    else if (x >= m)   w0 = 0.0;
    else               w0 = 1.0 - (x / m) * (x / m) * (3.0 - 2.0 * (x / m));

    float w2;
    if (x <= S0)       w2 = 0.0;
    else if (x >= S1)  w2 = 1.0;
    else               w2 = (x - S0) / (S1 - S0);

    float w1 = 1.0 - w0 - w2;
    return T_x * w0 + L_x * w1 + S_x * w2;
}

vec3 gtTonemap(vec3 color) {
    return vec3(gtTonemap(color.r), gtTonemap(color.g), gtTonemap(color.b));
}

/* -- 阴影采样（对齐 Babylon 各 ShadowGenerator 过滤模式语义）--
   返回 1=受光，uShadowDarkness=全阴影；中间值为软阴影（PCF/ESM）。
   视锥边缘用 computeFallOff 做衰减，避免投影在正交视锥边界硬切。 */
float computeFallOff(float value, vec2 clipSpace) {
    float mask = smoothstep(1.0 - uShadowFalloff, 1.00000012, clamp(dot(clipSpace, clipSpace), 0.0, 1.0));
    return mix(value, 1.0, mask);
}

float computeToonShadow() {
    if (uShadowEnable < 0.5) return 1.0;

    vec4 lightSpace = lightMatrix0 * vec4(vWorldPos, 1.0);
    vec3 clip = lightSpace.xyz / lightSpace.w;
    vec2 uv = clip.xy * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;

    float depthMetric = clamp((lightSpace.z + uShadowDepthValues.x) / uShadowDepthValues.y, 0.0, 1.0);

    float shadow = 1.0;
#ifdef TOON_SHADOW_DEPTH
    // PCF / PCSS —— 深度-模板纹理 + 硬件比较（sampler2DShadow）。
    // 参考深度必须是窗口深度 0.5*clip.z+0.5：深度模板纹理存的就是这个，
    // 而比较函数为 LESS（返回 1=ref<stored=受光）。传 NDC z 会整体偏大 →
    // 恒判受光 → 阴影消失（根因 A）。双线性采样自带硬件 PCF 软阴影。
    //
    // 单点 texture() 等价 PCF1（QUALITY_LOW）：仅硬件双线性 2x2 邻域，半影 ~1 texel，
    // 在 2048 下仍可见阶梯锯齿，且 UI 的 filteringQuality 对 Toon 无效。
    // 以下按 filteringQuality 升级为 PCF3（4-tap 双三次）/ PCF5（9-tap），
    // 与 Babylon 原生 lightFragment 完全对齐 —— 须依赖 uShadowMapSizeInv(=1/mapSize)。
    //
    // 参考深度额外回退 uShadowBiasTexels 个 texel：阴影贴图由三风格共享、bake 期 bias
    // 无法按风格单独调整，而 Toon 是平涂表面（阴影是唯一明暗信号），拐角 acne/自阴影
    // 条纹会被原样放大。此处仅把 Toon 的比较基准向光源方向推一点（方向光正交投影下
    // 1 texel 深度跨度 ≈ uShadowMapSizeInv），即可在不动共享贴图的前提下压掉残留伪影。
    vec3 uvDepth = vec3(uv, clamp(clip.z * 0.5 + 0.5 - uShadowBiasTexels * uShadowMapSizeInv, 0.0, 0.99999994));
    if (depthMetric < 0.0 || depthMetric > 1.0 ||
        uvDepth.x < 0.0 || uvDepth.x > 1.0 || uvDepth.y < 0.0 || uvDepth.y > 1.0) {
        return 1.0;
    }

    float lit;
    #if defined(TOON_SHADOW_PCF5)
        // 9-tap bicubic（QUALITY_HIGH），移植自 computeShadowWithPCF5
        float mapSize  = 1.0 / uShadowMapSizeInv;        // shadowMapSizeAndInverse.x
        float invSize  = uShadowMapSizeInv;               // shadowMapSizeAndInverse.y
        vec2  tuv = uvDepth.xy * mapSize;
        tuv += 0.5;
        vec2 st = fract(tuv);
        vec2 base_uv = (floor(tuv) - 0.5) * invSize;
        vec2 uvw0 = 4.0 - 3.0 * st;
        vec2 uvw1 = vec2(7.0);
        vec2 uvw2 = 1.0 + 3.0 * st;
        vec3 u = vec3((3.0 - 2.0 * st.x) / uvw0.x - 2.0, (3.0 + st.x) / uvw1.x, st.x / uvw2.x + 2.0) * invSize;
        vec3 v = vec3((3.0 - 2.0 * st.y) / uvw0.y - 2.0, (3.0 + st.y) / uvw1.y, st.y / uvw2.y + 2.0) * invSize;
        lit = 0.0;
        lit += uvw0.x * uvw0.y * texture(shadowTexture0, vec3(base_uv + vec2(u[0], v[0]), uvDepth.z));
        lit += uvw1.x * uvw0.y * texture(shadowTexture0, vec3(base_uv + vec2(u[1], v[0]), uvDepth.z));
        lit += uvw2.x * uvw0.y * texture(shadowTexture0, vec3(base_uv + vec2(u[2], v[0]), uvDepth.z));
        lit += uvw0.x * uvw1.y * texture(shadowTexture0, vec3(base_uv + vec2(u[0], v[1]), uvDepth.z));
        lit += uvw1.x * uvw1.y * texture(shadowTexture0, vec3(base_uv + vec2(u[1], v[1]), uvDepth.z));
        lit += uvw2.x * uvw1.y * texture(shadowTexture0, vec3(base_uv + vec2(u[2], v[1]), uvDepth.z));
        lit += uvw0.x * uvw2.y * texture(shadowTexture0, vec3(base_uv + vec2(u[0], v[2]), uvDepth.z));
        lit += uvw1.x * uvw2.y * texture(shadowTexture0, vec3(base_uv + vec2(u[1], v[2]), uvDepth.z));
        lit += uvw2.x * uvw2.y * texture(shadowTexture0, vec3(base_uv + vec2(u[2], v[2]), uvDepth.z));
        lit /= 144.0;
    #elif defined(TOON_SHADOW_PCF3)
        // 4-tap bicubic（QUALITY_MEDIUM），移植自 computeShadowWithPCF3
        float mapSize  = 1.0 / uShadowMapSizeInv;
        float invSize  = uShadowMapSizeInv;
        vec2  tuv = uvDepth.xy * mapSize;
        tuv += 0.5;
        vec2 st = fract(tuv);
        vec2 base_uv = (floor(tuv) - 0.5) * invSize;
        vec2 uvw0 = 3.0 - 2.0 * st;
        vec2 uvw1 = 1.0 + 2.0 * st;
        vec2 u = vec2((2.0 - st.x) / uvw0.x - 1.0, st.x / uvw1.x + 1.0) * invSize;
        vec2 v = vec2((2.0 - st.y) / uvw0.y - 1.0, st.y / uvw1.y + 1.0) * invSize;
        lit = 0.0;
        lit += uvw0.x * uvw0.y * texture(shadowTexture0, vec3(base_uv + vec2(u[0], v[0]), uvDepth.z));
        lit += uvw1.x * uvw0.y * texture(shadowTexture0, vec3(base_uv + vec2(u[1], v[0]), uvDepth.z));
        lit += uvw0.x * uvw1.y * texture(shadowTexture0, vec3(base_uv + vec2(u[0], v[1]), uvDepth.z));
        lit += uvw1.x * uvw1.y * texture(shadowTexture0, vec3(base_uv + vec2(u[1], v[1]), uvDepth.z));
        lit /= 16.0;
    #else
        // PCF1（QUALITY_LOW）—— 单次硬件双线性比较，向后兼容
        lit = texture(shadowTexture0, uvDepth);
    #endif

    shadow = mix(uShadowDarkness, 1.0, lit);   // 保留软值（根因 B：原代码把采样值整个丢弃）
    return computeFallOff(shadow, clip.xy);
#else
    // 浮点颜色纹理：手动深度比较
    float sampled = texture(shadowTexture0, uv).r;
    #ifdef TOON_SHADOW_CLOSEESM
        // blurCloseEsm：贴图存 clamp(exp(-depthScale*d))，需指数解码（对齐 computeShadowWithCloseESM）
        shadow = clamp(exp(min(87.0, -uShadowDepthScale * (depthMetric - sampled))), uShadowDarkness, 1.0);
    #else
        // none：硬二值比较（与引擎原生语义一致，本就锯齿，UI 可提示用户该模式无可避免）
        shadow = depthMetric > sampled ? uShadowDarkness : 1.0;
    #endif
    return computeFallOff(shadow, clip.xy);
#endif
}

void main() {
    /* -- 法线 -- */
    vec3 worldNormal = normalize(vWorldNormal);
    if (uHasNormalMap > 0.5) {
        vec4 normalTex = texture(uNormalMap, vUv);
        vec3 normalTs = vec3(normalTex.rg * 2.0 - 1.0, 0.0);
        float z = 1.0 - dot(normalTs.xy, normalTs.xy);
        normalTs.z = sqrt(max(z, 0.0));
        mat3 tbn = mat3(normalize(vWorldTangent), normalize(vWorldBitangent), worldNormal);
        worldNormal = normalize(tbn * normalTs);
    }

    float NdotV = dot(worldNormal, vDirWs);

    /* -- 基础色（来自 MMD 材质：diffuse * diffuseTexture）-- */
    vec4 base = uHasDiffuseMap > 0.5 ? texture(uDiffuseMap, vUv) * uDiffuseColor : uDiffuseColor;

    /* -- 无光照模式：整体亮度均匀，完全不受光照影响 -- */
    if (uUnlit > 0.5) {
        if (base.a < .5) discard;
        gl_FragColor = vec4(base.rgb, base.a * uAlpha);
        return;
    }

    /* -- 环境光平涂（无方向光，无明暗对比） -- */
    vec3 diff = base.rgb * uAmbient;

    // 边缘光（基于视线与法线夹角）
    float fresnel = 1.0 - clamp(NdotV, 0.0, 1.0);
    fresnel = pow(fresnel, 8.0) * .5 + .5;
    vec3 rimLight = diff * uRimLightIntensity * fresnel;

    vec3 albedo = diff + rimLight;

    // 阴影：只影响明暗，不影响颜色（与另外两种材质一致）
    albedo *= computeToonShadow();

    // 色调映射：压缩亮部，避免受光面裁成纯白
    vec3 mapped = gtTonemap(albedo);

    if (base.a < .5) discard;
    gl_FragColor = vec4(mapped, base.a * uAlpha);
}