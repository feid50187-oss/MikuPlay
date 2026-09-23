
import type { MusicManager, MusicInfo } from '../../../features/audio';
import { FilePickerUI } from '../../FilePickerUI';
import type { FileItem } from '../../../plugins/FilePicker';
import { filePathMemory } from '../../../utils/FilePathMemory';
import { isValidMusicFile } from '../../../utils/fileValidation';
import { formatDuration } from '../../../utils/format';
import { toast } from '../../shared/Toast';
import { showConfirmDialog } from '../../shared/ConfirmDialog';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { applyMiddleEllipsis } from '../../../utils/dom';

export class MusicSection {
    element: HTMLElement;
    private collapsible!: CollapsibleSection;

    private musicManager: MusicManager;
    private filePickerUI: FilePickerUI | null = null;
    private musicListContainer: HTMLElement | null = null;
    private addMusicButton: HTMLElement | null = null;

    constructor(musicManager: MusicManager) {
        this.musicManager = musicManager;
        this.element = this.create();
    }

    private create(): HTMLElement {
        this.collapsible = new CollapsibleSection({ title: '音乐导入', initiallyExpanded: true });
        this.collapsible.element.classList.add('import-card');
        this.collapsible.getContentContainer().style.padding = '0 20px 16px 20px';

        this.musicListContainer = document.createElement('div');
        this.musicListContainer.className = 'music-list';

        const contentContainer = this.collapsible.getContentContainer();
        contentContainer.insertBefore(this.musicListContainer, contentContainer.firstChild);

        this.addMusicButton = this.createAddButton('添加音乐', () => this.handleAddMusic());
        contentContainer.appendChild(this.addMusicButton);

        this.refreshMusicListUI();
        this.updateAddMusicButtonVisibility();

        this.element = this.collapsible.element;
        return this.element;
    }

    private createAddButton(text: string, onClick: () => void): HTMLElement {
        const button = document.createElement('button');
        button.className = 'add-button';
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>${text}</span>
        `;

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick();
        });

        return button;
    }

    private handleAddMusic(): void {
        if (this.musicManager.getMusicList().length > 0) {
            toast.error('已存在音乐');
            return;
        }

        if (!this.filePickerUI) {
            this.filePickerUI = new FilePickerUI();
        }

        this.filePickerUI.setFileFilter(['mp3', 'wav', 'aac']);

        const lastPath = filePathMemory.getPath('music');

        this.filePickerUI.show(async (file: FileItem) => {
            if (!isValidMusicFile(file.name)) {
                toast.error(`不支持的文件格式: ${file.name}\n支持 MP3, WAV, AAC 格式`);
                return;
            }

            try {
                const music = await this.musicManager.importMusic(file.fileUrl || file.path, file.name);
                await this.musicManager.loadMusic(music.id);
                this.addMusicItemToUI(music);
                toast.success(`"${file.name}"导入成功`);
                const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
                filePathMemory.setPath('music', parentPath);
                this.updateAddMusicButtonVisibility();
            } catch (error) {
                console.error('导入音乐失败:', error);
                const errorMessage = error instanceof Error ? error.message : '音乐导入失败';
                toast.error(errorMessage);
            }
        }, lastPath ? { startPath: lastPath } : undefined);
    }

    private updateAddMusicButtonVisibility(): void {
        if (!this.addMusicButton) return;
        const hasMusic = this.musicManager.getMusicList().length > 0;
        this.addMusicButton.style.display = hasMusic ? 'none' : 'flex';
    }

    refreshMusicListUI(): void {
        if (!this.musicListContainer) return;

        const musicList = this.musicManager.getMusicList();

        this.musicListContainer.innerHTML = '';

        musicList.forEach(music => {
            const item = this.createMusicItem(music);
            this.musicListContainer!.appendChild(item);
        });
    }

    private createMusicItem(music: MusicInfo): HTMLElement {
        const item = document.createElement('div');
        item.className = 'music-item current';
        item.dataset.musicId = music.id;

        const infoContainer = document.createElement('div');
        infoContainer.className = 'music-info';

        const nameElement = document.createElement('span');
        nameElement.className = 'music-name';
        applyMiddleEllipsis(nameElement, music.name);

        const durationElement = document.createElement('span');
        durationElement.className = 'music-duration';
        durationElement.textContent = formatDuration(music.duration);

        infoContainer.appendChild(nameElement);
        infoContainer.appendChild(durationElement);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'music-delete-button';
        deleteButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;

        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            await this.handleDeleteMusic(music.id, item);
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'music-button-container';
        buttonContainer.appendChild(deleteButton);

        item.appendChild(infoContainer);
        item.appendChild(buttonContainer);

        return item;
    }

    private async handleDeleteMusic(musicId: string, itemElement: HTMLElement): Promise<void> {
        const confirmed = await showConfirmDialog({
            title: '删除音乐',
            message: '确定要删除这首音乐吗？此操作不可恢复。',
            confirmText: '删除',
            cancelText: '取消',
            danger: true
        });

        if (!confirmed) return;

        try {
            const success = this.musicManager.deleteMusic(musicId);
            if (success) {
                if (itemElement.parentElement) {
                    itemElement.parentElement.removeChild(itemElement);
                }
                toast.success('音乐已删除');
                this.updateAddMusicButtonVisibility();
            } else {
                toast.error('删除音乐失败');
            }
        } catch (error) {
            console.error('删除音乐失败:', error);
            toast.error('删除音乐失败');
        }
    }

    private addMusicItemToUI(music: MusicInfo): void {
        if (!this.musicListContainer) return;

        const item = this.createMusicItem(music);
        this.musicListContainer.appendChild(item);
    }

    dispose(): void {
        if (this.filePickerUI) {
            this.filePickerUI.dispose();
            this.filePickerUI = null;
        }
    }
}
