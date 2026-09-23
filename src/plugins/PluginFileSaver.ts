import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

// 插件输出目录（外部存储/内部共享存储的 MikuPlay 文件夹，与 ProjectSaveManager 的 MikuPlay/Projections 同级，
// 用户可通过文件管理器直接访问）
const PLUGIN_OUTPUT_EXTERNAL_DIR = 'MikuPlay/PluginOutput';

/** 插件文件保存的入参 */
export interface PluginFileSaveOptions {
    /** 要保存的文件内容（推荐传 Blob；也可传裸 base64 字符串）。与 dataProducer 二选一 */
    data?: Blob | string;
    /** 惰性数据生成器：宿主弹窗确认后才会调用，用于避免昂贵的编码（如 8K 图 toBlob）阻塞确认框弹出 */
    dataProducer?: () => Blob | string | Promise<Blob | string>;
    /** 建议文件名（宿主会做安全化处理） */
    filename?: string;
    /** MIME 类型，用于在文件名缺扩展名时兜底补全，如 image/png */
    mime?: string;
}

/** 插件文件保存的结果 */
export interface PluginFileSaveResult {
    ok: boolean;
    /** 用户拒绝保存时为 true */
    canceled?: boolean;
    /** 保存后的相对路径（原生平台） */
    path?: string;
    /** 可访问的 URI（原生平台经 convertFileSrc） */
    uri?: string;
    /** 实际落盘/下载的文件名 */
    filename?: string;
    /** 失败原因（ok 为 false 时） */
    reason?: string;
}

/**
 * 插件文件保存桥（黑名单模式下唯一的写文件入口）。
 * 设计：
 *  - 插件无文件系统权限，仅能发起保存请求；
 *  - 宿主先弹窗询问，用户同意后才允许落盘；
 *  - 写入限定在内部存储/共享存储的 `MikuPlay/PluginOutput/<pluginId>/` 下，只新增、绝不覆盖或修改已有文件，
 *    无删除/修改/运行权限。
 * 性能：确认框在所有昂贵操作（数据生成/编码）之前弹出；原生端写入需 base64，
 * 由宿主在确认后统一转换。
 */
export class PluginFileSaver {
    async save(
        pluginId: string,
        pluginName: string,
        options: PluginFileSaveOptions
    ): Promise<PluginFileSaveResult> {
        // 惰性加载确认框，避免在构造阶段引入 shared 依赖
        const { showConfirmDialog } = await import('../UIComponents/shared');
        const eagerData = options?.data;
        const dataProducer = options?.dataProducer;
        if (eagerData == null && typeof dataProducer !== 'function') {
            return { ok: false, reason: '缺少文件数据' };
        }
        const safeName = this.sanitizeFilename(options?.filename || '', options?.mime);
        if (!safeName) {
            return { ok: false, reason: '非法文件名' };
        }

        // 1) 用户确认（先弹窗，避免昂贵编码阻塞对话框弹出）
        const confirmed = await showConfirmDialog({
            title: '插件请求保存文件',
            message: `插件「${pluginName || pluginId || '未知'}」请求保存文件：\n${safeName}\n\n是否允许？`,
            confirmText: '允许保存',
            cancelText: '拒绝',
        });
        if (!confirmed) {
            return { ok: false, canceled: true, reason: '用户拒绝保存' };
        }

        // 2) 用户同意后才取数据（惰性生成）
        // 顶部已保证：eagerData==null 时 dataProducer 必为函数
        let data: Blob | string;
        try {
            data = eagerData != null ? eagerData : (await dataProducer!());
        } catch (e) {
            return { ok: false, reason: '生成文件数据失败：' + ((e as Error)?.message || '') };
        }
        if (data == null) {
            return { ok: false, reason: '缺少文件数据' };
        }

        // Web 开发环境：确认后直接触发浏览器下载（Capacitor Web 的 Filesystem 只是浏览器虚拟 FS，用户无法直接获取）
        if (!Capacitor.isNativePlatform()) {
            let blob: Blob;
            if (data instanceof Blob) {
                blob = data;
            } else if (typeof data === 'string') {
                blob = new Blob([data], { type: options?.mime || 'application/octet-stream' });
            } else {
                return { ok: false, reason: '不支持的数据类型' };
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = safeName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return { ok: true, filename: safeName };
        }

        // 3) 原生平台：先把数据转成 base64（Filesystem.writeFile 原生端只接受 base64 字符串），
        //    再安全写入到内部存储/共享存储的 MikuPlay 目录（用户可直接访问，仅新增不覆盖）。
        //    注：不再做存储权限检测——插件能获取到材质的贴图必然已导入过模型，导入时
        //    FilePicker 已授予"所有文件访问"权限。
        let payload: string;
        try {
            payload = await this.toBase64(data);
        } catch (e) {
            return { ok: false, reason: '文件数据转换失败：' + ((e as Error)?.message || '') };
        }
        const dirPath = `${PLUGIN_OUTPUT_EXTERNAL_DIR}/${this.sanitizePluginId(pluginId)}`;
        let targetPath = `${dirPath}/${safeName}`;
        for (let i = 1; i < 1000; i++) {
            if (!(await this.fileExists(targetPath, Directory.ExternalStorage))) break;
            targetPath = `${dirPath}/${this.injectSuffix(safeName, i)}`;
        }
        try {
            const res = await Filesystem.writeFile({
                path: targetPath,
                directory: Directory.ExternalStorage,
                data: payload,
                recursive: true,
            });
            const uri = res?.uri ? Capacitor.convertFileSrc(res.uri) : '';
            return { ok: true, path: targetPath, uri, filename: targetPath.split('/').pop() };
        } catch (e) {
            return { ok: false, reason: (e as Error)?.message || '写入失败' };
        }
    }

    /** 将 Blob 或 base64 字符串统一转成裸 base64 字符串（原生 Filesystem.writeFile 需要） */
    private toBase64(data: Blob | string): Promise<string> {
        if (typeof data === 'string') {
            // 若是 dataURL（含前缀），剥离前缀；否则视为裸 base64
            const comma = data.indexOf(',');
            if (comma >= 0 && data.slice(0, comma).toLowerCase().includes('base64')) {
                return Promise.resolve(data.slice(comma + 1));
            }
            return Promise.resolve(data);
        }
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                const comma = result.indexOf(',');
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
            reader.readAsDataURL(data);
        });
    }

    /** 安全化文件名：剥离路径分隔符，拒绝 '..' 与危险字符 */
    private sanitizeFilename(name: string, mime?: string): string {
        const base = (name || '').split(/[\\/]/).pop() || '';
        const cleaned = base
            .replace(/[^A-Za-z0-9._\-\u4e00-\u9fa5]+/g, '_')
            .replace(/^\.+|\.+$/g, '');
        if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.includes('..')) {
            // 文件名非法，尝试根据 mime 兜底
            if (mime) {
                return `export${this.extensionFromMime(mime)}`;
            }
            return '';
        }
        // 无扩展名时按 mime 兜底补全
        if (!cleaned.includes('.') && mime) {
            const ext = this.extensionFromMime(mime);
            return ext ? `${cleaned}${ext}` : cleaned;
        }
        return cleaned;
    }

    private extensionFromMime(mime?: string): string {
        if (!mime) return '';
        const map: Record<string, string> = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/webp': '.webp',
            'image/gif': '.gif',
            'image/bmp': '.bmp',
            'application/json': '.json',
            'text/plain': '.txt',
            'text/html': '.html',
            'text/css': '.css',
            'application/javascript': '.js',
        };
        return map[mime.toLowerCase()] || '';
    }

    /** 插件 ID 安全化，用作输出子目录名 */
    private sanitizePluginId(id: string): string {
        return (id || '').replace(/[^A-Za-z0-9._\-]/g, '_') || 'unknown';
    }

    /** 在扩展名前插入序号，用于生成唯一文件名（避免覆盖） */
    private injectSuffix(name: string, i: number): string {
        const idx = name.lastIndexOf('.');
        if (idx <= 0) return `${name}_${i}`;
        return `${name.slice(0, idx)}_${i}${name.slice(idx)}`;
    }

    private async fileExists(path: string, directory: Directory = Directory.Data): Promise<boolean> {
        try {
            const res = await Filesystem.stat({ path, directory });
            return res?.type === 'file';
        } catch {
            return false;
        }
    }
}
