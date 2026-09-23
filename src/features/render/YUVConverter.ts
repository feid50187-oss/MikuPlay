/**
 * YUV420 (NV12, BT.709) GPU 转换器
 *
 * 在 WebGL 2.0 上用着色器完成 RGBA→NV12 转换和打包，
 * 使 readPixels 以标准 RGBA/UNSIGNED_BYTE 格式读取 NV12 数据，
 * 避免在 Android 端做 CPU 侧的色彩空间转换。
 *
 * 打包布局（输出纹理尺寸: ceil(W/4) × (H + H/2)）:
 *   Y 区域 (H 行): 每个 RGBA 像素 = 4 个 Y 值, R=Y[0] G=Y[1] B=Y[2] A=Y[3]
 *   UV 区域 (H/2 行): 每个 RGBA 像素 = 2 组 UV 对, R=U₀ G=V₀ B=U₁ A=V₁
 *   展平 RGBA 字节 = NV12 帧 (Y 平面 + 交错 UV 平面)
 */

// 顶点着色器 — 使用 gl_VertexID 绘制全屏四边形，无需 VBO
const VERTEX_SRC = `#version 300 es
void main() {
    vec2 pos = vec2(
        float(gl_VertexID & 1) * 2.0 - 1.0,
        float((gl_VertexID >> 1) & 1) * 2.0 - 1.0
    );
    gl_Position = vec4(pos, 0.0, 1.0);
}`;

// 片段着色器 — BT.709 RGB→YUV 转换 + NV12 打包
const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform sampler2D uSceneTexture;
uniform vec2 uSceneSize;
uniform float uYPlaneHeight;

out vec4 fragColor;

// BT.709 矩阵系数
const vec3 BT709_Y  = vec3(0.2126, 0.7152, 0.0722);
const vec3 BT709_Cb = vec3(-0.1146, -0.3854, 0.5000);
const vec3 BT709_Cr = vec3(0.5000, -0.4542, -0.0458);

// 有限范围 (limited range / MPEG range)
const float Y_OFFSET = 16.0 / 255.0;
const float Y_RANGE  = 219.0 / 255.0;
const float C_OFFSET = 128.0 / 255.0;
const float C_RANGE  = 224.0 / 255.0;

vec3 rgbToYuvBt709(vec3 rgb) {
    float y  = dot(rgb, BT709_Y)  * Y_RANGE + Y_OFFSET;
    float cb = dot(rgb, BT709_Cb) * C_RANGE + C_OFFSET;
    float cr = dot(rgb, BT709_Cr) * C_RANGE + C_OFFSET;
    return vec3(y, cb, cr);
}

void main() {
    ivec2 outPos = ivec2(gl_FragCoord.xy);
    ivec2 maxPos = ivec2(uSceneSize) - 1;

    if (outPos.y < int(uYPlaneHeight)) {
        // ── Y 区域 ──
        int srcY = int(uYPlaneHeight) - 1 - outPos.y; //翻转Y轴
        ivec2 p0 = ivec2(outPos.x * 4,     srcY);
        ivec2 p1 = ivec2(outPos.x * 4 + 1, srcY);
        ivec2 p2 = ivec2(outPos.x * 4 + 2, srcY);
        ivec2 p3 = ivec2(outPos.x * 4 + 3, srcY);

        vec3 yuv0 = rgbToYuvBt709(texelFetch(uSceneTexture, min(p0, maxPos), 0).rgb);
        vec3 yuv1 = rgbToYuvBt709(texelFetch(uSceneTexture, min(p1, maxPos), 0).rgb);
        vec3 yuv2 = rgbToYuvBt709(texelFetch(uSceneTexture, min(p2, maxPos), 0).rgb);
        vec3 yuv3 = rgbToYuvBt709(texelFetch(uSceneTexture, min(p3, maxPos), 0).rgb);

        fragColor = vec4(yuv0.r, yuv1.r, yuv2.r, yuv3.r);
    } else {
        // ── UV 区域 ──
        int uvY = outPos.y - int(uYPlaneHeight);
        int srcY = int(uYPlaneHeight) - 2 - uvY * 2;
        ivec2 p0 = ivec2(outPos.x * 4,     srcY);
        ivec2 p1 = ivec2(outPos.x * 4 + 2, srcY);

        vec3 yuv0 = rgbToYuvBt709(texelFetch(uSceneTexture, min(p0, maxPos), 0).rgb);
        vec3 yuv1 = rgbToYuvBt709(texelFetch(uSceneTexture, min(p1, maxPos), 0).rgb);

        // R=U₀ G=V₀ B=U₁ A=V₁ → 展平即为 NV12 交错 UV
        fragColor = vec4(yuv0.g, yuv0.b, yuv1.g, yuv1.b);
    }
}`;

// Alpha 打包片段着色器：每 texel 打包 4 个像素的 alpha 值
const ALPHA_FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform sampler2D uSceneTexture;
uniform vec2 uSceneSize;
uniform float uYPlaneHeight;

out vec4 fragColor;

void main() {
    ivec2 outPos = ivec2(gl_FragCoord.xy);
    ivec2 maxPos = ivec2(uSceneSize) - 1;
    int srcY = int(uYPlaneHeight) - 1 - outPos.y; // 翻转Y轴

    ivec2 p0 = ivec2(outPos.x * 4,     srcY);
    ivec2 p1 = ivec2(outPos.x * 4 + 1, srcY);
    ivec2 p2 = ivec2(outPos.x * 4 + 2, srcY);
    ivec2 p3 = ivec2(outPos.x * 4 + 3, srcY);

    float a0 = texelFetch(uSceneTexture, min(p0, maxPos), 0).a;
    float a1 = texelFetch(uSceneTexture, min(p1, maxPos), 0).a;
    float a2 = texelFetch(uSceneTexture, min(p2, maxPos), 0).a;
    float a3 = texelFetch(uSceneTexture, min(p3, maxPos), 0).a;

    fragColor = vec4(a0, a1, a2, a3);
}
`;

export class YUVConverter {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;
    private alphaProgram: WebGLProgram | null = null;

    // YUV uniform 位置
    private _uniformSceneTexture: WebGLUniformLocation | null = null;
    private _uniformSceneSize: WebGLUniformLocation | null = null;
    private _uniformYPlaneHeight: WebGLUniformLocation | null = null;

    // Alpha uniform 位置
    private _uAlphaSceneTexture: WebGLUniformLocation | null = null;
    private _uAlphaSceneSize: WebGLUniformLocation | null = null;
    private _uAlphaYPlaneHeight: WebGLUniformLocation | null = null;

    private yuvTexture: WebGLTexture | null = null;
    private yuvFramebuffer: WebGLFramebuffer | null = null;

    private alphaTexture: WebGLTexture | null = null;
    private alphaFramebuffer: WebGLFramebuffer | null = null;

    private currentWidth = 0;
    private currentHeight = 0;
    private packedWidth = 0;
    private packedHeight = 0;
    private alphaPackedWidth = 0;
    private alphaPackedHeight = 0;

    // 透明输出开关：开启时同时渲染 Alpha 平面
    private enableAlpha = false;

    // 保存原始 WebGL 状态，用于恢复
    private _savedDepthTest: boolean = false;
    private _savedBlend: boolean = false;
    private _savedCullFace: boolean = false;
    private _savedScissorTest: boolean = false;
    private _savedColorMask: [boolean, boolean, boolean, boolean] = [true, true, true, true];
    private _savedViewport: [number, number, number, number] = [0, 0, 0, 0];
    private _savedFramebuffer: WebGLFramebuffer | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.program = this.createProgram();
        this.alphaProgram = this.createAlphaProgram();
    }

    /**
     * 创建/重建 YUV 渲染目标
     * 输出纹理尺寸: ceil(width/4) × (height + height/2)
     * @param withAlpha 是否同时创建 Alpha 打包纹理（透明输出模式）
     */
    setup(width: number, height: number, withAlpha = false): void {
        this.destroyRenderTarget();
        this.enableAlpha = withAlpha;
        this.currentWidth = width;
        this.currentHeight = height;
        this.packedWidth = Math.ceil(width / 4);
        this.packedHeight = Math.ceil(height * 1.5); // Y + UV 区域
        this.alphaPackedWidth = Math.ceil(width / 4);
        this.alphaPackedHeight = height;

        const gl = this.gl;

        // ── YUV 纹理 + FBO ──
        this.yuvTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.yuvTexture);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.packedWidth, this.packedHeight);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.yuvFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.yuvFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.yuvTexture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('YUV framebuffer 状态异常');
        }

        // ── Alpha 纹理 + FBO（透明输出模式）──
        if (this.enableAlpha) {
            this.alphaTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.alphaTexture);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.alphaPackedWidth, this.alphaPackedHeight);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            this.alphaFramebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.alphaFramebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.alphaTexture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error('Alpha framebuffer 状态异常');
            }
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * 执行 RGBA→YUV (或 RGBA→YUV + Alpha) 转换
     * @param sceneTexture 场景渲染目标的 WebGL 纹理句柄
     */
    convert(sceneTexture: WebGLTexture): void {
        if (!this.program || !this.yuvFramebuffer) return;

        const gl = this.gl;

        // 保存原始 WebGL 状态
        this._savedDepthTest = gl.isEnabled(gl.DEPTH_TEST);
        this._savedBlend = gl.isEnabled(gl.BLEND);
        this._savedCullFace = gl.isEnabled(gl.CULL_FACE);
        this._savedScissorTest = gl.isEnabled(gl.SCISSOR_TEST);
        this._savedColorMask = gl.getParameter(gl.COLOR_WRITEMASK) as [boolean, boolean, boolean, boolean];
        this._savedViewport = gl.getParameter(gl.VIEWPORT) as [number, number, number, number];
        this._savedFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

        // ── 1. YUV Pass ──
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.yuvFramebuffer);
        gl.viewport(0, 0, this.packedWidth, this.packedHeight);
        gl.useProgram(this.program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
        gl.uniform1i(this._uniformSceneTexture, 0);
        gl.uniform2f(this._uniformSceneSize, this.currentWidth, this.currentHeight);
        gl.uniform1f(this._uniformYPlaneHeight, this.currentHeight);

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // ── 2. Alpha Pass（透明输出模式）──
        if (this.enableAlpha && this.alphaProgram && this.alphaFramebuffer) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.alphaFramebuffer);
            gl.viewport(0, 0, this.alphaPackedWidth, this.alphaPackedHeight);
            gl.useProgram(this.alphaProgram);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sceneTexture);
            gl.uniform1i(this._uAlphaSceneTexture, 0);
            gl.uniform2f(this._uAlphaSceneSize, this.currentWidth, this.currentHeight);
            gl.uniform1f(this._uAlphaYPlaneHeight, this.currentHeight);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }

    /**
     * 从 YUV framebuffer 同步读取打包后的 RGBA 数据
     * 展平后前 width*height 字节为 Y 平面，随后 width*height/2 字节为交错 UV 平面
     */
    readPixels(): Uint8Array {
        if (!this.yuvFramebuffer) throw new Error('YUV converter 未初始化');

        const gl = this.gl;
        const bufferSize = this.packedWidth * this.packedHeight * 4;
        const pixels = new Uint8Array(bufferSize);

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.yuvFramebuffer);
        gl.readPixels(0, 0, this.packedWidth, this.packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // 恢复原始 WebGL 状态
        this.restoreGLState();

        return pixels;
    }

    /**
     * 同步读取到调用方预分配的 buffer，零分配
     * @param out 调用方提供的 typed array，必须 >= packedWidth*packedHeight*4 字节
     * @returns out 的引用
     */
    readPixelsInto(out: Uint8Array): Uint8Array {
        if (!this.yuvFramebuffer) throw new Error('YUV converter 未初始化');
        const requiredSize = this.packedWidth * this.packedHeight * 4;
        if (out.length < requiredSize) {
            throw new Error(`readPixelsInto buffer 太小: ${out.length} < ${requiredSize}`);
        }
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.yuvFramebuffer);
        gl.readPixels(0, 0, this.packedWidth, this.packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, out);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // 恢复原始 WebGL 状态
        this.restoreGLState();

        return out;
    }

    /** 恢复保存的 WebGL 状态 */
    private restoreGLState(): void {
        const gl = this.gl;

        if (this._savedFramebuffer !== null) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._savedFramebuffer);
        }

        if (this._savedDepthTest) gl.enable(gl.DEPTH_TEST);
        else gl.disable(gl.DEPTH_TEST);

        if (this._savedBlend) gl.enable(gl.BLEND);
        else gl.disable(gl.BLEND);

        if (this._savedCullFace) gl.enable(gl.CULL_FACE);
        else gl.disable(gl.CULL_FACE);

        if (this._savedScissorTest) gl.enable(gl.SCISSOR_TEST);
        else gl.disable(gl.SCISSOR_TEST);

        gl.colorMask(
            this._savedColorMask[0],
            this._savedColorMask[1],
            this._savedColorMask[2],
            this._savedColorMask[3]
        );

        gl.viewport(
            this._savedViewport[0],
            this._savedViewport[1],
            this._savedViewport[2],
            this._savedViewport[3]
        );
    }

    /**
     * 将 packed RGBA 数据解包为标准 NV12 字节数组
     * @param packedData readPixels 返回的 packed RGBA 数据
     * @param width  原始视频宽度
     * @param height 原始视频高度
     * @returns NV12 字节数组 (Y 平面 + 交错 UV 平面)
     *
     * 对于 width % 4 === 0 的常见分辨率（720p/1080p/2K/4K），
     * packed 数据已天然符合 NV12 布局，直接返回 subarray 即可。
     */
    unpackToNV12(packedData: Uint8Array, width: number, height: number): Uint8Array {
        const yPlaneSize = width * height;
        const uvPlaneSize = width * (height / 2);
        const totalSize = yPlaneSize + uvPlaneSize;

        if (width % 4 === 0) {
            // 快速路径：packed 数据 = NV12 帧
            return packedData.subarray(0, totalSize);
        }

        // 慢速路径：逐行剥离 padding（非 4 倍数宽度的罕见情况）
        const pw = Math.ceil(width / 4);
        const result = new Uint8Array(totalSize);

        // Y 平面
        let dst = 0;
        for (let row = 0; row < height; row++) {
            const srcRow = row * pw * 4;
            for (let col = 0; col < width; col++) {
                result[dst++] = packedData[srcRow + col];
            }
        }

        // UV 平面
        const uvOffset = height * pw * 4;
        for (let row = 0; row < height / 2; row++) {
            const srcRow = uvOffset + row * pw * 4;
            for (let col = 0; col < width; col++) {
                result[dst++] = packedData[srcRow + col];
            }
        }

        return result;
    }

    /**
     * 慢速路径（非 4 倍宽度）写入调用方 buffer，零分配
     * @param packedData readPixels 返回的 packed RGBA 数据
     * @param width  原始视频宽度
     * @param height 原始视频高度
     * @param out 调用方提供的输出 buffer，必须 >= width*height*1.5 字节
     */
    unpackToNV12InPlace(packedData: Uint8Array, width: number, height: number, out: Uint8Array): void {
        const yPlaneSize = width * height;
        const uvPlaneSize = width * (height / 2);
        const totalSize = yPlaneSize + uvPlaneSize;

        if (out.length < totalSize) {
            throw new Error(`unpackToNV12InPlace buffer 太小: ${out.length} < ${totalSize}`);
        }

        const pw = Math.ceil(width / 4);

        // Y 平面
        let dst = 0;
        for (let row = 0; row < height; row++) {
            const srcRow = row * pw * 4;
            for (let col = 0; col < width; col++) {
                out[dst++] = packedData[srcRow + col];
            }
        }

        // UV 平面
        const uvOffset = height * pw * 4;
        for (let row = 0; row < height / 2; row++) {
            const srcRow = uvOffset + row * pw * 4;
            for (let col = 0; col < width; col++) {
                out[dst++] = packedData[srcRow + col];
            }
        }
    }

    /** 获取 YUV framebuffer 尺寸 */
    getPackedWidth(): number { return this.packedWidth; }
    getPackedHeight(): number { return this.packedHeight; }

    /** 获取 NV12A 完整帧大小：NV12(1.5*W*H) + Alpha(W*H) */
    getNV12AFrameSize(): number {
        const yuvSize = Math.ceil(this.currentWidth * this.currentHeight * 1.5);
        const alphaSize = this.currentWidth * this.currentHeight;
        return yuvSize + alphaSize;
    }

    /**
     * 读取 NV12 + Alpha 合并的帧数据（透明输出模式使用）
     * 布局: [NV12 字节][Alpha 字节]
     * @returns Uint8Array，长度 = 1.5*W*H + W*H = 2.5*W*H
     */
    readNV12A(): Uint8Array {
        if (!this.yuvFramebuffer) throw new Error('YUV converter 未初始化');

        const gl = this.gl;
        const w = this.currentWidth;
        const h = this.currentHeight;
        const yuvSize = Math.ceil(w * h * 1.5);
        const alphaSize = w * h;

        const result = new Uint8Array(yuvSize + alphaSize);

        // 1. 读取 YUV → 解包为 NV12，写入 result 前半段
        const yuvBufferSize = this.packedWidth * this.packedHeight * 4;
        const yuvPixels = new Uint8Array(yuvBufferSize);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.yuvFramebuffer);
        gl.readPixels(0, 0, this.packedWidth, this.packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, yuvPixels);

        // 快速解包到 NV12（width%4===0 时直接拷贝）
        if (w % 4 === 0) {
            result.set(yuvPixels.subarray(0, yuvSize), 0);
        } else {
            this.unpackToNV12InPlace(yuvPixels, w, h, new Uint8Array(result.buffer, 0, yuvSize));
        }

        // 2. 读取 Alpha → 写入 result 后半段
        if (this.alphaFramebuffer) {
            const alphaBufferSize = this.alphaPackedWidth * this.alphaPackedHeight * 4;
            const alphaPixels = new Uint8Array(alphaBufferSize);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.alphaFramebuffer);
            gl.readPixels(0, 0, this.alphaPackedWidth, this.alphaPackedHeight, gl.RGBA, gl.UNSIGNED_BYTE, alphaPixels);

            // Alpha 打包：每 RGBA texel 的 R/G/B/A 四通道 = 4 个连续 alpha 值 (a0,a1,a2,a3)
            // readPixels 读出的字节 = [a0][a1][a2][a3][a4][a5][a6][a7]...
            // 因此 w%4==0 时直接按字节顺序复制前 w*h 字节即可，无需跳过通道
            if (w % 4 === 0) {
                // 快速路径：RGBA 字节序列 = alpha 序列，直接 memcpy 前 alphaSize 字节
                const dst = new Uint8Array(result.buffer, yuvSize, alphaSize);
                dst.set(alphaPixels.subarray(0, alphaSize));
            } else {
                // 慢速路径：逐行复制，跳过每行末尾 padding
                const dst = new Uint8Array(result.buffer, yuvSize, alphaSize);
                const pw = this.alphaPackedWidth;
                for (let row = 0; row < h; row++) {
                    const srcRow = row * pw * 4;
                    for (let col = 0; col < w; col++) {
                        dst[row * w + col] = alphaPixels[srcRow + col];
                    }
                }
            }
        }

        this.restoreGLState();
        return result;
    }

    /**
     * 读取 NV12A 到调用方提供的 buffer，零分配（避免 readNV12A 的临时分配）
     */
    readNV12AInto(out: Uint8Array): Uint8Array {
        if (!this.yuvFramebuffer) throw new Error('YUV converter 未初始化');
        const required = this.getNV12AFrameSize();
        if (out.length < required) {
            throw new Error(`readNV12AInto buffer 太小: ${out.length} < ${required}`);
        }

        const gl = this.gl;
        const w = this.currentWidth;
        const h = this.currentHeight;
        const yuvSize = Math.ceil(w * h * 1.5);
        const alphaSize = w * h;

        // ── 1. 读取 YUV → 解包为 NV12，写入 out 前半段 ──
        const yuvBufferSize = this.packedWidth * this.packedHeight * 4;
        const yuvPixels = new Uint8Array(yuvBufferSize);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.yuvFramebuffer);
        gl.readPixels(0, 0, this.packedWidth, this.packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, yuvPixels);

        if (w % 4 === 0) {
            // out 前 yuvSize 字节 = yuvPixels 前 yuvSize 字节
            const dst = new Uint8Array(out.buffer, out.byteOffset, yuvSize);
            dst.set(yuvPixels.subarray(0, yuvSize));
        } else {
            const dst = new Uint8Array(out.buffer, out.byteOffset, yuvSize);
            this.unpackToNV12InPlace(yuvPixels, w, h, dst);
        }

        // ── 2. 读取 Alpha → 写入 out 后半段（偏移 yuvSize） ──
        if (this.alphaFramebuffer) {
            const alphaBufferSize = this.alphaPackedWidth * this.alphaPackedHeight * 4;
            const alphaPixels = new Uint8Array(alphaBufferSize);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.alphaFramebuffer);
            gl.readPixels(0, 0, this.alphaPackedWidth, this.alphaPackedHeight, gl.RGBA, gl.UNSIGNED_BYTE, alphaPixels);

            if (w % 4 === 0) {
                // 快速路径：RGBA 字节序列 = alpha 序列
                const dst = new Uint8Array(out.buffer, out.byteOffset + yuvSize, alphaSize);
                dst.set(alphaPixels.subarray(0, alphaSize));
            } else {
                // 慢速路径：逐行复制，跳过每行末尾 padding
                const dst = new Uint8Array(out.buffer, out.byteOffset + yuvSize, alphaSize);
                const pw = this.alphaPackedWidth;
                for (let row = 0; row < h; row++) {
                    const srcRow = row * pw * 4;
                    for (let col = 0; col < w; col++) {
                        dst[row * w + col] = alphaPixels[srcRow + col];
                    }
                }
            }
        }

        this.restoreGLState();
        return out;
    }

    /** 是否启用 Alpha 输出 */
    isAlphaEnabled(): boolean { return this.enableAlpha; }

    /** 释放 YUV 渲染目标资源 */
    private destroyRenderTarget(): void {
        const gl = this.gl;
        if (this.yuvFramebuffer) {
            gl.deleteFramebuffer(this.yuvFramebuffer);
            this.yuvFramebuffer = null;
        }
        if (this.yuvTexture) {
            gl.deleteTexture(this.yuvTexture);
            this.yuvTexture = null;
        }
        if (this.alphaFramebuffer) {
            gl.deleteFramebuffer(this.alphaFramebuffer);
            this.alphaFramebuffer = null;
        }
        if (this.alphaTexture) {
            gl.deleteTexture(this.alphaTexture);
            this.alphaTexture = null;
        }
    }

    /** 释放所有资源 */
    dispose(): void {
        this.destroyRenderTarget();
        if (this.program) {
            this.gl.deleteProgram(this.program);
            this.program = null;
        }
        if (this.alphaProgram) {
            this.gl.deleteProgram(this.alphaProgram);
            this.alphaProgram = null;
        }
    }

    // ── 着色器编译 ──

    private createProgram(): WebGLProgram {
        const gl = this.gl;
        const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SRC);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SRC);

        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`YUV 着色器链接失败: ${log}`);
        }

        gl.deleteShader(vs);
        gl.deleteShader(fs);

        this._uniformSceneTexture = gl.getUniformLocation(program, 'uSceneTexture');
        this._uniformSceneSize = gl.getUniformLocation(program, 'uSceneSize');
        this._uniformYPlaneHeight = gl.getUniformLocation(program, 'uYPlaneHeight');

        return program;
    }

    private createAlphaProgram(): WebGLProgram {
        const gl = this.gl;
        const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SRC);
        const fs = this.compileShader(gl.FRAGMENT_SHADER, ALPHA_FRAGMENT_SRC);

        const program = gl.createProgram()!;
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Alpha 着色器链接失败: ${log}`);
        }

        gl.deleteShader(vs);
        gl.deleteShader(fs);

        this._uAlphaSceneTexture = gl.getUniformLocation(program, 'uSceneTexture');
        this._uAlphaSceneSize = gl.getUniformLocation(program, 'uSceneSize');
        this._uAlphaYPlaneHeight = gl.getUniformLocation(program, 'uYPlaneHeight');

        return program;
    }

    private compileShader(type: number, source: string): WebGLShader {
        const gl = this.gl;
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`YUV 着色器编译失败 (${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}): ${log}`);
        }

        return shader;
    }
}
