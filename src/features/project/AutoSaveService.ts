/**
 * 自动存档服务
 * - 每隔 X 分钟自动保存当前工程（自动替换的临时存档）
 * - 开始渲染视频时立即自动保存一份临时存档
 * - 手动存档/读取
 * - 所有存档统一放在内容库 Projects/ 目录
 */
import { ProjectSaveManager } from './ProjectSaveManager';
import { contentLibraryApi } from '../library/ContentLibraryApi';

export type AutoSaveInterval = 0 | 5 | 10; // 0=关闭

export interface AutoSaveStatus {
    enabled: boolean;
    interval: AutoSaveInterval;
    lastSaveTime: number | null;
    nextSaveIn: number | null; // 秒
    tempSavePath: string | null; // 自动保存的临时存档路径
}

export class AutoSaveService {
    private static instance: AutoSaveService;
    private saveManager: ProjectSaveManager | null = null;
    private timer: number | null = null;
    private status: AutoSaveStatus = {
        enabled: false,
        interval: 0,
        lastSaveTime: null,
        nextSaveIn: null,
        tempSavePath: null
    };

    private constructor() {}

    static getInstance(): AutoSaveService {
        if (!AutoSaveService.instance) {
            AutoSaveService.instance = new AutoSaveService();
        }
        return AutoSaveService.instance;
    }

    /**
     * 初始化（注入 ProjectSaveManager）
     */
    initialize(saveManager: ProjectSaveManager): void {
        this.saveManager = saveManager;
        this.loadSettings();
    }

    /**
     * 设置自动保存间隔
     * @param interval 分钟数（0=关闭，5=5分钟，10=10分钟）
     */
    setInterval(interval: AutoSaveInterval): void {
        this.status.interval = interval;
        this.status.enabled = interval > 0;

        this.stopTimer();
        if (this.status.enabled) {
            this.startTimer();
        }

        this.saveSettings();
    }

    /**
     * 获取当前状态
     */
    getStatus(): AutoSaveStatus {
        return { ...this.status };
    }

    /**
     * 手动保存
     * @param name 存档名称
     */
    async manualSave(name?: string): Promise<string> {
        if (!this.saveManager) {
            throw new Error('AutoSaveService 未初始化');
        }
        const path = await this.saveManager.saveToFile(name);
        this.status.lastSaveTime = Date.now();
        return path;
    }

    /**
     * 自动保存（临时存档，自动替换）
     */
    async autoSave(): Promise<string> {
        if (!this.saveManager) {
            throw new Error('AutoSaveService 未初始化');
        }

        const tempName = `自动存档_${new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).replace(/[\/:]/g, '-')}`;

        const path = await this.saveManager.saveToFile(tempName);
        this.status.tempSavePath = path;
        this.status.lastSaveTime = Date.now();

        // 同步到内容库
        try {
            const { Filesystem, Directory } = await import('@capacitor/filesystem');
            const data = await Filesystem.readFile({
                path,
                directory: Directory.ExternalStorage
            });
            const blob = new Blob([data.data], { type: 'application/json' });
            await contentLibraryApi.addAsset(blob, 'projects', `${tempName}.mikuproj`);
        } catch (e) {
            console.warn('[AutoSave] 同步到内容库失败:', e);
        }

        console.log('[AutoSave] 自动保存完成:', path);
        return path;
    }

    /**
     * 开始渲染视频时立即保存（强制）
     */
    async saveBeforeRender(): Promise<string> {
        const path = await this.autoSave();
        console.log('[AutoSave] 渲染前自动保存完成');
        return path;
    }

    /**
     * 列出所有存档
     */
    async listArchives() {
        if (!this.saveManager) return [];
        return this.saveManager.listArchives();
    }

    /**
     * 读取存档
     */
    async loadArchive(filePath: string) {
        if (!this.saveManager) {
            throw new Error('AutoSaveService 未初始化');
        }
        return this.saveManager.restoreFromFile(filePath);
    }

    /**
     * 删除存档
     */
    async deleteArchive(filePath: string) {
        if (!this.saveManager) return;
        await this.saveManager.deleteArchive(filePath);
    }

    // ========== 内部方法 ==========

    private startTimer(): void {
        if (this.timer) this.stopTimer();

        const ms = this.status.interval * 60 * 1000;
        this.timer = window.setInterval(() => {
            this.autoSave().catch(e => {
                console.error('[AutoSave] 自动保存失败:', e);
            });
        }, ms);

        console.log(`[AutoSave] 自动保存已启动，间隔 ${this.status.interval} 分钟`);
    }

    private stopTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private saveSettings(): void {
        localStorage.setItem('autoSave_settings', JSON.stringify({
            interval: this.status.interval
        }));
    }

    private loadSettings(): void {
        try {
            const raw = localStorage.getItem('autoSave_settings');
            if (raw) {
                const data = JSON.parse(raw);
                this.setInterval(data.interval || 0);
            }
        } catch {}
    }

    dispose(): void {
        this.stopTimer();
    }
}

export const autoSaveService = AutoSaveService.getInstance();
