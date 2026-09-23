import { injectStyles } from '../styles/mainWindow.css';
import { projectSaveUIStyles } from '../styles/components/projectSaveUI.css';
import { ProjectSaveManager, type RestoreReport } from '../features/project';
import { showConfirmDialog, toast } from './shared';
import { ModelStateManager } from '../features/mmd/ModelStateManager';

export class ProjectSaveUI {
    private overlay: HTMLElement;
    private panel: HTMLElement;
    private isOpen: boolean = false;

    // Tab
    private currentTab: 'save' | 'load' = 'save';
    private tabIndicator!: HTMLElement;
    private saveTabBtn!: HTMLElement;
    private loadTabBtn!: HTMLElement;

    // Save page
    private nameInput!: HTMLInputElement;
    private saveInfoPreview!: HTMLElement;
    private saveBtn!: HTMLButtonElement;

    // Load page
    private saveContent!: HTMLElement;
    private loadContent!: HTMLElement;
    private archiveList!: HTMLElement;
    private selectedArchivePath: string | null = null;
    private selectedArchiveIsCorrupt: boolean = false;
    private loadBtn!: HTMLButtonElement;
    private deleteBtn!: HTMLButtonElement;

    constructor() {
        injectStyles(projectSaveUIStyles, 'view-projectsaveui');

        this.overlay = this.createOverlay();
        this.panel = this.createPanel();

        document.body.appendChild(this.overlay);
        document.body.appendChild(this.panel);
    }

    public async open(): Promise<void> {
        if (!this.isOpen) {
            this.isOpen = true;
            this.overlay.style.display = 'block';
            this.panel.style.display = 'block';
            this.overlay.classList.add('visible');
            this.panel.classList.add('open');
            this.updateSaveInfoPreview();
            await this.refreshArchiveList();
        }
    }

    public async close(): Promise<void> {
        if (this.isOpen) {
            this.isOpen = false;
            this.overlay.classList.remove('visible');
            this.panel.classList.remove('open');
            this.overlay.style.display = 'none';
            this.panel.style.display = 'none';
        }
    }

    public isOpened(): boolean {
        return this.isOpen;
    }

    private createOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        overlay.className = 'project-save-overlay';
        overlay.style.display = 'none';
        overlay.addEventListener('click', () => {
            this.close().catch(error => {
                console.error('[ProjectSaveUI] Close failed:', error);
            });
        });
        return overlay;
    }

    private createPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'project-save-panel';
        panel.style.display = 'none';

        const header = this.createHeader();
        panel.appendChild(header);

        const tabBar = this.createTabBar();
        panel.appendChild(tabBar);

        const content = document.createElement('div');
        content.className = 'project-save-content';

        this.saveContent = this.createSaveContent();
        this.loadContent = this.createLoadContent();
        content.appendChild(this.saveContent);
        content.appendChild(this.loadContent);
        this.loadContent.style.display = 'none';

        panel.appendChild(content);

        const footer = this.createFooter();
        panel.appendChild(footer);

        return panel;
    }

    private createHeader(): HTMLElement {
        const header = document.createElement('div');
        header.className = 'project-save-header';

        const title = document.createElement('span');
        title.className = 'project-save-title';
        title.textContent = '工程存档';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'project-save-close-btn';
        closeBtn.innerHTML = this.getCloseIcon();
        closeBtn.addEventListener('click', () => {
            this.close().catch(error => {
                console.error('[ProjectSaveUI] Close failed:', error);
            });
        });

        header.appendChild(title);
        header.appendChild(closeBtn);

        return header;
    }

    private createTabBar(): HTMLElement {
        const tabBar = document.createElement('div');
        tabBar.className = 'project-save-tab-bar';

        this.saveTabBtn = document.createElement('button');
        this.saveTabBtn.className = 'project-save-tab-btn active';
        this.saveTabBtn.textContent = '保存';
        this.saveTabBtn.addEventListener('click', () => this.switchTab('save'));

        this.loadTabBtn = document.createElement('button');
        this.loadTabBtn.className = 'project-save-tab-btn';
        this.loadTabBtn.textContent = '读取';
        this.loadTabBtn.addEventListener('click', () => this.switchTab('load'));

        this.tabIndicator = document.createElement('div');
        this.tabIndicator.className = 'project-save-tab-indicator';
        this.tabIndicator.style.left = '0';
        this.tabIndicator.style.width = '50%';

        tabBar.appendChild(this.saveTabBtn);
        tabBar.appendChild(this.loadTabBtn);
        tabBar.appendChild(this.tabIndicator);

        return tabBar;
    }

    private createSaveContent(): HTMLElement {
        const container = document.createElement('div');

        // 红字警告
        const warning = document.createElement('div');
        warning.className = 'project-save-warning';
        warning.textContent = '存在多处BUG与功能缺失，不得用于重要工做的保存';
        warning.style.color = 'var(--mp-danger, #e5484d)';
        warning.style.fontSize = '13px';
        warning.style.fontWeight = 'bold';
        warning.style.marginBottom = '10px';
        container.appendChild(warning);

        // 存档路径
        const pathLabel = document.createElement('div');
        pathLabel.className = 'project-save-path-label';
        pathLabel.textContent = '存档路径';

        const pathValue = document.createElement('div');
        pathValue.className = 'project-save-path-value';
        pathValue.textContent = '/storage/emulated/0/MikuPlay/Projections/';

        container.appendChild(pathLabel);
        container.appendChild(pathValue);

        // 存档名称
        const nameLabel = document.createElement('div');
        nameLabel.className = 'project-save-name-label';
        nameLabel.textContent = '存档名称';

        this.nameInput = document.createElement('input');
        this.nameInput.className = 'project-save-name-input';
        this.nameInput.type = 'text';
        this.nameInput.placeholder = '输入存档名称';

        // 默认值：第一个模型名
        const models = ModelStateManager.getInstance().getModels();
        if (models.length > 0) {
            this.nameInput.value = models[0].name.replace(/\.\w+$/, '');
        }

        container.appendChild(nameLabel);
        container.appendChild(this.nameInput);

        // 信息预览
        this.saveInfoPreview = document.createElement('div');
        this.saveInfoPreview.className = 'project-save-info-box';
        container.appendChild(this.saveInfoPreview);

        return container;
    }

    private createLoadContent(): HTMLElement {
        const container = document.createElement('div');

        const pathLabel = document.createElement('div');
        pathLabel.className = 'project-save-path-label';
        pathLabel.textContent = '存档路径';

        const pathValue = document.createElement('div');
        pathValue.className = 'project-save-path-value';
        pathValue.textContent = '/storage/emulated/0/MikuPlay/Projections/';

        container.appendChild(pathLabel);
        container.appendChild(pathValue);

        // 存档列表
        this.archiveList = document.createElement('div');
        this.archiveList.className = 'project-save-archive-list';
        container.appendChild(this.archiveList);

        return container;
    }

    private createFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'project-save-footer';

        this.saveBtn = document.createElement('button');
        this.saveBtn.className = 'project-save-primary-btn';
        this.saveBtn.textContent = '保存工程';
        this.saveBtn.addEventListener('click', () => this.handleSave());

        this.loadBtn = document.createElement('button');
        this.loadBtn.className = 'project-save-primary-btn';
        this.loadBtn.textContent = '加载工程';
        this.loadBtn.disabled = true;
        this.loadBtn.style.display = 'none';
        this.loadBtn.addEventListener('click', () => this.handleLoad());

        this.deleteBtn = document.createElement('button');
        this.deleteBtn.className = 'project-save-secondary-btn';
        this.deleteBtn.textContent = '删除';
        this.deleteBtn.disabled = true;
        this.deleteBtn.style.display = 'none';
        this.deleteBtn.addEventListener('click', () => this.handleDelete());

        footer.appendChild(this.saveBtn);
        footer.appendChild(this.loadBtn);
        footer.appendChild(this.deleteBtn);

        return footer;
    }

    private switchTab(tab: 'save' | 'load'): void {
        this.currentTab = tab;

        this.saveTabBtn.classList.toggle('active', tab === 'save');
        this.loadTabBtn.classList.toggle('active', tab === 'load');

        this.tabIndicator.style.left = tab === 'save' ? '0' : '50%';

        this.saveContent.style.display = tab === 'save' ? 'block' : 'none';
        this.loadContent.style.display = tab === 'load' ? 'block' : 'none';

        this.saveBtn.style.display = tab === 'save' ? 'block' : 'none';
        this.loadBtn.style.display = tab === 'load' ? 'block' : 'none';
        this.deleteBtn.style.display = tab === 'load' ? 'block' : 'none';

        if (tab === 'save') {
            this.updateSaveInfoPreview();
        } else {
            this.refreshArchiveList();
        }
    }

    private updateSaveInfoPreview(): void {
        const models = ModelStateManager.getInstance().getModels();
        let animCount = 0;
        let hasCameraAnim = false;

        for (const model of models) {
            animCount += (model.animations ?? []).length;
        }

        const lines = [
            `模型: ${models.length} 个`,
            `动画: ${animCount} 个`
        ];

        this.saveInfoPreview.innerHTML = lines
            .map(l => `<div class="project-save-info-row">${l}</div>`)
            .join('');
    }

    private async refreshArchiveList(): Promise<void> {
        this.archiveList.replaceChildren();
        this.selectedArchivePath = null;
        this.selectedArchiveIsCorrupt = false;
        this.updateLoadButtons();

        try {
            const archives = await ProjectSaveManager.getInstance().listArchives();

            if (archives.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'project-save-archive-empty';
                empty.textContent = '暂无存档';
                this.archiveList.appendChild(empty);
                return;
            }

            for (const archive of archives) {
                const item = document.createElement('div');
                item.className = 'project-save-archive-item';
                if (archive.corrupt) {
                    item.classList.add('corrupt');
                }

                const name = document.createElement('div');
                name.className = 'project-save-archive-name';
                name.textContent = archive.corrupt ? `${archive.name}（已损坏）` : archive.name;

                const meta = document.createElement('div');
                meta.className = 'project-save-archive-meta';
                if (!archive.corrupt && archive.createdAt) {
                    const date = new Date(archive.createdAt).toLocaleString();
                    meta.textContent = `${date} · ${archive.modelCount ?? 0}模型`;
                }

                item.appendChild(name);
                item.appendChild(meta);

                item.addEventListener('click', () => {
                    this.selectedArchivePath = archive.filePath;
                    this.selectedArchiveIsCorrupt = archive.corrupt;
                    this.archiveList.querySelectorAll('.project-save-archive-item').forEach(el => {
                        el.classList.remove('selected');
                    });
                    item.classList.add('selected');
                    this.updateLoadButtons();
                });

                this.archiveList.appendChild(item);
            }
        } catch (error) {
            const empty = document.createElement('div');
            empty.className = 'project-save-archive-empty';
            empty.textContent = '读取存档列表失败';
            this.archiveList.appendChild(empty);
        }
    }

    private updateLoadButtons(): void {
        const hasSelection = this.selectedArchivePath !== null;
        this.loadBtn.disabled = !hasSelection || this.selectedArchiveIsCorrupt;
        this.deleteBtn.disabled = !hasSelection;
    }

    private async handleSave(): Promise<void> {
        const name = this.nameInput.value.trim();
        if (!name) {
            toast.show('请输入存档名称', 'error');
            return;
        }

        this.saveBtn.disabled = true;
        this.saveBtn.textContent = '保存中...';

        try {
            await ProjectSaveManager.getInstance().saveToFile(name);
            toast.show('工程已保存', 'success');
            await this.close();
        } catch (error) {
            console.error('[ProjectSaveUI] 保存失败:', error);
            toast.show('保存失败', 'error');
        } finally {
            this.saveBtn.disabled = false;
            this.saveBtn.textContent = '保存工程';
        }
    }

    private async handleLoad(): Promise<void> {
        if (!this.selectedArchivePath) return;

        const confirmed = await showConfirmDialog({
            title: '加载工程',
            message: '加载工程将覆盖当前状态，是否继续？',
            confirmText: '加载',
            cancelText: '取消'
        });

        if (!confirmed) return;

        // 关闭保存/读取面板后再执行加载
        await this.close();

        this.loadBtn.disabled = true;
        this.loadBtn.textContent = '加载中...';

        try {
            const report = await ProjectSaveManager.getInstance().restoreFromFile(this.selectedArchivePath);
            if (report.success) {
                toast.show(`工程已恢复 (${report.restoredModels}模型, ${report.restoredAnimations}动画)`, 'success');
            } else {
                //toast.show('恢复存在错误', 'info');
            }
            if (report.warnings.length > 0) {
                console.warn('[ProjectSaveUI] 恢复警告:', report.warnings);
                toast.show(`${report.warnings.length}条警告，日志位于MikuPlay/Projects中`, 'info');
                // 保存错误日志到工程文件夹
                const sourceName = this.selectedArchivePath.split('/').pop() ?? this.selectedArchivePath;
                ProjectSaveManager.getInstance().saveErrorLog(report, sourceName).catch(() => {});
            }
        } catch (error) {
            console.error('[ProjectSaveUI] 加载失败:', error);
            toast.show('加载失败', 'error');
            // 保存错误日志（即使 restoreFromFile 抛出异常，也记录）
            const sourceName = this.selectedArchivePath.split('/').pop() ?? this.selectedArchivePath;
            const errReport: RestoreReport = {
                success: false,
                restoredModels: 0,
                restoredAnimations: 0,
                missingFiles: [],
                warnings: [`加载过程异常: ${error}`]
            };
            ProjectSaveManager.getInstance().saveErrorLog(errReport, sourceName).catch(() => {});
        } finally {
            this.loadBtn.disabled = false;
            this.loadBtn.textContent = '加载工程';
        }
    }

    private async handleDelete(): Promise<void> {
        if (!this.selectedArchivePath) return;

        const confirmed = await showConfirmDialog({
            title: '删除存档',
            message: '确定删除此存档？此操作不可恢复。',
            confirmText: '删除',
            cancelText: '取消'
        });

        if (!confirmed) return;

        try {
            await ProjectSaveManager.getInstance().deleteArchive(this.selectedArchivePath);
            toast.show('存档已删除', 'success');
            this.selectedArchivePath = null;
            await this.refreshArchiveList();
        } catch (error) {
            console.error('[ProjectSaveUI] 删除失败:', error);
            toast.show('删除失败', 'error');
        }
    }

    private getCloseIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
    }

    public dispose(): void {
        if (this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }
        if (this.panel.parentElement) {
            this.panel.parentElement.removeChild(this.panel);
        }
    }
}
