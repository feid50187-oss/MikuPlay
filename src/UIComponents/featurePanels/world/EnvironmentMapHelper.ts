
import { PhotoDome } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { EnvironmentMapManager } from '../../../features/environmentMap/environmentMapManager';
import { FilePickerUI } from '../../FilePickerUI';
import { FileItem } from '../../../plugins/FilePicker';
import { filePathMemory } from '../../../utils/FilePathMemory';
import { mediaPickerManager } from '../../../plugins/MediaPicker';
import { Capacitor } from '@capacitor/core';
import { toast } from '../../shared/Toast';
import { isValidImageFile } from '../../../utils/fileValidation';

const PRESET_ENVIRONMENT_MAPS = [
    { name: '1.jpg', path: 'Skybox/1.jpg', preview: 'Skybox/preview/1.jpg' },
    { name: '2.jpg', path: 'Skybox/2.jpg', preview: 'Skybox/preview/2.jpg' },
    { name: '3.jpg', path: 'Skybox/3.jpg', preview: 'Skybox/preview/3.jpg' }
];

export class EnvironmentMapHelper {
    private currentSkybox: PhotoDome | null = null;
    private scene: Scene | null = null;
    private onTextureChange?: (path: string | null) => void;

    constructor(scene: Scene | null, onTextureChange?: (path: string | null) => void) {
        this.scene = scene;
        this.onTextureChange = onTextureChange;
    }

    apply(texturePath: string, rotation: number = 0, exposure: number = 0): void {
        if (!this.scene) return;

        if (this.currentSkybox) {
            this.currentSkybox.dispose();
            this.currentSkybox = null;
        }

        try {
            this.currentSkybox = new PhotoDome(
                'environmentSkybox',
                texturePath,
                { resolution: 64, size: 1000, useDirectMapping: true },
                this.scene
            );

            if (this.currentSkybox.mesh) {
                this.currentSkybox.mesh.isPickable = false;
                this.currentSkybox.mesh.infiniteDistance = true;
            }

            this.currentSkybox.rotation.y = (rotation * Math.PI) / 180;

            if (this.currentSkybox.material) {
                this.currentSkybox.material.imageProcessingConfiguration.exposure = Math.pow(2, exposure);
            } else {
                this.currentSkybox.onLoadObservable.addOnce(() => {
                    if (this.currentSkybox?.material) {
                        this.currentSkybox.material.imageProcessingConfiguration.exposure = Math.pow(2, exposure);
                    }
                });
            }

            this.onTextureChange?.(texturePath);
        } catch (error) {
            console.error('应用环境贴图失败:', error);
        }
    }

    setRotation(rotation: number): void {
        if (this.currentSkybox) {
            this.currentSkybox.rotation.y = (rotation * Math.PI) / 180;
        }
    }

    setExposure(exposure: number): void {
        if (this.currentSkybox?.material) {
            this.currentSkybox.material.imageProcessingConfiguration.exposure = Math.pow(2, exposure);
        }
    }

    dispose(silent: boolean = false): void {
        if (this.currentSkybox) {
            try {
                this.currentSkybox.dispose();
                this.currentSkybox = null;
                if (!silent) {
                    this.onTextureChange?.(null);
                }
            } catch (error) {
                console.error('销毁环境贴图失败:', error);
            }
        }
    }

    showSelector(previewContainer: HTMLElement, previewPlaceholder: HTMLElement): void {
        const overlay = document.createElement('div');
        overlay.className = 'world-envmap-selector-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'world-envmap-selector-dialog';

        const title = document.createElement('div');
        title.className = 'world-envmap-selector-title';
        title.textContent = '选择环境贴图';

        const listContainer = document.createElement('div');
        listContainer.className = 'world-envmap-selector-list';

        PRESET_ENVIRONMENT_MAPS.forEach((map) => {
            const item = document.createElement('div');
            item.className = 'world-envmap-selector-item';

            const thumbnail = document.createElement('div');
            thumbnail.className = 'world-envmap-selector-thumbnail';

            const img = document.createElement('img');
            img.src = map.preview;
            img.alt = map.name;
            img.onerror = () => { thumbnail.textContent = map.name; };
            thumbnail.appendChild(img);

            const name = document.createElement('div');
            name.className = 'world-envmap-selector-name';
            name.textContent = map.name;

            item.appendChild(thumbnail);
            item.appendChild(name);

            item.addEventListener('click', () => {
                this.handleSelect(map.path, previewContainer, previewPlaceholder);
                document.body.removeChild(overlay);
            });

            listContainer.appendChild(item);
        });

        const importBtn = document.createElement('button');
        importBtn.className = 'world-envmap-selector-import';
        importBtn.textContent = '导入';
        importBtn.addEventListener('click', () => {
            this.handleImport(previewContainer, previewPlaceholder, overlay);
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'world-envmap-selector-close';
        closeBtn.textContent = '取消';
        closeBtn.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'world-envmap-selector-buttons';
        buttonContainer.appendChild(importBtn);
        buttonContainer.appendChild(closeBtn);

        dialog.appendChild(title);
        dialog.appendChild(listContainer);
        dialog.appendChild(buttonContainer);
        overlay.appendChild(dialog);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        document.body.appendChild(overlay);
    }

    private handleSelect(texturePath: string, previewContainer: HTMLElement, previewPlaceholder: HTMLElement): void {
        this.apply(texturePath);
        this.updatePreview(texturePath, previewContainer, previewPlaceholder);
    }

    private updatePreview(texturePath: string, previewContainer: HTMLElement, previewPlaceholder: HTMLElement): void {
        previewPlaceholder.style.display = 'none';

        let previewImg = previewContainer.querySelector('img') as HTMLImageElement;
        if (!previewImg) {
            previewImg = document.createElement('img');
            previewImg.style.width = '100%';
            previewImg.style.height = '100%';
            previewImg.style.objectFit = 'cover';
            previewImg.style.borderRadius = 'inherit';
            previewContainer.appendChild(previewImg);
        }

        const isPresetMap = texturePath.includes('Skybox/');
        if (isPresetMap) {
            const fileName = texturePath.split('/').pop();
            previewImg.src = `Skybox/preview/${fileName}`;
        } else {
            previewImg.src = texturePath;
        }
        previewImg.style.display = 'block';
    }

    private async handleImport(previewContainer: HTMLElement, previewPlaceholder: HTMLElement, overlay: HTMLElement): Promise<void> {
        const platform = Capacitor.getPlatform();

        if (platform === 'android') {
            await this.importOnAndroid(previewContainer, previewPlaceholder, overlay);
        } else {
            await this.importWithFilePicker(previewContainer, previewPlaceholder, overlay);
        }
    }

    private async importOnAndroid(previewContainer: HTMLElement, previewPlaceholder: HTMLElement, overlay: HTMLElement): Promise<void> {
        const result = await mediaPickerManager.pickMedia();
        if (!result) return;

        if (result.mediaType !== 'image') {
            toast.error('请选择图片文件');
            return;
        }

        const loadingToast = toast.loading('正在导入环境贴图...');

        try {
            const envMapManager = EnvironmentMapManager.getInstance();
            const fileName = result.absolutePath.split('/').pop() || 'environment.jpg';
            const cachedPath = await envMapManager.importEnvironmentMap(result.absolutePath, fileName);

            if (cachedPath && typeof cachedPath === 'string') {
                document.body.removeChild(overlay);
                this.apply(cachedPath);
                this.updatePreview(cachedPath, previewContainer, previewPlaceholder);
                toast.success('环境贴图导入成功');
            } else {
                toast.error('导入环境贴图失败');
            }
        } catch (error) {
            console.error('导入环境贴图失败:', error);
            toast.error('导入环境贴图失败');
        } finally {
            loadingToast.dismiss();
        }
    }

    private async importWithFilePicker(previewContainer: HTMLElement, previewPlaceholder: HTMLElement, overlay: HTMLElement): Promise<void> {
        const filePickerUI = new FilePickerUI();
        filePickerUI.setFileFilter(['jpg', 'jpeg', 'png', 'bmp', 'tga']);

        const lastPath = filePathMemory.getPath('environment');

        filePickerUI.show(async (file: FileItem) => {
            if (!isValidImageFile(file.name)) {
                toast.error('不支持的文件格式，请选择图片文件');
                return;
            }

            const loadingToast = toast.loading('正在导入环境贴图...');

            try {
                const envMapManager = EnvironmentMapManager.getInstance();
                const cachedPath = await envMapManager.importEnvironmentMap(file.path, file.name);

                if (cachedPath && typeof cachedPath === 'string') {
                    document.body.removeChild(overlay);
                    this.apply(cachedPath);
                    this.updatePreview(cachedPath, previewContainer, previewPlaceholder);
                    filePathMemory.setPath('environment', file.path);
                    toast.success('环境贴图导入成功');
                } else {
                    toast.error('导入环境贴图失败');
                }
            } catch (error) {
                console.error('导入环境贴图失败:', error);
                toast.error('导入环境贴图失败');
            } finally {
                loadingToast.dismiss();
            }
        }, lastPath ? { startPath: lastPath } : undefined);
    }

    getCurrentSkybox(): PhotoDome | null {
        return this.currentSkybox;
    }
}

export async function clearEnvironmentMapCache(): Promise<boolean> {
    const envMapManager = EnvironmentMapManager.getInstance();
    return await envMapManager.clearAllCache();
}

export async function getCachedEnvironmentMaps(): Promise<{ id: string; name: string; size: number }[]> {
    const envMapManager = EnvironmentMapManager.getInstance();
    const maps = await envMapManager.getCachedMaps();
    return maps.map(map => ({
        id: map.id,
        name: map.name,
        size: map.size
    }));
}

export async function getEnvironmentMapCacheSize(): Promise<number> {
    const envMapManager = EnvironmentMapManager.getInstance();
    return await envMapManager.getCacheSize();
}
