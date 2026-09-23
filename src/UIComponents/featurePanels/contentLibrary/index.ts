/**
 * 内容库面板
 * 完整文件管理器：左侧分类文件夹 + 右侧文件列表 + 顶部操作栏
 */
import type { IPanel } from '../../../core/IPanel';
import type { MainWindow } from '../../MainWindow';
import { contentLibraryApi } from '../../../features/library/ContentLibraryApi';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

type AssetCategory = 'materials' | 'textures' | 'images' | 'lights' | 'projects' | 'logs' | 'models' | 'music' | 'scenes' | 'motions' | 'skyboxes';

interface AssetItem {
    id: string;
    name: string;
    category: AssetCategory;
    path: string;
    size: number;
    addedAt: number;
    tags: string[];
}

const CATEGORY_LABELS: Record<AssetCategory, string> = {
    materials: 'MME 材质包',
    textures: '纹理贴图',
    images: '图片素材',
    lights: '灯光预设',
    projects: '工程存档',
    logs: '工作日志',
    models: '人物模型',
    music: '音乐文件',
    scenes: '场景文件',
    motions: '动作数据',
    skyboxes: '天空盒'
};

const CATEGORY_ICONS: Record<AssetCategory, string> = {
    materials: '🎨',
    textures: '🖼️',
    images: '📷',
    lights: '💡',
    projects: '📁',
    logs: '📝',
    models: '👤',
    music: '🎵',
    scenes: '🏞️',
    motions: '🎬',
    skyboxes: '🌌'
};

export class ContentLibraryPanel implements IPanel {
    readonly id = 'library';
    readonly tabLabel = '内容库';
    readonly tabIcon = TAB_ICON;
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private currentCategory: AssetCategory | 'all' = 'models';
    private assets: Map<AssetCategory, AssetItem[]> = new Map();
    private leftPanel: HTMLElement;
    private rightPanel: HTMLElement;
    private fileListEl: HTMLElement;
    private searchInput: HTMLInputElement;

    constructor(options: { mainWindow?: MainWindow }) {
        this.mainWindow = options.mainWindow ?? null;
        this.element = document.createElement('div');
        this.element.style.cssText = 'height:100%;display:flex;flex-direction:column;';

        this.leftPanel = document.createElement('div');
        this.rightPanel = document.createElement('div');
        this.fileListEl = document.createElement('div');
        this.searchInput = document.createElement('input');

        this.element.appendChild(this.buildTopBar());
        this.element.appendChild(this.buildMainArea());
        this.element.appendChild(this.buildBottomBar());

        this.loadAssets();
    }

    /**
     * 顶部操作栏
     */
    private buildTopBar(): HTMLElement {
        const topBar = document.createElement('div');
        topBar.style.cssText = 'padding:8px 12px;border-bottom:1px solid #e0e0e0;display:flex;gap:8px;align-items:center;';

        const title = document.createElement('div');
        title.style.cssText = 'font-size:14px;font-weight:700;flex-shrink:0;';
        title.textContent = '内容库';
        topBar.appendChild(title);

        this.searchInput.style.cssText = 'flex:1;height:32px;border:1px solid #ddd;border-radius:6px;padding:0 10px;font-size:12px;';
        this.searchInput.placeholder = '搜索文件...';
        this.searchInput.addEventListener('input', () => this.renderFileList());
        topBar.appendChild(this.searchInput);

        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'mp-btn primary small';
        importBtn.textContent = '导入';
        importBtn.style.flexShrink = '0';
        importBtn.addEventListener('click', () => this.importFile());
        topBar.appendChild(importBtn);

        const scanBtn = document.createElement('button');
        scanBtn.type = 'button';
        scanBtn.className = 'mp-btn small';
        scanBtn.textContent = '整理';
        scanBtn.style.flexShrink = '0';
        scanBtn.addEventListener('click', () => this.scanAndOrganize());
        topBar.appendChild(scanBtn);

        return topBar;
    }

    /**
     * 主区域：左侧文件夹 + 右侧文件列表
     */
    private buildMainArea(): HTMLElement {
        const mainArea = document.createElement('div');
        mainArea.style.cssText = 'flex:1;display:flex;overflow:hidden;';

        this.leftPanel.style.cssText = 'width:140px;border-right:1px solid #e0e0e0;overflow-y:auto;background:#fafafa;';
        mainArea.appendChild(this.leftPanel);

        this.rightPanel.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;';

        const breadcrumb = document.createElement('div');
        breadcrumb.style.cssText = 'padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;';
        breadcrumb.id = 'library-breadcrumb';
        this.rightPanel.appendChild(breadcrumb);

        this.fileListEl.style.cssText = 'flex:1;overflow-y:auto;';
        this.rightPanel.appendChild(this.fileListEl);

        mainArea.appendChild(this.rightPanel);

        this.renderLeftPanel();
        return mainArea;
    }

    /**
     * 底部按钮栏
     */
    private buildBottomBar(): HTMLElement {
        const container = document.createElement('div');
        container.style.cssText = 'border-top:1px solid #e0e0e0;';

        const bottomBar = document.createElement('div');
        bottomBar.style.cssText = 'padding:8px 12px;display:flex;gap:8px;';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'mp-btn';
        saveBtn.textContent = '保存工程';
        saveBtn.style.flex = '1';
        saveBtn.addEventListener('click', () => this.manualSave());

        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.className = 'mp-btn';
        loadBtn.textContent = '读取存档';
        loadBtn.style.flex = '1';
        loadBtn.addEventListener('click', () => this.loadArchive());

        bottomBar.appendChild(saveBtn);
        bottomBar.appendChild(loadBtn);
        container.appendChild(bottomBar);

        const autoSaveDiv = document.createElement('div');
        autoSaveDiv.style.cssText = 'padding:8px 12px;display:flex;gap:8px;align-items:center;';
        autoSaveDiv.innerHTML = `
            <span style="font-size:12px;color:#666;flex-shrink:0;">自动存档:</span>
            <select id="auto-save-interval" style="flex:1;height:28px;border:1px solid #ddd;border-radius:4px;">
                <option value="0">关闭</option>
                <option value="5">5 分钟</option>
                <option value="10">10 分钟</option>
            </select>
            <span id="auto-save-status" style="font-size:11px;color:#888;flex-shrink:0;"></span>
        `;
        container.appendChild(autoSaveDiv);

        setTimeout(() => this.bindAutoSaveSettings(), 100);
        return container;
    }

    /**
     * 渲染左侧分类文件夹
     */
    private renderLeftPanel(): void {
        this.leftPanel.innerHTML = '';

        const allBtn = this.createFolderItem('全部文件', '📁', this.currentCategory === 'all');
        allBtn.addEventListener('click', () => {
            this.currentCategory = 'all';
            this.renderLeftPanel();
            this.renderFileList();
        });
        this.leftPanel.appendChild(allBtn);

        (Object.keys(CATEGORY_LABELS) as AssetCategory[]).forEach(cat => {
            const item = this.createFolderItem(
                CATEGORY_LABELS[cat],
                CATEGORY_ICONS[cat],
                cat === this.currentCategory
            );
            item.addEventListener('click', () => {
                this.currentCategory = cat;
                this.renderLeftPanel();
                this.renderFileList();
            });
            this.leftPanel.appendChild(item);
        });
    }

    private createFolderItem(label: string, icon: string, active: boolean): HTMLElement {
        const item = document.createElement('div');
        item.style.cssText = `
            display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;
            font-size:12px;${active ? 'background:#e3f2fd;color:#1976d2;' : 'color:#333;'}
        `;
        item.innerHTML = `<span style="font-size:14px;">${icon}</span><span>${label}</span>`;
        return item;
    }

    /**
     * 渲染右侧文件列表（表格形式）
     */
    private renderFileList(): void {
        this.fileListEl.innerHTML = '';

        const breadcrumb = document.getElementById('library-breadcrumb');
        if (breadcrumb) {
            const path = this.currentCategory === 'all' ? 'MikuPlay/' : `MikuPlay/${this.getFolderName(this.currentCategory as AssetCategory)}/`;
            breadcrumb.textContent = `📂 ${path}`;
        }

        let items: AssetItem[] = [];
        if (this.currentCategory === 'all') {
            this.assets.forEach(list => items.push(...list));
        } else {
            items = this.assets.get(this.currentCategory as AssetCategory) || [];
        }

        const keyword = this.searchInput.value.toLowerCase();
        if (keyword) {
            items = items.filter(i => i.name.toLowerCase().includes(keyword));
        }

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'text-align:center;color:#999;padding:40px;font-size:13px;';
            empty.textContent = '暂无文件，点击右上角"导入"按钮添加';
            this.fileListEl.appendChild(empty);
            return;
        }

        const header = document.createElement('div');
        header.style.cssText = 'display:grid;grid-template-columns:40px 1fr 80px 100px 60px;padding:8px 12px;border-bottom:1px solid #e0e0e0;font-size:11px;font-weight:600;color:#666;background:#f5f5f5;';
        header.innerHTML = `
            <div></div>
            <div>文件名</div>
            <div>大小</div>
            <div>日期</div>
            <div>操作</div>
        `;
        this.fileListEl.appendChild(header);

        items.forEach(item => {
            const row = document.createElement('div');
            row.style.cssText = 'display:grid;grid-template-columns:40px 1fr 80px 100px 60px;padding:8px 12px;border-bottom:1px solid #f0f0f0;font-size:12px;align-items:center;';

            const icon = document.createElement('div');
            icon.style.cssText = 'font-size:16px;text-align:center;';
            icon.textContent = this.getFileIcon(item.name);

            const nameEl = document.createElement('div');
            nameEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;';
            nameEl.textContent = item.name;
            nameEl.addEventListener('click', () => this.openFileActions(item));

            const sizeEl = document.createElement('div');
            sizeEl.style.cssText = 'color:#888;font-size:11px;';
            sizeEl.textContent = this.formatSize(item.size);

            const dateEl = document.createElement('div');
            dateEl.style.cssText = 'color:#888;font-size:11px;';
            dateEl.textContent = new Date(item.addedAt).toLocaleDateString();

            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className = 'mp-btn small';
            actionBtn.textContent = '管理';
            actionBtn.style.cssText = 'font-size:11px;padding:2px 8px;';
            actionBtn.addEventListener('click', () => this.openFileActions(item));

            row.appendChild(icon);
            row.appendChild(nameEl);
            row.appendChild(sizeEl);
            row.appendChild(dateEl);
            row.appendChild(actionBtn);
            this.fileListEl.appendChild(row);
        });
    }

    /**
     * 文件操作弹窗
     */
    private openFileActions(item: AssetItem): void {
        const choice = prompt(
            `文件: ${item.name}\n\n` +
            `输入操作:\n` +
            `  1 = 预览\n` +
            `  2 = 重命名\n` +
            `  3 = 移除\n` +
            `  4 = 导出到外部`
        );

        if (!choice) return;

        switch (choice) {
            case '1': this.previewFile(item); break;
            case '2': this.renameFile(item); break;
            case '3': this.removeFile(item); break;
            case '4': this.exportFile(item); break;
        }
    }

    /**
     * 导入文件
     */
    private importFile(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = this.getAcceptTypes(this.currentCategory as AssetCategory);
        input.onchange = async () => {
            const files = Array.from(input.files || []);
            for (const file of files) {
                try {
                    if (file.name.endsWith('.zip')) {
                        await this.extractZip(file);
                    } else {
                        const cat = this.currentCategory === 'all'
                            ? this.guessCategory(file.name)
                            : this.currentCategory as AssetCategory;
                        await contentLibraryApi.addAsset(file, cat, file.name);
                    }
                } catch (e) {
                    console.error('导入失败:', file.name, e);
                }
            }
            this.loadAssets();
        };
        input.click();
    }

    private async extractZip(zipFile: File): Promise<void> {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(zipFile);
        const files = Object.values(zip.files);

        for (const file of files) {
            if (file.dir) continue;
            try {
                const data = await file.async('blob');
                const cat = this.guessCategory(file.name);
                if (cat) {
                    await contentLibraryApi.addAsset(data, cat, file.name);
                }
            } catch (e) {
                console.error('解压失败:', file.name);
            }
        }
    }

    private scanAndOrganize(): void {
        alert('选择文件夹，自动识别文件类型并分类整理到对应目录。');
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        (input as any).webkitdirectory = true;
        input.onchange = async () => {
            const files = Array.from(input.files || []);
            const result = await contentLibraryApi.scanDirectory(files);
            alert(`扫描完成:\n扫描 ${result.scanned} 个文件\n导入 ${result.imported} 个\n错误 ${result.errors.length} 个`);
            this.loadAssets();
        };
        input.click();
    }

    private async previewFile(item: AssetItem): Promise<void> {
        const url = await contentLibraryApi.getImagePreview(item.id);
        if (!url) {
            alert('此文件类型暂不支持预览');
            return;
        }
        if (item.category === 'textures' || item.category === 'images' || item.category === 'skyboxes') {
            const win = window.open();
            if (win) win.document.write(`<img src="${url}" style="max-width:100%;">`);
        } else if (item.category === 'music') {
            new Audio(url).play();
        } else {
            alert('预览: ' + item.name);
        }
    }

    private async renameFile(item: AssetItem): Promise<void> {
        const newName = prompt('输入新名称:', item.name);
        if (!newName || newName === item.name) return;
        await contentLibraryApi.renameAsset(item.id, newName);
        this.loadAssets();
    }

    private async removeFile(item: AssetItem): Promise<void> {
        if (!confirm(`确定移除 "${item.name}"?`)) return;
        await contentLibraryApi.deleteAsset(item.id);
        this.loadAssets();
    }

    private exportFile(item: AssetItem): void {
        alert(`导出功能:\n${item.name}\n（请通过外部文件管理器访问 MikuPlay/ 文件夹）`);
    }

    private loadAssets(): void {
        this.assets = contentLibraryApi.listAllAssets()
            .reduce((acc, asset) => {
                const list = acc.get(asset.category) || [];
                list.push(asset as any);
                acc.set(asset.category, list);
                return acc;
            }, new Map() as Map<AssetCategory, AssetItem[]>);
        this.renderFileList();
    }

    private guessCategory(filename: string): AssetCategory {
        const lower = filename.toLowerCase();
        if (lower.endsWith('.pmx') || lower.endsWith('.pmd')) return 'models';
        if (lower.endsWith('.vmd') || lower.endsWith('.vpd')) return 'motions';
        if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.ogg')) return 'music';
        if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'textures';
        if (lower.endsWith('.mat') || lower.endsWith('.fx')) return 'materials';
        if (lower.endsWith('.json')) return 'projects';
        if (lower.endsWith('.hdr')) return 'skyboxes';
        return 'images';
    }

    private getFileIcon(filename: string): string {
        const lower = filename.toLowerCase();
        if (lower.endsWith('.pmx') || lower.endsWith('.pmd')) return '👤';
        if (lower.endsWith('.vmd')) return '🎬';
        if (lower.endsWith('.mp3') || lower.endsWith('.wav')) return '🎵';
        if (lower.endsWith('.png') || lower.endsWith('.jpg')) return '🖼️';
        if (lower.endsWith('.zip')) return '📦';
        if (lower.endsWith('.json')) return '⚙️';
        return '📄';
    }

    private getAcceptTypes(cat: AssetCategory): string {
        const types: Record<string, string> = {
            materials: '.zip,.mat,.fx',
            textures: '.png,.jpg,.jpeg,.dds,.tga',
            images: '.png,.jpg,.jpeg,.gif,.webp',
            lights: '.json,.light',
            projects: '.json,.mikuproj',
            logs: '.log,.txt',
            models: '.pmx,.pmd,.zip',
            music: '.mp3,.wav,.ogg,.m4a',
            scenes: '.x,.pmx,.zip',
            motions: '.vmd,.vpd',
            skyboxes: '.png,.jpg,.hdr,.zip'
        };
        return types[cat] || '*/*';
    }

    private getFolderName(cat: AssetCategory): string {
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
            skyboxes: 'Skyboxes'
        };
        return folders[cat] || 'Other';
    }

    private formatSize(bytes: number): string {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    private bindAutoSaveSettings(): void {
        const select = document.getElementById('auto-save-interval') as HTMLSelectElement;
        const statusEl = document.getElementById('auto-save-status');
        if (!select || !statusEl) return;

        import('../../../features/project/AutoSaveService').then(({ autoSaveService }) => {
            const status = autoSaveService.getStatus();
            select.value = String(status.interval);
            this.updateAutoSaveStatus(statusEl, status.interval);

            select.addEventListener('change', () => {
                const interval = Number(select.value) as 0 | 5 | 10;
                autoSaveService.setInterval(interval);
                this.updateAutoSaveStatus(statusEl, interval);
            });
        });
    }

    private updateAutoSaveStatus(el: HTMLElement, interval: number): void {
        el.textContent = interval > 0 ? `每 ${interval} 分钟` : '已关闭';
    }

    private async manualSave(): Promise<void> {
        const name = prompt('输入工程名称:', `工程_${new Date().toLocaleDateString()}`);
        if (!name) return;
        try {
            const { autoSaveService } = await import('../../../features/project/AutoSaveService');
            await autoSaveService.manualSave(name);
            alert('工程保存成功');
        } catch (e) {
            alert('保存失败: ' + (e as Error).message);
        }
    }

    private async loadArchive(): Promise<void> {
        try {
            const { autoSaveService } = await import('../../../features/project/AutoSaveService');
            const archives = await autoSaveService.listArchives();
            if (archives.length === 0) {
                alert('暂无存档');
                return;
            }
            const list = archives.map((a: any, i: number) =>
                `${i + 1}. ${a.name} (${new Date(a.createdAt).toLocaleString()})`
            ).join('\n');
            const choice = prompt(`选择存档编号:\n${list}`);
            if (!choice) return;
            const idx = Number(choice) - 1;
            await autoSaveService.loadArchive(archives[idx].filePath);
            alert('存档读取成功');
        } catch (e) {
            alert('读取失败: ' + (e as Error).message);
        }
    }

    onShow(): void {
        this.loadAssets();
    }

    onHide(): void {}

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }

    dispose(): void {
        this.assets.clear();
    }
}

export default ContentLibraryPanel;
