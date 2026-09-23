
/**
 * EnvironmentMapManager - 环境贴图管理器
 * 
 * 主要功能:
 * - 管理 HDR/EXR/PNG/JPG 等格式的环境贴图文件
 * - 提供环境贴图的导入、删除、列表查询功能
 * - 在移动设备上缓存环境贴图到本地存储
 * - 支持从文件路径或数据 Blob 导入环境贴图
 * 
 * 调用关系:
 * - 被 SceneManager 调用: 设置场景的环境贴图
 * - 被 UI 层调用: 环境贴图面板通过此管理器管理贴图资源
 * - 使用 Capacitor Filesystem API: 在移动设备上进行文件操作
 * 
 * 支持的格式: .hdr, .exr, .png, .jpg, .jpeg
 * 
 * 单例模式: 使用 getInstance() 获取唯一实例
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

/** 环境贴图项信息 */
export interface EnvironmentMapItem {
    name: string;
    path: string;
    size: number;
    lastModified: number;
}

/** 缓存的环境贴图元数据 */
export interface CachedEnvironmentMap {
    id: string;
    name: string;
    originalPath: string;
    cachedPath: string;
    size: number;
    cachedAt: number;
}

/** 缓存目录名称 */
const CACHE_DIR = 'environment_maps';
/** 缓存元数据文件名 */
const CACHE_METADATA_FILE = 'cache_metadata.json';
/** 支持的文件扩展名 */
const SUPPORTED_EXTENSIONS = ['.hdr', '.exr', '.png', '.jpg', '.jpeg'];

/**
 * 环境贴图管理器实现类
 */
class EnvironmentMapManagerImpl {
    private static instance: EnvironmentMapManagerImpl;
    private cacheMetadata: CachedEnvironmentMap[] = [];
    private initialized: boolean = false;

    private constructor() {}

    /**
     * 获取 EnvironmentMapManager 单例实例
     * @returns EnvironmentMapManagerImpl 实例
     */
    public static getInstance(): EnvironmentMapManagerImpl {
        if (!EnvironmentMapManagerImpl.instance) {
            EnvironmentMapManagerImpl.instance = new EnvironmentMapManagerImpl();
        }
        return EnvironmentMapManagerImpl.instance;
    }

    /**
     * 重置单例实例（用于测试或重新初始化）
     */
    public static resetInstance(): void {
        EnvironmentMapManagerImpl.instance = undefined as any;
    }

    /**
     * 初始化管理器
     * 确保缓存目录存在并加载缓存元数据
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.ensureCacheDirectory();
            await this.loadCacheMetadata();
            this.initialized = true;
        } catch (error) {
            console.error('初始化环境贴图管理器失败:', error);
        }
    }

    /**
     * 确保缓存目录存在
     * Web 平台跳过此步骤
     */
    private async ensureCacheDirectory(): Promise<void> {
        if (Capacitor.getPlatform() === 'web') {
            return;
        }

        try {
            await Filesystem.readdir({
                path: CACHE_DIR,
                directory: Directory.Data
            });
        } catch (error) {
            await Filesystem.mkdir({
                path: CACHE_DIR,
                directory: Directory.Data,
                recursive: true
            });
        }
    }

    /**
     * 加载缓存元数据
     * Web 平台返回空数组
     */
    private async loadCacheMetadata(): Promise<void> {
        if (Capacitor.getPlatform() === 'web') {
            this.cacheMetadata = [];
            return;
        }

        try {
            const result = await Filesystem.readFile({
                path: `${CACHE_DIR}/${CACHE_METADATA_FILE}`,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });
            this.cacheMetadata = JSON.parse(result.data as string);
        } catch (error) {
            this.cacheMetadata = [];
        }
    }

    /**
     * 保存缓存元数据到文件
     */
    private async saveCacheMetadata(): Promise<void> {
        if (Capacitor.getPlatform() === 'web') return;

        try {
            await Filesystem.writeFile({
                path: `${CACHE_DIR}/${CACHE_METADATA_FILE}`,
                directory: Directory.Data,
                data: JSON.stringify(this.cacheMetadata),
                encoding: Encoding.UTF8
            });
        } catch (error) {
            console.error('保存缓存元数据失败:', error);
        }
    }

    /**
     * 获取完整的缓存文件路径
     * 根据平台返回不同的路径格式
     * @param fileName - 文件名
     * @returns 完整路径
     */
    private async getFullCachePath(fileName: string): Promise<string> {
        if (Capacitor.getPlatform() === 'web') {
            return `${CACHE_DIR}/${fileName}`;
        }

        if (Capacitor.getPlatform() === 'android') {
            const result = await Filesystem.getUri({
                path: `${CACHE_DIR}/${fileName}`,
                directory: Directory.Data
            });
            return Capacitor.convertFileSrc(result.uri);
        }
        return `${CACHE_DIR}/${fileName}`;
    }

    /**
     * 获取文件扩展名
     * @param fileName - 文件名
     * @returns 扩展名（包含点）
     */
    private getExtension(fileName: string): string {
        const lastDot = fileName.lastIndexOf('.');
        return lastDot === -1 ? '' : fileName.slice(lastDot);
    }

    /**
     * 将 Blob 转换为 Base64 字符串
     * @param blob - Blob 对象
     * @returns Base64 字符串
     */
    private async blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result as string;
                const base64Data = base64.split(',')[1];
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * 将 ArrayBuffer 转换为 Base64 字符串
     * @param buffer - ArrayBuffer
     * @returns Base64 字符串
     */
    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        const bytes = new Uint8Array(buffer);
        // 分块处理优化：避免 O(n^2) 字符串拼接
        const chunkSize = 8192;
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            chunks.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
        }
        return btoa(chunks.join(''));
    }

    /**
     * 列出所有环境贴图
     * @returns 环境贴图项列表
     */
    public async listEnvironmentMaps(): Promise<EnvironmentMapItem[]> {
        if (Capacitor.getPlatform() === 'web') {
            return [];
        }

        await this.ensureCacheDirectory();

        try {
            const result = await Filesystem.readdir({
                path: CACHE_DIR,
                directory: Directory.Data
            });

            const items: EnvironmentMapItem[] = [];
            for (const file of result.files) {
                const ext = this.getExtension(file.name).toLowerCase();
                if (SUPPORTED_EXTENSIONS.includes(ext)) {
                    try {
                        const stat = await Filesystem.stat({
                            path: `${CACHE_DIR}/${file.name}`,
                            directory: Directory.Data
                        });
                        items.push({
                            name: file.name,
                            path: stat.uri || `${CACHE_DIR}/${file.name}`,
                            size: stat.size || 0,
                            lastModified: stat.mtime || Date.now()
                        });
                    } catch (e) {
                        console.error(`获取文件信息失败: ${file.name}`, e);
                    }
                }
            }

            return items.sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            console.error('读取环境贴图列表失败:', error);
            return [];
        }
    }

    /**
     * 导入环境贴图
     * 支持从文件路径或数据导入
     * 
     * @param sourceOrFilePath - 源文件路径或标识
     * @param fileNameOrName - 文件名或名称
     * @param data - 可选的数据（Blob、ArrayBuffer 或 Base64 字符串）
     * @returns 导入结果
     */
    public async importEnvironmentMap(
        sourceOrFilePath: string,
        fileNameOrName: string,
        data?: Blob | ArrayBuffer | string
    ): Promise<string | EnvironmentMapItem | null> {
        await this.initialize();

        if (data !== undefined) {
            return this.importFromData(sourceOrFilePath, fileNameOrName, data);
        } else {
            return this.importFromPath(sourceOrFilePath, fileNameOrName);
        }
    }

    /**
     * 从文件路径导入环境贴图
     * @param sourcePath - 源文件路径
     * @param fileName - 文件名
     * @returns 缓存后的文件路径
     */
    private async importFromPath(sourcePath: string, fileName: string): Promise<string | null> {
        try {
            const fileData = await Filesystem.readFile({
                path: sourcePath
            });

            const id = `env_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const cachedFileName = `${id}_${fileName}`;
            const cachedPath = `${CACHE_DIR}/${cachedFileName}`;

            await Filesystem.writeFile({
                path: cachedPath,
                directory: Directory.Data,
                data: fileData.data
            });

            const statResult = await Filesystem.stat({
                path: cachedPath,
                directory: Directory.Data
            });

            const cachedMap: CachedEnvironmentMap = {
                id,
                name: fileName,
                originalPath: sourcePath,
                cachedPath: cachedFileName,
                size: statResult.size || 0,
                cachedAt: Date.now()
            };

            this.cacheMetadata.push(cachedMap);
            await this.saveCacheMetadata();

            return await this.getFullCachePath(cachedFileName);
        } catch (error) {
            console.error('导入环境贴图失败:', error);
            return null;
        }
    }

    /**
     * 从数据导入环境贴图
     * @param filePath - 文件路径（用于标识）
     * @param fileName - 文件名
     * @param data - 数据（Blob、ArrayBuffer 或 Base64 字符串）
     * @returns 环境贴图项信息
     */
    private async importFromData(
        filePath: string,
        fileName: string,
        data: Blob | ArrayBuffer | string
    ): Promise<EnvironmentMapItem | null> {
        if (Capacitor.getPlatform() === 'web') {
            console.log('Web平台: 模拟导入环境贴图', fileName);
            return {
                name: fileName,
                path: `mock://${fileName}`,
                size: data instanceof Blob ? data.size : 0,
                lastModified: Date.now()
            };
        }

        await this.ensureCacheDirectory();

        try {
            const targetPath = `${CACHE_DIR}/${fileName}`;

            let base64Data: string;
            if (data instanceof Blob) {
                base64Data = await this.blobToBase64(data);
            } else if (data instanceof ArrayBuffer) {
                base64Data = this.arrayBufferToBase64(data);
            } else {
                base64Data = data;
            }

            await Filesystem.writeFile({
                path: targetPath,
                data: base64Data,
                directory: Directory.Data
            });

            const stat = await Filesystem.stat({
                path: targetPath,
                directory: Directory.Data
            });

            return {
                name: fileName,
                path: stat.uri || targetPath,
                size: stat.size || 0,
                lastModified: stat.mtime || Date.now()
            };
        } catch (error) {
            console.error('导入环境贴图失败:', error);
            return null;
        }
    }

    /**
     * 删除环境贴图
     * @param fileName - 文件名
     * @returns 是否删除成功
     */
    public async deleteEnvironmentMap(fileName: string): Promise<boolean> {
        if (Capacitor.getPlatform() === 'web') {
            console.log('Web平台: 模拟删除环境贴图', fileName);
            return true;
        }

        try {
            await Filesystem.deleteFile({
                path: `${CACHE_DIR}/${fileName}`,
                directory: Directory.Data
            });
            return true;
        } catch (error) {
            console.error('删除环境贴图失败:', error);
            return false;
        }
    }

    /**
     * 读取环境贴图文件内容
     * @param fileName - 文件名
     * @returns 文件内容（Base64）
     */
    public async readEnvironmentMap(fileName: string): Promise<string | null> {
        if (Capacitor.getPlatform() === 'web') {
            return null;
        }

        try {
            const result = await Filesystem.readFile({
                path: `${CACHE_DIR}/${fileName}`,
                directory: Directory.Data
            });
            return result.data as string;
        } catch (error) {
            console.error('读取环境贴图失败:', error);
            return null;
        }
    }

    /**
     * 获取环境贴图的 URI
     * @param fileName - 文件名
     * @returns 文件 URI
     */
    public async getEnvironmentMapUri(fileName: string): Promise<string | null> {
        if (Capacitor.getPlatform() === 'web') {
            return `mock://${fileName}`;
        }

        try {
            const stat = await Filesystem.stat({
                path: `${CACHE_DIR}/${fileName}`,
                directory: Directory.Data
            });
            return stat.uri || null;
        } catch (error) {
            console.error('获取环境贴图URI失败:', error);
            return null;
        }
    }

    /**
     * 获取所有缓存的环境贴图
     * @returns 缓存的环境贴图列表
     */
    public async getCachedMaps(): Promise<CachedEnvironmentMap[]> {
        await this.initialize();
        return [...this.cacheMetadata];
    }

    /**
     * 删除指定 ID 的缓存环境贴图
     * @param id - 缓存 ID
     * @returns 是否删除成功
     */
    public async deleteCachedMap(id: string): Promise<boolean> {
        await this.initialize();

        const index = this.cacheMetadata.findIndex(map => map.id === id);
        if (index === -1) return false;

        const map = this.cacheMetadata[index];

        try {
            await Filesystem.deleteFile({
                path: `${CACHE_DIR}/${map.cachedPath}`,
                directory: Directory.Data
            });

            this.cacheMetadata.splice(index, 1);
            await this.saveCacheMetadata();

            return true;
        } catch (error) {
            console.error('删除缓存环境贴图失败:', error);
            return false;
        }
    }

    /**
     * 清除所有缓存
     * @returns 是否清除成功
     */
    public async clearAllCache(): Promise<boolean> {
        await this.initialize();

        try {
            for (const map of this.cacheMetadata) {
                try {
                    await Filesystem.deleteFile({
                        path: `${CACHE_DIR}/${map.cachedPath}`,
                        directory: Directory.Data
                    });
                } catch (error) {
                    console.warn(`删除缓存文件失败: ${map.cachedPath}`, error);
                }
            }

            this.cacheMetadata = [];
            await this.saveCacheMetadata();

            return true;
        } catch (error) {
            console.error('清理缓存失败:', error);
            return false;
        }
    }

    /**
     * 获取缓存总大小
     * @returns 缓存总大小（字节）
     */
    public async getCacheSize(): Promise<number> {
        await this.initialize();
        return this.cacheMetadata.reduce((total, map) => total + map.size, 0);
    }

    /**
     * 根据 ID 获取缓存路径
     * @param id - 缓存 ID
     * @returns 完整缓存路径
     */
    public async getCachedPathById(id: string): Promise<string | null> {
        await this.initialize();

        const map = this.cacheMetadata.find(m => m.id === id);
        if (!map) return null;

        return await this.getFullCachePath(map.cachedPath);
    }
}

export const EnvironmentMapManager = EnvironmentMapManagerImpl;
export const environmentMapManager = EnvironmentMapManagerImpl.getInstance();
