
type FileType = 'model' | 'animation' | 'music' | 'environment';

const STORAGE_KEY = 'mikuplay_file_paths';

interface FilePathMemoryData {
    model?: string;
    animation?: string;
    music?: string;
    environment?: string;
}

class FilePathMemory {
    private static instance: FilePathMemory;
    private data: FilePathMemoryData = {};

    private constructor() {
        this.load();
    }

    static getInstance(): FilePathMemory {
        if (!FilePathMemory.instance) {
            FilePathMemory.instance = new FilePathMemory();
        }
        return FilePathMemory.instance;
    }

    static resetInstance(): void {
        FilePathMemory.instance = undefined as any;
    }

    private load(): void {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                this.data = JSON.parse(stored);
            }
        } catch (e) {
            console.error('加载文件路径记忆失败:', e);
            this.data = {};
        }
    }

    private save(): void {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.error('保存文件路径记忆失败:', e);
        }
    }

    getPath(type: FileType): string | undefined {
        return this.data[type];
    }

    setPath(type: FileType, path: string): void {
        this.data[type] = path;
        this.save();
    }

    clearPath(type: FileType): void {
        // 使用undefined替代delete，保持对象隐藏类稳定
        this.data[type] = undefined;
        this.save();
    }

    clearAll(): void {
        this.data = {};
        this.save();
    }
}

export const filePathMemory = FilePathMemory.getInstance();
export type { FileType };
