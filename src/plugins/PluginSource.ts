import { Filesystem, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type { PluginManifest } from '../core/IPlugin';

/**
 * 插件来源抽象：统一"从哪里读插件"的接口。
 * - WebPluginSource: Vite dev server，经 HTTP fetch 从 testPlugins/ 读取
 * - NativePluginSource: pdev 变体，经 Capacitor Filesystem 扫描手机本地目录
 */
export interface PluginSource {
    /** 扫描并返回所有可用插件的 id 列表 */
    scanPluginIds(): Promise<string[]>;
    /** 读取指定插件的 manifest */
    readManifest(pluginId: string): Promise<PluginManifest>;
    /** 读取指定插件的 index.js 代码 */
    readCode(pluginId: string): Promise<string>;
    /** 获取指定插件的 assets 目录 URL（用于资源加载） */
    getAssetsDir(pluginId: string): Promise<string>;
}

// ─────────────────────────────────────────────
// Web 实现（Vite dev server，fetch testPlugins/）
// ─────────────────────────────────────────────

const DEV_PLUGINS_BASE_URL = './testPlugins';

export class WebPluginSource implements PluginSource {
    async scanPluginIds(): Promise<string[]> {
        try {
            const response = await fetch(`${DEV_PLUGINS_BASE_URL}/dev-plugins.json`);
            if (response.ok) {
                const index = await response.json() as { plugins: string[] };
                return index.plugins || [];
            }
        } catch {
            // 索引文件缺失，返回空列表
        }
        return [];
    }

    async readManifest(pluginId: string): Promise<PluginManifest> {
        const response = await fetch(`${DEV_PLUGINS_BASE_URL}/${pluginId}/manifest.json`);
        if (!response.ok) {
            throw new Error(`无法读取 manifest.json: ${response.status}`);
        }
        return response.json() as Promise<PluginManifest>;
    }

    async readCode(pluginId: string): Promise<string> {
        const response = await fetch(`${DEV_PLUGINS_BASE_URL}/${pluginId}/index.js`);
        if (!response.ok) {
            throw new Error(`无法读取 index.js: ${response.status}`);
        }
        return response.text();
    }

    async getAssetsDir(pluginId: string): Promise<string> {
        return `${DEV_PLUGINS_BASE_URL}/${pluginId}`;
    }
}

// ─────────────────────────────────────────────
// Native 实现（pdev 变体，Capacitor Filesystem 扫描手机本地目录）
// 目录: /storage/emulated/0/MikuPlay/PluginsDev/
// 每个子目录 = 一个插件，需包含 manifest.json + index.js
//
// 注意：不能用 directory: Directory.External —— 它在 Android 上映射到 app 私有外部目录
// （/storage/emulated/0/Android/data/<包名>/files/），并非共享存储根目录。
// 因此这里直接传绝对路径 /storage/emulated/0/MikuPlay/PluginsDev（省略 directory 参数）。
// 访问共享存储依赖 Manifest 中已声明的：
//   - MANAGE_EXTERNAL_STORAGE（Android 11+，需用户在系统设置授予"所有文件访问"）
//   - READ/WRITE_EXTERNAL_STORAGE + requestLegacyExternalStorage（Android 10）
// ─────────────────────────────────────────────

const PLUGINS_DEV_DIR = '/storage/emulated/0/MikuPlay/PluginsDev';

export class NativePluginSource implements PluginSource {
    /**
     * 扫描 /storage/emulated/0/MikuPlay/PluginsDev/ 下的子目录。
     * 每个子目录名作为 pluginId，需包含 manifest.json 才视为有效插件。
     */
    async scanPluginIds(): Promise<string[]> {
        if (!Capacitor.isNativePlatform()) return [];

        try {
            const result = await Filesystem.readdir({ path: PLUGINS_DEV_DIR });

            const pluginIds: string[] = [];
            for (const file of result.files) {
                if (file.type === 'directory') {
                    // 验证子目录中是否存在 manifest.json
                    try {
                        await Filesystem.stat({
                            path: `${PLUGINS_DEV_DIR}/${file.name}/manifest.json`,
                        });
                        pluginIds.push(file.name);
                    } catch {
                        // 子目录无 manifest.json，跳过
                    }
                }
            }
            return pluginIds;
        } catch (error) {
            console.error('[NativePluginSource] 扫描开发插件目录失败:', error);
            console.error(`[NativePluginSource] 目标目录: ${PLUGINS_DEV_DIR}/`);
            console.error(
                '[NativePluginSource] 若为权限错误：请到 系统设置 → 应用 → MikuPlay Reburn Dev → 权限 → 所有文件访问 中允许后重试；' +
                '若为目录不存在：请在手机存储创建 MikuPlay/PluginsDev/ 并把插件子目录放进去。'
            );
            return [];
        }
    }

    async readManifest(pluginId: string): Promise<PluginManifest> {
        const result = await Filesystem.readFile({
            path: `${PLUGINS_DEV_DIR}/${pluginId}/manifest.json`,
            encoding: Encoding.UTF8,
        });
        const data = typeof result.data === 'string' ? result.data : await blobToString(result.data);
        return JSON.parse(data) as PluginManifest;
    }

    async readCode(pluginId: string): Promise<string> {
        const result = await Filesystem.readFile({
            path: `${PLUGINS_DEV_DIR}/${pluginId}/index.js`,
            encoding: Encoding.UTF8,
        });
        return typeof result.data === 'string' ? result.data : await blobToString(result.data);
    }

    async getAssetsDir(pluginId: string): Promise<string> {
        try {
            const uriResult = await Filesystem.getUri({
                path: `${PLUGINS_DEV_DIR}/${pluginId}`,
            });
            return Capacitor.convertFileSrc(uriResult.uri);
        } catch {
            return '';
        }
    }
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function blobToString(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

/**
 * 根据运行环境选择合适的 PluginSource：
 * - __PDEV__ 且原生平台 → NativePluginSource（手机本地磁盘加载）
 * - Vite dev server（非原生） → WebPluginSource（testPlugins/ fetch）
 * - 其他 → null（不加载开发插件）
 */
export function createDevPluginSource(): PluginSource | null {
    // pdev 变体：原生平台用 NativePluginSource
    if (typeof __PDEV__ !== 'undefined' && __PDEV__ && Capacitor.isNativePlatform()) {
        return new NativePluginSource();
    }

    // Vite dev server：非原生平台用 WebPluginSource
    if (typeof import.meta.env !== 'undefined' && import.meta.env.DEV && !Capacitor.isNativePlatform()) {
        return new WebPluginSource();
    }

    return null;
}
