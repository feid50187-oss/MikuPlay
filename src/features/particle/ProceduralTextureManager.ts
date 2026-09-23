
import {
    Scene,
    ProceduralTexture,
    Effect
} from '@babylonjs/core';

//雨纹理
const RainProceduralShader = `
precision highp float;
varying vec2 vUV;

void main() {
    vec2 center = vUV - vec2(0.5);
    
    float aspect = 4.0;
    vec2 stretched = center * vec2(aspect, 1.0);
    
    float dist = length(stretched);
    
    float dropShape = 1.0 - smoothstep(0.0, 0.45, dist);
    
    vec2 highlightPos = center - vec2(0.0, 0.15);
    float highlight = 1.0 - smoothstep(0.0, 0.08, length(highlightPos * vec2(aspect, 1.0)));
    highlight *= 0.5;
    
    float alpha = dropShape * (1.0 - abs(center.x) * 2.0);
    alpha = clamp(alpha, 0.0, 1.0);
    
    gl_FragColor = vec4(vec3(1.0) + highlight, alpha);
}
`;

// 生成樱花单片花瓣纹理
const SakuraProceduralShader = `
precision highp float;
varying vec2 vUV;

// 三次贝塞尔曲线插值
float bezier(float t, float p0, float p1, float p2, float p3) {
    float u = 1.0 - t;
    return u*u*u*p0 + 3.0*u*u*t*p1 + 3.0*u*t*t*p2 + t*t*t*p3;
}

void main() {
    vec2 p = vUV - vec2(0.5);
    
    // 对 Y 坐标做非线性拉伸：两端独立控制，模拟真实樱花不对称轮廓
    // tRaw 从 0 到 1 均匀分布
    // 下半段 (0~0.5)：tBottom = (tRaw*2)^0.7 * 0.5 → 更圆润的基部
    // 上半段 (0.5~1)：tTop = 0.5 + ((tRaw-0.5)*2)^0.9 * 0.5 → 稍尖的顶端
    float tRaw = p.y + 0.5;
    float t = tRaw < 0.5 ? pow(tRaw * 2.0, 0.7) * 0.5 : 0.5 + pow((tRaw - 0.5) * 2.0, 0.9) * 0.5;
    t = clamp(t, 0.0, 1.0);
    
    // 两条贝塞尔曲线围成纺锤形花瓣轮廓
    // 上曲线: 0.0 -> 0.38 -> 0.42 -> 0.0
    // 下曲线对称，共同形成饱满的纺锤形状
    float halfWidth = bezier(t, 0.0, 0.38, 0.42, 0.0);
    
    // 判断点是否在花瓣内部
    float dist = abs(p.x) / halfWidth;
    float inside = 1.0 - smoothstep(0.95, 1.0, dist);
    
    // 在基部添加V形缺口（模拟真实樱花形态）
    // 缺口在基部下方中心，形成尖锐的V形切口
    float notchMask = 1.0;
    if (p.y < -0.32) {
        // 计算V形缺口：从底部中心向上形成两条斜线
        float notchBottom = -0.48;
        float notchTop = -0.32;
        float notchWidth = 0.35;
        
        // 当前y相对于缺口范围的位置 (0=top, 1=bottom)
        float notchT = (p.y - notchTop) / (notchBottom - notchTop);
        notchT = clamp(notchT, 0.0, 1.0);
        
        // V形宽度：从顶部的小宽度逐渐扩大到底部的最大宽度
        float vWidth = notchWidth * notchT;
        
        // 缺口在中心 (x=0)，检查是否在V形范围内
        float notchDist = abs(p.x);
        
        // 如果在V形内部，切掉这部分
        if (notchDist < vWidth) {
            notchMask = 0.0;
        }
    }
    
    inside *= notchMask;
    
    // 以短轴为中心的颜色渐变：沿 Y 轴方向变化
    // 纵向亮：中部偏上下方向更亮
    float highlight = exp(-pow(p.y / 0.4, 2.0));
    
    // 纵向渐变：中部最亮，两端渐暗
    float vGrad = sin(t * 3.14159);
    
    // 樱花粉色系
    vec3 baseColor = vec3(1.0, 0.71, 0.79);      // 基础粉红
    vec3 midColor = vec3(1.0, 0.88, 0.92);       // 中部浅粉
    vec3 tipColor = vec3(1.0, 0.95, 0.96);       // 高光白粉
    
    // 混合颜色：基础色 -> 中部亮色 -> 高光
    vec3 color = mix(baseColor, midColor, highlight * 0.6);
    color = mix(color, tipColor, highlight * vGrad * 0.3);
    
    // 边缘清晰，alpha 抗锯齿
    float alpha = inside;
    
    gl_FragColor = vec4(color, alpha);
}
`;

//雪花纹理
const SnowProceduralShader = `
precision highp float;
varying vec2 vUV;

vec2 rotate(vec2 p, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

float branch(vec2 p, float angle, float length) {
    vec2 rp = rotate(p, angle);
    float trunk = 1.0 - smoothstep(0.0, 0.02, abs(rp.x));
    trunk *= 1.0 - smoothstep(0.0, length, max(0.0, rp.y));
    
    float sideBranch1 = 1.0 - smoothstep(0.0, 0.015, abs(rp.x - rp.y * 0.3));
    sideBranch1 *= 1.0 - smoothstep(0.3, 0.5, rp.y);
    sideBranch1 *= step(0.0, rp.y);
    
    float sideBranch2 = 1.0 - smoothstep(0.0, 0.015, abs(rp.x + rp.y * 0.3));
    sideBranch2 *= 1.0 - smoothstep(0.3, 0.5, rp.y);
    sideBranch2 *= step(0.0, rp.y);
    
    return max(trunk, max(sideBranch1, sideBranch2));
}

void main() {
    vec2 center = vUV - vec2(0.5);
    
    float snowflake = 0.0;
    for (int i = 0; i < 6; i++) {
        float angle = float(i) * 3.14159 / 3.0;
        snowflake = max(snowflake, branch(center, angle, 0.45));
    }
    
    float centerDot = 1.0 - smoothstep(0.0, 0.06, length(center));
    snowflake = max(snowflake, centerDot);
    
    float edge = 1.0 - smoothstep(0.4, 0.5, length(center));
    snowflake *= edge;
    
    float sparkle = pow(1.0 - length(center) * 2.0, 3.0) * 0.3;
    
    gl_FragColor = vec4(vec3(1.0) + sparkle, snowflake);
}
`;

export class ProceduralTextureManager {
    private scene: Scene;
    private textures: Map<string, ProceduralTexture> = new Map();
    private static instance: ProceduralTextureManager | null = null;

    constructor(scene: Scene) {
        this.scene = scene;
        this.registerShaders();
    }

    public static getInstance(scene: Scene): ProceduralTextureManager {
        if (!ProceduralTextureManager.instance) {
            ProceduralTextureManager.instance = new ProceduralTextureManager(scene);
        }
        return ProceduralTextureManager.instance;
    }

    public static resetInstance(): void {
        if (ProceduralTextureManager.instance) {
            ProceduralTextureManager.instance.dispose();
        }
        ProceduralTextureManager.instance = null;
    }

    private registerShaders(): void {
        const vertexShader = `
precision highp float;
attribute vec2 position;
varying vec2 vUV;

void main() {
    vUV = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

        Effect.ShadersStore['rainProceduralVertexShader'] = vertexShader;
        Effect.ShadersStore['rainProceduralFragmentShader'] = RainProceduralShader;

        Effect.ShadersStore['sakuraProceduralVertexShader'] = vertexShader;
        Effect.ShadersStore['sakuraProceduralFragmentShader'] = SakuraProceduralShader;

        Effect.ShadersStore['snowProceduralVertexShader'] = vertexShader;
        Effect.ShadersStore['snowProceduralFragmentShader'] = SnowProceduralShader;
    }

    public getTexture(type: 'rain' | 'sakura' | 'snow'): ProceduralTexture {
        if (this.textures.has(type)) {
            const cachedTexture = this.textures.get(type)!;
            
            if (cachedTexture.isReady() && cachedTexture.getInternalTexture()) {
                return cachedTexture;
            }
            
            this.textures.delete(type);
            cachedTexture.dispose();
        }

        const texture = this.createTexture(type);
        this.textures.set(type, texture);
        return texture;
    }

    private createTexture(type: 'rain' | 'sakura' | 'snow'): ProceduralTexture {
        const size = type === 'rain' ? 64 : 128;

        const texture = new ProceduralTexture(
            `procedural_${type}`,
            size,
            `${type}Procedural`,
            this.scene,
            null,
            true,
            false
        );

        texture.wrapU = 1;
        texture.wrapV = 1;

        return texture;
    }

    public refresh(): void {
        this.textures.forEach(texture => texture.refreshRate = 1);
    }

    public dispose(): void {
        this.textures.forEach(texture => texture.dispose());
        this.textures.clear();
        ProceduralTextureManager.instance = null;
    }
}
