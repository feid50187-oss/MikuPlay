/**
 * 内容库 API 服务
 * 软件内部统一文件读写接口，所有素材都通过内容库访问
 * 对外作为软件与手机文件系统的主要通信通道
 */
import type { AssetCategory } from '../../UIComponents/featurePanels/contentLibrary';

export interface LibraryAsset {
    id: string;
    name: string;
    category: AssetCategory;
    path: string;
    size: number;
    addedAt: number;
    tags: string[];
    type: 'file' | 'folder';
}

export interface ScanResult {
    scanned: number;
    imported: number;
    errors: string[];
}

export class ContentLibraryApi {
    private static instance: ContentLibraryApi;
    private assets: Map<AssetCategory, LibraryAsset[]> = new Map();
    private readonly BASE_DIR = 'MikuPlay';

    private constructor() {
        this.loadIndex();
    }

    static getInstance(): ContentLibraryApi {
        if (!ContentLibraryApi.instance) {
            ContentLibraryApi.instance = new ContentLibraryApi();
        }
        return ContentLibraryApi.instance;
    }

    // ========== 基础 CRUD ==========

    /**
     * 列出指定分类的所有资产
     */
    listAssets(category: AssetCategory): LibraryAsset[] {
        return this.assets.get(category) || [];
    }

    /**
     * 列出所有资产
     */
    listAllAssets(): LibraryAsset[] {
        const all: LibraryAsset[] = [];
        this.assets.forEach(items => all.push(...items));
        return all;
    }

    /**
     * 获取资产信息
     */
    getAsset(id: string): LibraryAsset | null {
        for (const items of this.assets.values()) {
            const found = items.find(a => a.id === id);
            if (found) return found;
        }
        return null;
    }

    /**
     * 添加资产到内容库
     */
    async addAsset(
        file: File | Blob,
        category: AssetCategory,
        customName?: string
    ): Promise<LibraryAsset> {
        const name = customName || (file as File).name || `asset_${Date.now()}`;
        const ext = name.split('.').pop() || '';
        const assetId = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const path = `${this.BASE_DIR}/${this.getCategoryFolder(category)}/${name}`;

        // 保存文件到存储
        await this.saveFile(path, file);

        const asset: LibraryAsset = {
            id: assetId,
            name,
            category,
            path,
            size: file.size,
            addedAt: Date.now(),
            tags: [],
            type: 'file'
        };

        const list = this.assets.get(category) || [];
        list.push(asset);
        this.assets.set(category, list);
        this.saveIndex();

        return asset;
    }

    /**
     * 重命名资产
     */
    async renameAsset(id: string, newName: string): Promise<boolean> {
        const asset = this.getAsset(id);
        if (!asset) return false;

        const oldPath = asset.path;
        const newPath = `${this.BASE_DIR}/${this.getCategoryFolder(asset.category)}/${newName}`;

        // 移动文件
        await this.moveFile(oldPath, newPath);

        asset.name = newName;
        asset.path = newPath;
        this.saveIndex();
        return true;
    }

    /**
     * 删除资产
     */
    async deleteAsset(id: string): Promise<boolean> {
        const asset = this.getAsset(id);
        if (!asset) return false;

        await this.deleteFile(asset.path);

        const list = this.assets.get(asset.category);
        if (list) {
            const idx = list.findIndex(a => a.id === id);
            if (idx >= 0) list.splice(idx, 1);
        }
        this.saveIndex();
        return true;
    }

    // ========== 文件读写 ==========

    /**
     * 读取文件内容（供软件内部使用）
     */
    async readFile(path: string): Promise<ArrayBuffer> {
        // 优先从内容库读取
        try {
            const raw = localStorage.getItem(`file_${path}`);
            if (raw) {
                // base64 解码
                return this.base64ToArrayBuffer(raw);
            }
        } catch {}
        throw new Error(`文件不存在: ${path}`);
    }

    /**
     * 写入文件（供软件内部使用）
     */
    async writeFile(path: string, data: Blob | ArrayBuffer): Promise<void> {
        const blob = data instanceof Blob ? data : new Blob([data]);
        const base64 = await this.blobToBase64(blob);
        localStorage.setItem(`file_${path}`, base64);
    }

    /**
     * 导出视频（渲染完成后保存到内容库）
     */
    async saveRenderedVideo(blob: Blob, name: string): Promise<LibraryAsset> {
        return this.addAsset(blob, 'projects', name);
    }

    // ========== ZIP 解压 ==========

    /**
     * 解压 ZIP 文件，自动识别内容类型并分类
     */
    async extractZip(zipFile: File | Blob): Promise<ScanResult> {
        const result: ScanResult = { scanned: 0, imported: 0, errors: [] };

        try {
            // 动态加载 JSZip
            const JSZip = (await import('jszip')).default;
            const zip = await JSZip.loadAsync(zipFile);

            const files = Object.values(zip.files);
            result.scanned = files.length;

            for (const file of files) {
                if (file.dir) continue;

                try {
                    const data = await file.async('blob');
                    const category = this.guessCategoryByName(file.name);

                    if (category) {
                        await this.addAsset(data, category, file.name);
                        result.imported++;
                    }
                } catch (e) {
                    result.errors.push(`${file.name}: ${(e as Error).message}`);
                }
            }
        } catch (e) {
            result.errors.push(`ZIP 解压失败: ${(e as Error).message}`);
        }

        return result;
    }

    // ========== 扫描整理 ==========

    /**
     * 一键扫描指定目录，自动识别并整理文件
     */
    async scanDirectory(
        fileList: FileList | File[],
        onProgress?: (current: number, total: number) => void
    ): Promise<ScanResult> {
        const files = Array.from(fileList);
        const result: ScanResult = { scanned: files.length, imported: 0, errors: [] };

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            onProgress?.(i + 1, files.length);

            try {
                // 自动识别文件类型
                let category = this.guessCategoryByMime(file.type, file.name);

                if (category) {
                    await this.addAsset(file, category);
                    result.imported++;
                } else if (file.name.endsWith('.zip')) {
                    // ZIP 文件自动解压
                    const zipResult = await this.extractZip(file);
                    result.imported += zipResult.imported;
                    result.errors.push(...zipResult.errors);
                }
            } catch (e) {
                result.errors.push(`${file.name}: ${(e as Error).message}`);
            }
        }

        return result;
    }

    // ========== 预览 ==========

    /**
     * 获取图片预览 URL
     */
    async getImagePreview(assetId: string): Promise<string | null> {
        const asset = this.getAsset(assetId);
        if (!asset) return null;

        // 如果已经是 URL，直接返回
        if (asset.path.startsWith('http')) return asset.path;

        // 从存储读取
        try {
            const raw = localStorage.getItem(`file_${asset.path}`);
            if (raw) return raw; // base64 data URL
        } catch {}

        return null;
    }

    /**
     * 获取音乐预览 URL
     */
    async getAudioPreview(assetId: string): Promise<string | null> {
        return this.getImagePreview(assetId); // 同样用 base64 data URL
    }

    // ========== 插件通讯接口 ==========

    /**
     * 插件统一通讯接口
     * 插件通过此接口访问内容库
     */
    pluginApi = {
        /** 读取文件 */
        readFile: (path: string) => this.readFile(path),

        /** 写入文件 */
        writeFile: (path: string, data: Blob) => this.writeFile(path, data),

        /** 列出资产 */
        listAssets: (category: AssetCategory) => this.listAssets(category),

        /** 添加资产 */
        addAsset: (file: Blob, category: AssetCategory, name?: string) =>
            this.addAsset(file, category, name),

        /** 删除资产 */
        deleteAsset: (id: string) => this.deleteAsset(id),

        /** 重命名资产 */
        renameAsset: (id: string, name: string) => this.renameAsset(id, name),

        /** 获取预览 URL */
        getPreview: (id: string) => this.getImagePreview(id)
    };

    // ========== 内部方法 ==========

    private getCategoryFolder(cat: AssetCategory): string {
        const folders: Record<string, string> = {
            materials: 'Materials',
            textures: 'Textures',
            images: 'Images',
            lights: 'Lights',
            projects: 'Projects',
            logs: 'Logs',
            models: 'Models',
            music: 'Music',
            scenes: 'Scenes',
            motions: 'Motions',
            skyboxes: 'Skyboxes',
            videos: 'Videos'
        };
        return folders[cat] || 'Other';
    }

    private guessCategoryByName(name: string): AssetCategory | null {
        const lower = name.toLowerCase();

        if (lower.endsWith('.pmx') || lower.endsWith('.pmd')) return 'models';
        if (lower.endsWith('.vmd') || lower.endsWith('.vpd')) return 'motions';
        if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg')) return 'music';
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'textures';
        if (lower.endsWith('.mat') || lower.endsWith('.fx')) return 'materials';
        if (lower.endsWith('.json')) return 'projects';
        if (lower.endsWith('.log') || lower.endsWith('.txt')) return 'logs';
        if (lower.endsWith('.hdr')) return 'skyboxes';

        return null;
    }

    private guessCategoryByMime(mime: string, name: string): AssetCategory | null {
        if (mime.startsWith('image/')) return 'textures';
        if (mime.startsWith('audio/')) return 'music';
        if (mime.startsWith('video/')) return 'projects';
        return this.guessCategoryByName(name);
    }

    private async saveFile(path: string, data: Blob): Promise<void> {
        const base64 = await this.blobToBase64(data);
        localStorage.setItem(`file_${path}`, base64);
    }

    private async deleteFile(path: string): Promise<void> {
        localStorage.removeItem(`file_${path}`);
    }

    private async moveFile(from: string, to: string): Promise<void> {
        const data = localStorage.getItem(`file_${from}`);
        if (data) {
            localStorage.setItem(`file_${to}`, data);
            localStorage.removeItem(`file_${from}`);
        }
    }

    private loadIndex(): void {
        try {
            const raw = localStorage.getItem('contentLibrary_index');
            if (raw) {
                const data = JSON.parse(raw);
                (Object.keys(data) as AssetCategory[]).forEach(cat => {
                    this.assets.set(cat, data[cat]);
                });
            }
        } catch {}
    }

    private saveIndex(): void {
        const data: Record<string, LibraryAsset[]> = {};
        this.assets.forEach((items, cat) => {
            data[cat] = items;
        });
        localStorage.setItem('contentLibrary_index', JSON.stringify(data));
    }

    private async blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const base64Data = base64.split(',')[1] || base64;
        const binary = atob(base64Data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

// 全局单例
export const contentLibraryApi = ContentLibraryApi.getInstance();
