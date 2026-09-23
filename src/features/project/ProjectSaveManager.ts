import type { ProjectArchive, RestoreReport } from './ProjectArchive';
import { collectArchive, type ProjectCollectorDeps } from './ProjectCollector';
import { restoreArchive, type ProjectRestorerDeps } from './ProjectRestorer';
import { validateArchive } from './ProjectValidator';
import { Filesystem, Directory } from '@capacitor/filesystem';

/** 存档目录名 */
const ARCHIVE_DIR = 'MikuPlay/Projections';
/** 存档文件扩展名 */
const ARCHIVE_EXT = '.mikuproj';

export interface ArchiveItem {
    name: string;
    filePath: string;
    createdAt?: string;
    modelCount?: number;
    corrupt: boolean;
}

/**
 * 工程存档管理器
 * 负责保存、读取、删除存档文件
 */
export class ProjectSaveManager {
    private static instance: ProjectSaveManager;
    private collectorDeps: ProjectCollectorDeps | null = null;
    private restorerDeps: ProjectRestorerDeps | null = null;

    private constructor() {}

    public static getInstance(): ProjectSaveManager {
        if (!ProjectSaveManager.instance) {
            ProjectSaveManager.instance = new ProjectSaveManager();
        }
        return ProjectSaveManager.instance;
    }

    public static resetInstance(): void {
        ProjectSaveManager.instance = undefined as any;
    }

    /**
     * 初始化依赖
     */
    public initialize(deps: ProjectCollectorDeps & ProjectRestorerDeps): void {
        this.collectorDeps = deps;
        this.restorerDeps = deps;
    }

    /**
     * 收集当前状态为 ProjectArchive
     */
    public collectArchive(name?: string): ProjectArchive {
        if (!this.collectorDeps) {
            throw new Error('ProjectSaveManager 未初始化');
        }
        return collectArchive(this.collectorDeps, name);
    }

    /**
     * 保存工程到文件
     */
    public async saveToFile(name?: string): Promise<string> {
        const archive = this.collectArchive(name);
        const json = JSON.stringify(archive, null, 2);

        // 确保目录存在
        await this.ensureArchiveDir();

        // 文件名：工程名.mikuproj
        const safeName = (name || archive.name || `工程_${new Date().toLocaleDateString()}`).replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `${safeName}${ARCHIVE_EXT}`;
        const filePath = `${ARCHIVE_DIR}/${fileName}`;

        // 直接写入原始 JSON（方便 debug 直接查看文件内容）
        await Filesystem.writeFile({
            path: filePath,
            directory: Directory.ExternalStorage,
            data: json,
            encoding: 'utf8' as any,
            recursive: true
        });

        return filePath;
    }

    /**
     * 从文件恢复
     */
    public async restoreFromFile(filePath: string): Promise<RestoreReport> {
        if (!this.restorerDeps) {
            throw new Error('ProjectSaveManager 未初始化');
        }

        const archive = await this.readArchiveFile(filePath);

        const validation = validateArchive(archive);
        if (!validation.valid) {
            throw new Error(`存档文件损坏:\n${validation.errors.join('\n')}`);
        }

        return restoreArchive(archive, this.restorerDeps);
    }

    /**
     * 应用 ProjectArchive 恢复状态
     */
    public async restore(archive: ProjectArchive): Promise<RestoreReport> {
        if (!this.restorerDeps) {
            throw new Error('ProjectSaveManager 未初始化');
        }
        return restoreArchive(archive, this.restorerDeps);
    }

    /**
     * 列出存档目录中所有存档文件
     */
    public async listArchives(): Promise<ArchiveItem[]> {
        const result: ArchiveItem[] = [];

        try {
            const dirResult = await Filesystem.readdir({
                path: ARCHIVE_DIR,
                directory: Directory.ExternalStorage
            });

            for (const file of dirResult.files) {
                if (file.name.endsWith(ARCHIVE_EXT)) {
                    const filePath = `${ARCHIVE_DIR}/${file.name}`;
                    try {
                        const archive = await this.readArchiveFile(filePath);
                        result.push({
                            name: archive.name || file.name.replace(ARCHIVE_EXT, ''),
                            filePath,
                            createdAt: archive.createdAt,
                            modelCount: archive.models?.models?.length ?? 0,
                            corrupt: false
                        });
                    } catch {
                        const name = file.name.replace(ARCHIVE_EXT, '');
                        result.push({
                            name,
                            filePath,
                            corrupt: true
                        });
                    }
                }
            }

            // 有效存档按时间降序，损坏的排在最后
            const valid = result.filter(r => !r.corrupt);
            valid.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
            const corrupt = result.filter(r => r.corrupt);
            return [...valid, ...corrupt];
        } catch {
            // 目录不存在或读取失败
        }

        return result;
    }

    /**
     * 删除存档文件
     */
    public async deleteArchive(filePath: string): Promise<void> {
        await Filesystem.deleteFile({
            path: filePath,
            directory: Directory.ExternalStorage
        });
    }

    /**
     * 将恢复过程中的警告/错误信息保存到工程文件夹
     * 文件名格式：错误信息MMDDHHMMSS.txt
     */
    public async saveErrorLog(report: RestoreReport, sourceFileName: string): Promise<void> {
        const now = new Date();
        const ts = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const fileName = `错误信息${ts}.txt`;
        const filePath = `${ARCHIVE_DIR}/${fileName}`;

        const lines: string[] = [];

        // 头部信息
        lines.push('========================================');
        lines.push(`  错误信息 - 生成时间: ${now.toLocaleString()}`);
        lines.push(`  来源存档: ${sourceFileName}`);
        lines.push(`  恢复状态: ${report.success ? '成功' : '部分失败'}`);
        lines.push(`  恢复模型: ${report.restoredModels}`);
        lines.push(`  恢复动画: ${report.restoredAnimations}`);
        lines.push(`  警告/错误数: ${report.warnings.length}`);

        // 缺失文件
        if (report.missingFiles.length > 0) {
            lines.push('----------------------------------------');
            lines.push('  缺失文件:');
            for (const mf of report.missingFiles) {
                lines.push(`    [${mf.type}] ${mf.name} (${mf.filePath})`);
            }
        }

        // 警告详情
        if (report.warnings.length > 0) {
            lines.push('----------------------------------------');
            lines.push('  警告/错误详情:');
            for (const w of report.warnings) {
                lines.push(`    ${w}`);
            }
        }

        lines.push('========================================');

        await Filesystem.writeFile({
            path: filePath,
            directory: Directory.ExternalStorage,
            data: lines.join('\n'),
            encoding: 'utf8' as any,
            recursive: true
        });
    }

    /**
     * 读取并解析存档文件
     */
    private async readArchiveFile(filePath: string): Promise<ProjectArchive> {
        const result = await Filesystem.readFile({
            path: filePath,
            directory: Directory.ExternalStorage,
            encoding: 'utf8' as any
        });

        let json: string;
        if (typeof result.data === 'string') {
            // 优先按原始 JSON 解析（新格式），失败则尝试 base64 解码（兼容旧存档）
            if (result.data.startsWith('{')) {
                json = result.data;
            } else {
                try {
                    json = decodeURIComponent(escape(atob(result.data)));
                } catch {
                    json = result.data;
                }
            }
        } else {
            throw new Error('存档文件读取失败：不支持的数据格式');
        }

        const parsed = JSON.parse(json);
        const validation = validateArchive(parsed);
        if (!validation.valid) {
            throw new Error(`存档校验失败: ${validation.errors.join('; ')}`);
        }

        return parsed as ProjectArchive;
    }

    /**
     * 确保存档目录存在
     */
    private async ensureArchiveDir(): Promise<void> {
        try {
            await Filesystem.mkdir({
                path: ARCHIVE_DIR,
                directory: Directory.ExternalStorage,
                recursive: true
            });
        } catch {
            // 目录已存在，忽略
        }
    }

    /**
     * 获取存档目录路径
     */
    public getArchiveDir(): string {
        return ARCHIVE_DIR;
    }
}
