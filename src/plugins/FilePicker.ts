import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * FilePicker 模块 - 文件选择器
 *
 * 主要功能:
 * - 提供跨平台的文件浏览和选择功能（原生平台使用 Capacitor 插件，Web 平台使用 File System Access API）
 * - 支持文件过滤、目录导航、权限管理
 * - 管理文件元数据（大小、修改时间、MIME 类型等）
 *
 * 调用关系:
 * - 被 UI 层调用: 文件导入面板通过此模块浏览和选择文件
 * - 调用 Capacitor FilePicker 插件: 在 Android/iOS 平台执行文件操作
 * - 使用 File System Access API: 在 Web 平台执行文件操作
 *
 * 单例模式: 使用 getInstance() 获取唯一实例
 */

export interface FileItem {
    name: string;           // 文件名
    path: string;           // 文件路径
    isDirectory: boolean;   // 是否为目录
    size?: number;          // 文件大小（字节）
    lastModified?: number;  // 最后修改时间戳
    extension?: string;     // 文件扩展名
    mimeType?: string;      // MIME 类型
    fileUrl?: string;       // Web 平台 Blob URL
}

export interface FilePickerOptions {
    startPath?: string;     // 起始路径
    fileFilter?: string[];  // 文件扩展名过滤列表
    enableFilter?: boolean; // 是否启用过滤
}

export interface FilePickerPlugin {
    checkPermissions(): Promise<{ granted: boolean; needRequest: boolean }>;
    requestPermissions(): Promise<{ granted: boolean }>;
    listFiles(options: { path: string }): Promise<{ files: FileItem[] }>;
    getParentPath(options: { path: string }): Promise<{ parentPath: string }>;
    readFile(options: { path: string }): Promise<{ data: string; mimeType: string }>;
}

const FilePickerPlugin = registerPlugin<FilePickerPlugin>('FilePicker');
const ROOT_PATH = '/storage/emulated/0';

export class FilePicker {
    private static instance: FilePicker;
    private currentPath: string = ROOT_PATH;
    private fileFilter: string[] = [];
    private enableFilter: boolean = false;

    // Web 平台状态
    private webRootHandle: FileSystemDirectoryHandle | null = null;
    private webDirStack: Array<{ handle: FileSystemDirectoryHandle; path: string }> = [];
    private webBlobUrlCache: Map<string, string> = new Map();
    private webIsInitialized: boolean = false;

    private constructor() {}

    /** 获取 FilePicker 单例实例 */
    public static getInstance(): FilePicker {
        if (!FilePicker.instance) {
            FilePicker.instance = new FilePicker();
        }
        return FilePicker.instance;
    }

    /** 重置单例实例，释放资源 */
    public static resetInstance(): void {
        if (FilePicker.instance) {
            FilePicker.instance.revokeWebBlobUrls();
        }
        FilePicker.instance = undefined as any;
    }

    /** 判断当前是否为 Web 平台 */
    private isWebPlatform(): boolean {
        const platform = Capacitor.getPlatform();
        return platform === 'web' || platform === 'windows';
    }

    /** 设置文件过滤器（扩展名列表） */
    public setFileFilter(extensions: string[]): void {
        this.fileFilter = extensions;
        this.enableFilter = true;
    }

    /** 启用或禁用文件过滤 */
    public enableFileFilter(enable: boolean): void {
        this.enableFilter = enable;
    }

    /** 清除文件过滤器 */
    public clearFileFilter(): void {
        this.fileFilter = [];
        this.enableFilter = false;
    }

    /** 检查文件访问权限 */
    public async checkPermissions(): Promise<boolean> {
        if (this.isWebPlatform()) return true;

        try {
            const result = await FilePickerPlugin.checkPermissions();
            return result.granted;
        } catch (error) {
            return false;
        }
    }

    /** 请求文件访问权限 */
    public async requestPermissions(): Promise<boolean> {
        if (this.isWebPlatform()) return true;

        try {
            const result = await FilePickerPlugin.requestPermissions();
            return result.granted;
        } catch (error) {
            return false;
        }
    }

    /** 列出指定路径下的文件列表 */
    public async listFiles(path?: string): Promise<FileItem[]> {
        const targetPath = path || this.currentPath;

        if (this.isWebPlatform()) {
            return this.listFilesWeb(targetPath);
        }

        try {
            const result = await FilePickerPlugin.listFiles({ path: targetPath });
            let files = result.files;
            files = this.processFileList(files);
            return files;
        } catch (error) {
            return [];
        }
    }

    /** 处理文件列表：应用过滤器、排序、添加 MIME 类型 */
    private processFileList(files: FileItem[]): FileItem[] {
        if (this.enableFilter && this.fileFilter.length > 0) {
            files = files.filter(file => {
                if (file.isDirectory) return true;
                const ext = file.extension?.toLowerCase();
                return ext && this.fileFilter.map(f => f.toLowerCase()).includes(ext);
            });
        }

        files.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        files = files.map(file => this.addMimeType(file));
        return files;
    }

    /** 导航到指定路径 */
    public async navigateTo(path: string): Promise<FileItem[]> {
        if (this.isWebPlatform()) {
            const handle = await this.resolveDirectoryHandle(path);
            if (handle) {
                this.webDirStack.push({ handle, path });
            }
            this.currentPath = path;
            return this.listFilesWeb(path);
        }

        this.currentPath = path;
        return this.listFiles(path);
    }

    /** 导航到父目录 */
    public async navigateUp(): Promise<{ path: string; files: FileItem[] } | null> {
        if (this.isWebPlatform()) {
            if (this.webDirStack.length === 0) return null;

            this.webDirStack.pop();
            const parent = this.webDirStack.length > 0
                ? this.webDirStack[this.webDirStack.length - 1]
                : { handle: this.webRootHandle!, path: this.getWebRootPath() };
            this.currentPath = parent.path;
            const files = await this.listFilesWeb(parent.path);
            return { path: parent.path, files };
        }

        if (this.currentPath === ROOT_PATH) return null;

        try {
            const result = await FilePickerPlugin.getParentPath({ path: this.currentPath });
            const parentPath = result.parentPath || ROOT_PATH;
            const files = await this.navigateTo(parentPath);
            return { path: parentPath, files };
        } catch (error) {
            return null;
        }
    }

    /** 获取当前路径 */
    public getCurrentPath(): string {
        return this.currentPath;
    }

    /** 读取文件内容 */
    public async readFile(path: string): Promise<{ data: string; mimeType: string } | null> {
        if (this.isWebPlatform()) {
            try {
                const url = this.webBlobUrlCache.get(path);
                if (url) {
                    const response = await fetch(url);
                    const blob = await response.blob();
                    const data = await blob.text();
                    return { data, mimeType: blob.type || 'application/octet-stream' };
                }
                return { data: '', mimeType: 'application/octet-stream' };
            } catch {
                return null;
            }
        }

        try {
            const result = await FilePickerPlugin.readFile({ path });
            return result;
        } catch (error) {
            return null;
        }
    }

    /** 判断当前是否在根目录 */
    public isRootPath(): boolean {
        if (this.isWebPlatform()) {
            return this.webDirStack.length === 0;
        }
        return this.currentPath === ROOT_PATH;
    }

    /** 获取根目录路径 */
    public getRootPath(): string {
        if (this.isWebPlatform() && this.webRootHandle) {
            return this.getWebRootPath();
        }
        return ROOT_PATH;
    }

    /** 判断 Web 平台是否已选择根目录 */
    public isWebRootSelected(): boolean {
        if (!this.isWebPlatform()) return true;
        return this.webRootHandle !== null;
    }

    /** Web 平台选择根目录 */
    public async selectWebRootDirectory(): Promise<boolean> {
        if (!this.isWebPlatform()) return false;

        try {
            if (!('showDirectoryPicker' in window)) {
                console.error('File System Access API 不可用，请使用 Chrome 或 Edge 浏览器');
                return false;
            }

            this.webRootHandle = await (window as any).showDirectoryPicker();
            this.webDirStack = [];
            this.revokeWebBlobUrls();
            this.currentPath = this.getWebRootPath();
            this.webIsInitialized = true;
            return true;
        } catch (error) {
            if ((error as DOMException).name === 'AbortError') {
                return false;
            }
            console.error('选择目录失败:', error);
            return false;
        }
    }

    /** 获取 Web 根目录名称 */
    public getWebRootName(): string {
        return this.webRootHandle?.name || '';
    }

    /** 设置起始路径 */
    public async setStartPath(path: string): Promise<boolean> {
        if (this.isWebPlatform()) {
            if (!this.webRootHandle) return false;
            const handle = await this.resolveDirectoryHandle(path);
            if (handle) {
                this.currentPath = path;
                this.rebuildWebStack(path);
                return true;
            }
            return false;
        }

        try {
            const files = await this.listFiles(path);
            if (files.length >= 0) {
                this.currentPath = path;
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    //region Web implementation

    /** 获取 Web 根目录路径 */
    private getWebRootPath(): string {
        return this.webRootHandle ? `/${this.webRootHandle.name}` : '';
    }

    /** Web 平台列出文件 */
    private async listFilesWeb(path: string): Promise<FileItem[]> {
        if (!this.webRootHandle) return [];

        const handle = await this.resolveDirectoryHandle(path);
        if (!handle) return [];

        const fileItems: FileItem[] = [];

        try {
            for await (const entry of handle.values()) {
                const item: FileItem = {
                    name: entry.name,
                    path: `${path}/${entry.name}`,
                    isDirectory: entry.kind === 'directory',
                };

                if (entry.kind === 'file') {
                    const nameParts = entry.name.split('.');
                    item.extension = nameParts.length > 1 ? nameParts.pop()?.toLowerCase() : '';
                    const fileHandle = entry as FileSystemFileHandle;
                    item.fileUrl = await this.getOrCreateBlobUrl(item.path, fileHandle);

                    try {
                        const file = await fileHandle.getFile();
                        item.size = file.size;
                        item.lastModified = file.lastModified;
                    } catch {
                        // file metadata unavailable
                    }
                }

                fileItems.push(item);
            }
        } catch (error) {
            console.error('读取目录失败:', error);
            return [];
        }

        return this.processFileList(fileItems);
    }

    /** 获取或创建 Blob URL */
    private async getOrCreateBlobUrl(path: string, handle: FileSystemFileHandle): Promise<string> {
        if (this.webBlobUrlCache.has(path)) {
            return this.webBlobUrlCache.get(path)!;
        }
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        this.webBlobUrlCache.set(path, url);
        return url;
    }

    /** 解析路径获取目录句柄 */
    private async resolveDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle | null> {
        if (!this.webRootHandle) return null;

        const rootPath = this.getWebRootPath();

        if (path === rootPath || path === '') {
            return this.webRootHandle;
        }

        const stackEntry = this.webDirStack.find(e => e.path === path);
        if (stackEntry) return stackEntry.handle;

        const relativePath = path.startsWith(rootPath)
            ? path.slice(rootPath.length)
            : path;
        const segments = relativePath.split('/').filter(s => s.length > 0);

        if (segments.length === 0) return this.webRootHandle;

        let currentHandle = this.webRootHandle;
        for (const segment of segments) {
            try {
                currentHandle = await currentHandle.getDirectoryHandle(segment);
            } catch {
                return null;
            }
        }
        return currentHandle;
    }

    /** 重建 Web 目录栈 */
    private async rebuildWebStack(path: string): Promise<void> {
        if (!this.webRootHandle) return;

        this.webDirStack = [];
        const rootPath = this.getWebRootPath();

        if (path === rootPath) return;

        const relativePath = path.startsWith(rootPath)
            ? path.slice(rootPath.length)
            : path;
        const segments = relativePath.split('/').filter(s => s.length > 0);

        let currentHandle = this.webRootHandle;
        let currentPath = rootPath;

        for (const segment of segments) {
            try {
                currentHandle = await currentHandle.getDirectoryHandle(segment);
                currentPath = `${currentPath}/${segment}`;
                this.webDirStack.push({ handle: currentHandle, path: currentPath });
            } catch {
                break;
            }
        }
    }

    /** 释放所有 Blob URL */
    public revokeWebBlobUrls(): void {
        for (const url of this.webBlobUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.webBlobUrlCache.clear();
    }

    //endregion

    //region MIME types

    /** 根据扩展名获取 MIME 类型 */
    private getMimeType(extension: string): string {
        const mimeTypes: { [key: string]: string } = {
            'pmx': 'application/x-pmx',
            'pmd': 'application/x-pmd',
            'bpmx': 'application/x-bpmx',
            'vmd': 'application/x-vmd',
            'vpd': 'application/x-vpd',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'flac': 'audio/flac',
            'm4a': 'audio/mp4',
            'aac': 'audio/aac',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'bmp': 'image/bmp',
            'tga': 'image/targa',
            'txt': 'text/plain',
            'json': 'application/json',
            'xml': 'application/xml'
        };
        return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
    }

    /** 为文件项添加 MIME 类型 */
    private addMimeType(file: FileItem): FileItem {
        if (!file.isDirectory && file.extension) {
            file.mimeType = this.getMimeType(file.extension);
        }
        return file;
    }

    //endregion
}
