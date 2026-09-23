import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteObfuscateFile } from 'vite-plugin-obfuscator';

const pkg = require('./package.json');

// 构建变体：pdev = 插件开发者版（弱混淆 + 保留 console + Eruda）
// 由 `vite build --mode pdev` 触发；默认 mode=production 为正式版
const isPdev = (mode: string) => mode === 'pdev';

// 自定义插件：加载GLSL文件为字符串
const glslLoader = () => ({
    name: 'glsl-loader',
    transform(code: string, id: string) {
        if (id.endsWith('.glsl')) {
            return {
                code: `export default ${JSON.stringify(code)};`,
                map: null
            };
        }
    }
});

// 生产构建时仅混淆项目源码 chunk，排除第三方依赖与 Babylon.js / Capacitor 分块
// pdev 变体使用弱混淆：关闭自毁类选项，保留 console 输出
const obfuscatorOptionsPdev = {
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: true,
    reservedNames: ['^BABYLON', '^Capacitor'],
    transformObjectKeys: false,

    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,       // pdev: 关闭，避免干扰调试
    disableConsoleOutput: false,   // pdev: 保留 console
    log: false,
    numbersToExpressions: false,
    selfDefending: false,          // pdev: 关闭，避免误触发崩溃
    simplify: true,
};

const obfuscatorOptionsProd = {
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: true,
    reservedNames: ['^BABYLON', '^Capacitor'],
    transformObjectKeys: false,

    controlFlowFlattening: false,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.5,
    debugProtection: true,
    disableConsoleOutput: true,
    log: false,
    numbersToExpressions: false,
    selfDefending: true,
    simplify: true,
};

function shouldObfuscateChunk(name: string, asset: any): boolean {
    if (!asset.code) return false;
    if (name.includes('node_modules')) return false;
    if (asset.facadeModuleId && (
        /node_modules/.test(asset.facadeModuleId) ||
        /@babylonjs\/core/.test(asset.facadeModuleId) ||
        /babylon-mmd/.test(asset.facadeModuleId) ||
        /\.glsl$/i.test(asset.facadeModuleId)
    )) return false;
    if (/\.(fragment|vertex|glsl)\./i.test(name)) return false;

    const base = name.split('/').pop()?.replace(/\.[A-Za-z0-9_-]+\.js$/i, '') ?? name;
    // 排除第三方库以及新增的 panels-*、features-* chunk
    // pdev: 额外排除 devconsole chunk（Eruda 等），不混淆开发者工具
    return !/^(vendor|babylon.*|mmd.*|styles|rolldown-runtime|features-.*|shared-ui|plugins|app-core|devconsole.*)$/.test(base);
}

function filteredObfuscatorPlugin(options: any) {
    const baseHook = viteObfuscateFile(options).transformIndexHtml;
    return {
        name: 'vite:filtered-obfuscator',
        apply: 'build' as const,
        transformIndexHtml(html: string, ctx: any) {
            if (!ctx?.bundle) return html;

            const filteredBundle: Record<string, any> = {};
            for (const [name, asset] of Object.entries(ctx.bundle) as [string, any][]) {
                if (shouldObfuscateChunk(name, asset)) {
                    filteredBundle[name] = asset;
                }
            }

            return baseHook.transform(html, { ...ctx, bundle: filteredBundle });
        }
    };
}

export default defineConfig(({ mode }) => {
    const pdev = isPdev(mode);
    return {
    root: 'src',
    base: './',
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        sourcemap: false,
        minify: 'terser',
        terserOptions: {
            compress: {
                // pdev: 保留 console 和 debugger，供 Eruda 捕获
                drop_console: !pdev,
                drop_debugger: !pdev
            },
            mangle:{
                keep_classnames: true,
                keep_fnames: true
            }
        },
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'src/index.html')
            },
            output: {
                // 手动控制代码分割
                // 核心策略：
                // 1. 合并所有 Shader 文件 → 消除 400+ 微小 chunk
                // 2. 保持原有的 Babylon.js 拆分逻辑（已在原构建中验证有效）
                // 3. 拆分 featurePanels → 从 1.4MB 单文件拆为 6 个面板 chunk
                manualChunks(id) {
                    // ============================================================
                    // pdev: devconsole 模块独立 chunk，便于排除混淆
                    // ============================================================
                    if (id.includes('src/devconsole') || id.includes('eruda')) {
                        return 'devconsole';
                    }

                    // ============================================================
                    // P0: 合并所有 Shader/ShaderInclude 文件
                    // 原构建中 400+ <1KB chunk 的根源
                    // ============================================================
                    if (id.includes('Shaders') || id.includes('ShadersWGSL')) {
                        return 'babylon-shaders';
                    }

                    // ============================================================
                    // P1: Babylon.js core 拆分（保持与原配置一致的匹配逻辑）
                    // ============================================================
                    if (id.includes('@babylonjs/core')) {
                        // 数学工具库
                        if (id.includes('Maths')) {
                            return 'babylon-maths';
                        }
                        // 材质系统
                        if (id.includes('Materials')) {
                            if (id.includes('PBR') || id.includes('pbr')) {
                                return 'babylon-materials-pbr';
                            }
                            if (id.includes('Node') && id.includes('Material')) {
                                return 'babylon-materials-node';
                            }
                            if (id.includes('Textures')) {
                                return 'babylon-textures';
                            }
                            return 'babylon-materials';
                        }
                        // 网格和几何体
                        if (id.includes('Meshes')) {
                            return 'babylon-meshes';
                        }
                        // 后处理管线
                        if (id.includes('PostProcesses')) {
                            return 'babylon-postprocess';
                        }
                        // 光照系统
                        if (id.includes('Lights')) {
                            return 'babylon-lights';
                        }
                        // 相机系统
                        if (id.includes('Cameras')) {
                            if (id.includes('Inputs')) {
                                return 'babylon-camera-inputs';
                            }
                            if (id.includes('VR')) {
                                return 'babylon-camera-vr';
                            }
                            return 'babylon-cameras';
                        }
                        // 引擎核心和场景
                        if (id.includes('scene') || id.includes('Engines') || id.includes('Misc') || id.includes('Helpers')) {
                            return 'babylon-engine';
                        }
                        // 动画系统
                        if (id.includes('Animations') || id.includes('Morph')) {
                            return 'babylon-animations';
                        }
                        // 骨骼和蒙皮
                        if (id.includes('Bones') || id.includes('Skeleton')) {
                            return 'babylon-bones';
                        }
                        // 缓冲区和渲染基础设施
                        if (id.includes('Buffers') || id.includes('Rendering') || id.includes('States')) {
                            return 'babylon-rendering';
                        }
                        // 碰撞和拾取
                        if (id.includes('Collisions') || id.includes('Culling')) {
                            return 'babylon-culling';
                        }
                        // 物理引擎
                        if (id.includes('Physics')) {
                            return 'babylon-physics';
                        }
                        // 粒子系统
                        if (id.includes('Particles')) {
                            return 'babylon-particles';
                        }
                        // 加载器
                        if (id.includes('Loading')) {
                            return 'babylon-loading';
                        }
                        // 其他低频模块
                        if (id.includes('Actions') || id.includes('Audio') || id.includes('Behaviors') ||
                            id.includes('Debug') || id.includes('DeviceInput') || id.includes('Events') ||
                            id.includes('Gamepads') || id.includes('Gizmos') || id.includes('Layers') ||
                            id.includes('Sprites') || id.includes('XR')) {
                            return 'babylon-features';
                        }
                    }

                    // ============================================================
                    // P2: babylon-mmd 拆分
                    // ============================================================
                    if (id.includes('babylon-mmd')) {
                        if (id.includes('Loader')) {
                            return 'mmd-loader';
                        }
                        if (id.includes('Runtime')) {
                            return 'mmd-runtime';
                        }
                        return 'mmd-core';
                    }

                    // ============================================================
                    // P3: 项目源码拆分
                    // ============================================================

                    // 非 Babylon/mmd 的第三方依赖
                    if (id.includes('node_modules')) {
                        return 'vendor';
                    }

                    // featurePanels 按子目录拆分（原 1.4MB panels 拆为 6 个独立 chunk）
                    if (id.includes('featurePanels')) {
                        if (id.includes('world')) return 'panels-world';
                        if (id.includes('import')) return 'panels-import';
                        if (id.includes('model')) return 'panels-model';
                        if (id.includes('shading')) return 'panels-shading';
                        if (id.includes('shortcut')) return 'panels-shortcut';
                        return 'panels-common';
                    }

                    // CSS 样式文件合并
                    if (id.includes('.css.ts') || id.includes('styles')) {
                        return 'styles';
                    }
                },
                // 控制 chunk 文件命名
                chunkFileNames: (chunkInfo) => {
                    const name = chunkInfo.name;
                    // Babylon.js
                    if (name === 'babylon-shaders')     return 'js/babylon-shaders.[hash].js';
                    if (name === 'babylon-maths')       return 'js/babylon-maths.[hash].js';
                    if (name === 'babylon-materials')    return 'js/babylon-materials.[hash].js';
                    if (name === 'babylon-materials-pbr') return 'js/babylon-materials-pbr.[hash].js';
                    if (name === 'babylon-materials-node') return 'js/babylon-materials-node.[hash].js';
                    if (name === 'babylon-textures')     return 'js/babylon-textures.[hash].js';
                    if (name === 'babylon-meshes')       return 'js/babylon-meshes.[hash].js';
                    if (name === 'babylon-postprocess')  return 'js/babylon-postprocess.[hash].js';
                    if (name === 'babylon-lights')       return 'js/babylon-lights.[hash].js';
                    if (name === 'babylon-cameras')      return 'js/babylon-cameras.[hash].js';
                    if (name === 'babylon-camera-inputs') return 'js/babylon-camera-inputs.[hash].js';
                    if (name === 'babylon-camera-vr')    return 'js/babylon-camera-vr.[hash].js';
                    if (name === 'babylon-engine')       return 'js/babylon-engine.[hash].js';
                    if (name === 'babylon-animations')   return 'js/babylon-animations.[hash].js';
                    if (name === 'babylon-bones')        return 'js/babylon-bones.[hash].js';
                    if (name === 'babylon-rendering')    return 'js/babylon-rendering.[hash].js';
                    if (name === 'babylon-culling')      return 'js/babylon-culling.[hash].js';
                    if (name === 'babylon-physics')      return 'js/babylon-physics.[hash].js';
                    if (name === 'babylon-particles')    return 'js/babylon-particles.[hash].js';
                    if (name === 'babylon-loading')      return 'js/babylon-loading.[hash].js';
                    if (name === 'babylon-features')     return 'js/babylon-features.[hash].js';
                    // MMD
                    if (name === 'mmd-core')             return 'js/mmd-core.[hash].js';
                    if (name === 'mmd-loader')           return 'js/mmd-loader.[hash].js';
                    if (name === 'mmd-runtime')          return 'js/mmd-runtime.[hash].js';
                    // Panels
                    if (name === 'panels-world')         return 'js/panels-world.[hash].js';
                    if (name === 'panels-import')        return 'js/panels-import.[hash].js';
                    if (name === 'panels-model')         return 'js/panels-model.[hash].js';
                    if (name === 'panels-shading')       return 'js/panels-shading.[hash].js';
                    if (name === 'panels-shortcut')      return 'js/panels-shortcut.[hash].js';
                    if (name === 'panels-common')        return 'js/panels-common.[hash].js';
                    if (name === 'feature-panels')       return 'js/panels.[hash].js';
                    // DevConsole (pdev only)
                    if (name === 'devconsole')           return 'js/devconsole.[hash].js';
                    // Other
                    if (name === 'vendor')               return 'js/vendor.[hash].js';
                    if (name === 'styles')               return 'js/styles.[hash].js';
                    return 'js/[name].[hash].js';
                },
                // 入口文件命名
                entryFileNames: 'js/[name].[hash].js',
                // 资源文件命名
                assetFileNames: (assetInfo) => {
                    const info = assetInfo.name || '';
                    if (/\.(css)$/i.test(info)) {
                        return 'css/[name].[hash][extname]';
                    }
                    if (/\.(svg|png|jpg|jpeg|gif|webp)$/i.test(info)) {
                        return 'images/[name].[hash][extname]';
                    }
                    return 'assets/[name].[hash][extname]';
                }
            }
        },
        chunkSizeWarningLimit: 1000,
        target: 'esnext'
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    server: {
        host: true,
        port: 3000,
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp'
        }
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        '__DEV__': 'import.meta.env.DEV',
        '__APP_VERSION__': JSON.stringify(pkg.version),
        // pdev 变体标识，供运行时门控
        '__PDEV__': JSON.stringify(pdev),
    },
    optimizeDeps: {
    },
    plugins: [glslLoader(), filteredObfuscatorPlugin(pdev ? obfuscatorOptionsPdev : obfuscatorOptionsProd)]
    };
});
