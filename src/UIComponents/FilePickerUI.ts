
import { injectStyles } from '../styles/mainWindow.css';
import { filePickerUIStyles } from '../styles/components/filePickerUI.css';
import { FilePicker, FileItem } from '../plugins/FilePicker';

type FileSelectCallback = (file: FileItem) => void;

interface FilePickerUIOptions {
    startPath?: string;
}

export class FilePickerUI {
    private overlay: HTMLElement;
    private container: HTMLElement;
    private pathDisplay: HTMLElement;
    private fileList: HTMLElement;
    private backButton: HTMLButtonElement;
    private filePicker: FilePicker;
    private onFileSelect: FileSelectCallback | null = null;
    private iconMap: Map<string, string> = new Map();
    /** 文件选择防抖标志 - 防止快速点击导致重复加载 */
    private isSelectingFile: boolean = false;

    constructor() {
        injectStyles(filePickerUIStyles, 'view-filepicker');

        this.filePicker = FilePicker.getInstance();
        this.setupIconMap();

        this.overlay = this.createOverlay();
        this.container = this.createContainer();
        this.pathDisplay = this.createPathDisplay();
        this.fileList = this.createFileList();
        this.backButton = this.createBackButton();

        this.setupContainer();
        document.body.appendChild(this.overlay);
    }

    private setupIconMap(): void {
        this.iconMap.set('folder', `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>`);
        
        this.iconMap.set('file', `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"/></svg>`);
        
        this.iconMap.set('pmx', `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M440-181 240-296q-19-11-29.5-29T200-365v-230q0-22 10.5-40t29.5-29l200-115q19-11 40-11t40 11l200 115q19 11 29.5 29t10.5 40v230q0 22-10.5 40T720-296L520-181q-19 11-40 11t-40-11Zm0-92v-184l-160-93v185l160 92Zm80 0 160-92v-185l-160 93v184ZM80-680v-120q0-33 23.5-56.5T160-880h120v80H160v120H80ZM280-80H160q-33 0-56.5-23.5T80-160v-120h80v120h120v80Zm400 0v-80h120v-120h80v120q0 33-23.5 56.5T800-80H680Zm120-600v-120H680v-80h120q33 0 56.5 23.5T880-800v120h-80ZM480-526l158-93-158-91-158 91 158 93Zm0 45Zm0-45Zm40 69Zm-80 0Z"/></svg>`);

        this.iconMap.set('pmd', `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M440-181 240-296q-19-11-29.5-29T200-365v-230q0-22 10.5-40t29.5-29l200-115q19-11 40-11t40 11l200 115q19 11 29.5 29t10.5 40v230q0 22-10.5 40T720-296L520-181q-19 11-40 11t-40-11Zm0-92v-184l-160-93v185l160 92Zm80 0 160-92v-185l-160 93v184ZM80-680v-120q0-33 23.5-56.5T160-880h120v80H160v120H80ZM280-80H160q-33 0-56.5-23.5T80-160v-120h80v120h120v80Zm400 0v-80h120v-120h80v120q0 33-23.5 56.5T800-80H680Zm120-600v-120H680v-80h120q33 0 56.5 23.5T880-800v120h-80ZM480-526l158-93-158-91-158 91 158 93Zm0 45Zm0-45Zm40 69Zm-80 0Z"/></svg>`);

        this.iconMap.set('bpmx', `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M440-181 240-296q-19-11-29.5-29T200-365v-230q0-22 10.5-40t29.5-29l200-115q19-11 40-11t40 11l200 115q19 11 29.5 29t10.5 40v230q0 22-10.5 40T720-296L520-181q-19 11-40 11t-40-11Zm0-92v-184l-160-93v185l160 92Zm80 0 160-92v-185l-160 93v184ZM80-680v-120q0-33 23.5-56.5T160-880h120v80H160v120H80ZM280-80H160q-33 0-56.5-23.5T80-160v-120h80v120h120v80Zm400 0v-80h120v-120h80v120q0 33-23.5 56.5T800-80H680Zm120-600v-120H680v-80h120q33 0 56.5 23.5T880-800v120h-80ZM480-526l158-93-158-91-158 91 158 93Zm0 45Zm0-45Zm40 69Zm-80 0Z"/></svg>`);
        
        this.iconMap.set('vmd', `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m400-320 240-160-240-160v320Zm-76 208.5Q251-143 197-197t-85.5-127Q80-397 80-480q0-43 9-84.5t26-80.5l62 62q-8 26-12.5 51.5T160-480q0 134 93 227t227 93q134 0 227-93t93-227q0-134-93-227t-227-93q-27 0-52.5 4.5T377-783l-61-61q40-18 80-27t84-9q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80q-83 0-156-31.5Zm-146.5-586Q160-715 160-740t17.5-42.5Q195-800 220-800t42.5 17.5Q280-765 280-740t-17.5 42.5Q245-680 220-680t-42.5-17.5ZM480-480Z"/></svg>`);
        
        this.iconMap.set('mp3', `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M430-200q38 0 64-26t26-64v-150h120v-80H480v155q-11-8-23.5-11.5T430-380q-38 0-64 26t-26 64q0 38 26 64t64 26ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"/></svg>`);
        
        this.iconMap.set('wav', this.iconMap.get('mp3')!);
        this.iconMap.set('flac', this.iconMap.get('mp3')!);
        this.iconMap.set('ogg', this.iconMap.get('mp3')!);
    }

    private createOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        overlay.className = 'file-picker-overlay';
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide();
            }
        });
        return overlay;
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'file-picker-container';
        return container;
    }

    private createPathDisplay(): HTMLElement {
        const pathDisplay = document.createElement('div');
        pathDisplay.className = 'file-picker-path';
        return pathDisplay;
    }

    private createFileList(): HTMLElement {
        const fileList = document.createElement('div');
        fileList.className = 'file-picker-list';
        return fileList;
    }

    private createBackButton(): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'file-picker-back-button';
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M360-240 120-480l240-240 56 56-144 144h488v-160h80v240H272l144 144-56 56Z"/></svg>
            <span>返回上一级</span>
        `;
        button.addEventListener('click', () => this.navigateUp());
        return button;
    }

    private setupContainer(): void {
        const header = document.createElement('div');
        header.className = 'file-picker-header';

        const title = document.createElement('span');
        title.className = 'file-picker-title';
        title.textContent = '选择文件';

        const closeButton = document.createElement('button');
        closeButton.className = 'file-picker-close';
        closeButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>`;
        closeButton.addEventListener('click', () => this.hide());

        header.appendChild(title);
        header.appendChild(closeButton);

        const footer = document.createElement('div');
        footer.className = 'file-picker-footer';
        footer.appendChild(this.backButton);

        this.container.appendChild(header);
        this.container.appendChild(this.pathDisplay);
        this.container.appendChild(this.fileList);
        this.container.appendChild(footer);

        this.overlay.appendChild(this.container);
    }

    public async show(callback?: FileSelectCallback, options?: FilePickerUIOptions): Promise<void> {
        // 重置防抖标志，确保每次打开文件选择器时都是干净的状态
        this.isSelectingFile = false;

        this.onFileSelect = callback || null;
        this.overlay.classList.add('visible');

        if (!this.filePicker.isWebRootSelected()) {
            this.renderWebRootPrompt();
            return;
        }

        const hasPermission = await this.filePicker.checkPermissions();
        if (!hasPermission) {
            const granted = await this.filePicker.requestPermissions();
            if (!granted) {
                this.showError('需要文件访问权限才能使用此功能');
                return;
            }
        }

        if (options?.startPath) {
            const success = await this.filePicker.setStartPath(options.startPath);
            if (!success) {
                await this.loadFiles();
                return;
            }
            const files = await this.filePicker.listFiles(options.startPath);
            this.renderFiles(files);
            this.updatePath();
            this.updateBackButton();
        } else {
            await this.loadFiles();
        }
    }

    private renderWebRootPrompt(): void {
        this.updatePath();
        this.updateBackButton();
        this.fileList.innerHTML = `
            <div class="file-picker-web-root">
                <svg xmlns="http://www.w3.org/2000/svg" height="48px" viewBox="0 -960 960 960" width="48px" fill="currentColor" opacity="0.5">
                    <path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/>
                </svg>
                <span class="file-picker-web-root-text">选择本地文件夹以浏览文件</span>
                <span class="file-picker-web-root-hint">仅限开发调试使用，Chrome / Edge 浏览器支持</span>
                <button class="file-picker-web-root-btn">选择文件夹</button>
            </div>
        `;

        const btn = this.fileList.querySelector('.file-picker-web-root-btn') as HTMLButtonElement;
        btn.addEventListener('click', async () => {
            const selected = await this.filePicker.selectWebRootDirectory();
            if (selected) {
                this.updatePath();
                this.updateBackButton();
                await this.loadFiles();
            } else {
                this.hide();
            }
        });
    }

    public hide(): void {
        this.overlay.classList.remove('visible');
    }

    private async loadFiles(): Promise<void> {
        this.showLoading();

        try {
            const files = await this.filePicker.listFiles();
            this.renderFiles(files);
            this.updatePath();
            this.updateBackButton();
        } catch (error) {
            console.error('加载文件列表失败:', error);
            this.showError('加载文件列表失败');
        }
    }

    private renderFiles(files: FileItem[]): void {
        this.fileList.innerHTML = '';

        if (files.length === 0) {
            this.showEmpty();
            return;
        }

        files.forEach(file => {
            const item = this.createFileItem(file);
            this.fileList.appendChild(item);
        });
    }

    private createFileItem(file: FileItem): HTMLElement {
        const item = document.createElement('div');
        item.className = 'file-picker-item';

        const iconContainer = document.createElement('div');
        iconContainer.className = `file-picker-icon ${file.isDirectory ? 'folder' : 'file'}`;
        iconContainer.innerHTML = this.getIcon(file);

        const info = document.createElement('div');
        info.className = 'file-picker-info';

        const name = document.createElement('div');
        name.className = 'file-picker-name';
        name.textContent = file.name;

        const meta = document.createElement('div');
        meta.className = 'file-picker-meta';
        if (file.isDirectory) {
            meta.textContent = '文件夹';
        } else if (file.size) {
            meta.textContent = this.formatFileSize(file.size);
        }

        info.appendChild(name);
        info.appendChild(meta);

        item.appendChild(iconContainer);
        item.appendChild(info);

        item.addEventListener('click', () => {
            if (file.isDirectory) {
                this.navigateTo(file.path);
            } else {
                this.selectFile(file);
            }
        });

        return item;
    }

    private getIcon(file: FileItem): string {
        if (file.isDirectory) {
            return this.iconMap.get('folder')!;
        }

        const ext = file.extension?.toLowerCase();
        if (ext && this.iconMap.has(ext)) {
            return this.iconMap.get(ext)!;
        }

        return this.iconMap.get('file')!;
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }

    private async navigateTo(path: string): Promise<void> {
        this.showLoading();

        try {
            const files = await this.filePicker.navigateTo(path);
            this.renderFiles(files);
            this.updatePath();
            this.updateBackButton();
        } catch (error) {
            console.error('导航失败:', error);
            this.showError('无法打开此文件夹');
        }
    }

    private async navigateUp(): Promise<void> {
        this.showLoading();

        try {
            const result = await this.filePicker.navigateUp();
            if (result) {
                this.renderFiles(result.files);
                this.updatePath();
                this.updateBackButton();
            }
        } catch (error) {
            console.error('返回上一级失败:', error);
            this.showError('无法返回上一级');
        }
    }

    private selectFile(file: FileItem): void {
        // 防抖检查：如果正在选择文件，忽略此次点击
        if (this.isSelectingFile) {
            console.log('忽略点击，已经选择了文件');
            return;
        }

        this.isSelectingFile = true;

        if (this.onFileSelect) {
            this.onFileSelect(file);
        }
        this.hide();

        // 延迟重置防抖标志，确保不会快速连续选择
        setTimeout(() => {
            this.isSelectingFile = false;
        }, 1000);
    }

    private updatePath(): void {
        this.pathDisplay.textContent = this.filePicker.getCurrentPath();
    }

    private updateBackButton(): void {
        this.backButton.disabled = this.filePicker.isRootPath();
    }

    private showLoading(): void {
        this.fileList.innerHTML = `
            <div class="file-picker-loading">
                <div class="file-picker-spinner"></div>
            </div>
        `;
    }

    private showEmpty(): void {
        this.fileList.innerHTML = `
            <div class="file-picker-empty">
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M240-160q-33 0-56.5-23.5T160-240v-480q0-33 23.5-56.5T240-800h320l240 240v320q0 33-23.5 56.5T720-160H240Zm280-400v-200H240v480h480v-280H520ZM240-800v200-200 480-480Z"/></svg>
                <span class="file-picker-empty-text">此文件夹为空</span>
            </div>
        `;
    }

    private showError(message: string): void {
        this.fileList.innerHTML = `
            <div class="file-picker-empty">
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>
                <span class="file-picker-empty-text">${message}</span>
            </div>
        `;
    }

    public setFileFilter(extensions: string[]): void {
        this.filePicker.setFileFilter(extensions);
    }

    public enableFileFilter(enable: boolean): void {
        this.filePicker.enableFileFilter(enable);
    }

    public clearFileFilter(): void {
        this.filePicker.clearFileFilter();
    }

    public dispose(): void {
        this.filePicker.revokeWebBlobUrls();
        if (this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }
    }
}
