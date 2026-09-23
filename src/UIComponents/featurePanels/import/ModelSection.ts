import type { ModelManager, ModelStateManager, ModelInfo } from '../../../features/mmd';
import { FilePickerUI } from '../../FilePickerUI';
import type { FileItem } from '../../../plugins/FilePicker';
import { filePathMemory } from '../../../utils/FilePathMemory';
import { isValidModelFile } from '../../../utils/fileValidation';
import { toast } from '../../shared/Toast';
import { showConfirmDialog } from '../../shared/ConfirmDialog';
import { ModelOptStateManager } from '../../../features/state/ModelOptStateManager';
import { shadingStateManager } from '../../../features/state';
import { getCdpHandle } from '../../../utils/cdpClient';
import { Logger } from '@babylonjs/core';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { applyMiddleEllipsis } from '../../../utils/dom';

export class ModelSection {
    element: HTMLElement;
    private collapsible!: CollapsibleSection;

    private modelManager: ModelManager;
    private stateManager: ModelStateManager;
    private animationManager: {
        createMmdModel: (id: string, mesh: any) => Promise<any>;
        destroyMmdModel: (id: string) => void;
        hasAnimation: (id: string) => boolean;
        getMmdRuntime: () => { initializeAllMmdModelsPhysics: (onlyAnimated: boolean) => void } | null;
    };
    private filePickerUI: FilePickerUI | null = null;
    private modelListContainer: HTMLElement | null = null;
    private resetPhysicsButton: HTMLElement | null = null;
    private onModelChange: () => void;

    constructor(
        modelManager: ModelManager,
        stateManager: ModelStateManager,
        animationManager: {
            createMmdModel: (id: string, mesh: any) => Promise<any>;
            destroyMmdModel: (id: string) => void;
            hasAnimation: (id: string) => boolean;
            getMmdRuntime: () => { initializeAllMmdModelsPhysics: (onlyAnimated: boolean) => void } | null;
        },
        onModelChange: () => void
    ) {
        this.modelManager = modelManager;
        this.stateManager = stateManager;
        this.animationManager = animationManager;
        this.onModelChange = onModelChange;
        this.element = this.create();
    }

    private create(): HTMLElement {
        this.collapsible = new CollapsibleSection({ title: '模型导入', initiallyExpanded: true });
        this.collapsible.element.classList.add('import-card');
        this.collapsible.getContentContainer().style.padding = '0 20px 16px 20px';

        this.modelListContainer = document.createElement('div');
        this.modelListContainer.className = 'model-list';

        const contentContainer = this.collapsible.getContentContainer();
        contentContainer.insertBefore(this.modelListContainer, contentContainer.firstChild);

        this.resetPhysicsButton = this.createResetPhysicsButton();
        contentContainer.appendChild(this.resetPhysicsButton);

        const addModelButton = this.createAddButton('添加模型', () => this.handleAddModel());
        contentContainer.appendChild(addModelButton);

        this.refreshModelListUI();

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

    private createResetPhysicsButton(): HTMLElement {
        const button = document.createElement('button');
        button.className = 'add-button reset-physics-button';
        button.style.display = 'none';
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor">
                <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/>
            </svg>
            <span>重置刚体</span>
        `;

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.handleResetPhysics();
        });

        return button;
    }

    //重置刚体位置
    private handleResetPhysics(): void {
        const models = this.stateManager.getModels();
        if (models.length === 0) {
            toast.info('没有已加载的模型');
            return;
        }

        const mmdRuntime = this.animationManager.getMmdRuntime();
        if (!mmdRuntime) {
            toast.error('MMD运行时未初始化');
            return;
        }

        mmdRuntime.initializeAllMmdModelsPhysics(false);
        toast.success(`已重置模型刚体`);
    }

    private handleAddModel(): void {
        if (!this.filePickerUI) {
            this.filePickerUI = new FilePickerUI();
        }

        this.filePickerUI.setFileFilter(['pmx', 'pmd', 'bpmx']);

        const lastPath = filePathMemory.getPath('model');

        this.filePickerUI.show(async (file: FileItem) => {
            if (!isValidModelFile(file.name)) {
                toast.error(`不支持的格式: ${file.name}\n仅支持PMX、PMD和BPMX格式`);
                return;
            }

            try {
                await this.loadModel(file.fileUrl || file.path, file.name);
                const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
                filePathMemory.setPath('model', parentPath);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : '模型加载失败';
                toast.error(errorMessage);
            }
        }, lastPath ? { startPath: lastPath } : undefined);
    }

    private async loadModel(filePath: string, fileName: string): Promise<void> {
        let textureNotFound = false;
        const originalLoggerError = Logger.Error;

        // 拦截 BabylonJS Logger.Error 来捕获纹理加载错误
        Logger.Error = (message: string | any[], limit?: number) => {
            const msg = Array.isArray(message) ? message[0] : message;
            if (/Failed to load.*texture/i.test(msg)) {
                textureNotFound = true;
            }
            originalLoggerError.call(Logger, message, limit);
        };

        try {
            const model = await this.modelManager.loadModel(filePath, fileName);

            this.stateManager.addModel(model);
            this.addModelItemToUI(model);
            this.onModelChange();

            if (model.mesh) {
                try {
                    await this.animationManager.createMmdModel(model.id, model.mesh);
                } catch (error) {
                    console.warn('[ModelSection] 预创建 MmdModel 失败:', error);
                }
            }

            ModelOptStateManager.getInstance().selectModel(model.id);

            // 纹理加载是异步的，短暂等待以捕获可能的纹理错误
            // 最多等待 300ms，每 50ms 检查一次
            const maxWaitTime = 300;
            const checkInterval = 50;
            let waitedTime = 0;

            while (waitedTime < maxWaitTime) {
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                waitedTime += checkInterval;

                // 如果已经检测到错误，立即退出等待
                if (textureNotFound) {
                    break;
                }
            }

            if (textureNotFound) {
                toast.error('有贴图未找到，请检查贴图是否存在或贴图名称是否乱码');
            } else {
                toast.success(`"${fileName}"加载成功`,1000);
            }
        } catch (error) {
            throw error;
        } finally {
            Logger.Error = originalLoggerError;
        }
    }

    private addModelItemToUI(model: ModelInfo): void {
        if (!this.modelListContainer) return;

        const item = this.createModelItem(model);
        this.modelListContainer.appendChild(item);
        this.updateResetPhysicsButtonVisibility();
    }

    private createModelItem(model: ModelInfo): HTMLElement {
        const item = document.createElement('div');
        item.className = 'model-item';
        item.dataset.modelId = model.id;

        const nameElement = document.createElement('span');
        nameElement.className = 'model-name';
        applyMiddleEllipsis(nameElement, model.name);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'model-delete-button';
        deleteButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;

        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            await this.handleDeleteModel(model.id, item);
        });

        item.appendChild(nameElement);
        item.appendChild(deleteButton);

        return item;
    }

    private async handleDeleteModel(modelId: string, itemElement: HTMLElement): Promise<void> {
        const confirmed = await showConfirmDialog({
            title: '删除模型',
            message: '确定要删除此模型吗？此操作不可恢复。',
            confirmText: '删除',
            cancelText: '取消',
            danger: true
        });

        if (!confirmed) return;

        try {
            this.animationManager.destroyMmdModel(modelId);

            await this.modelManager.deleteModel(modelId);

            this.stateManager.removeModel(modelId);

            ModelOptStateManager.getInstance().removeModelMorphs(modelId);
            ModelOptStateManager.getInstance().removeModelBones(modelId);
            ModelOptStateManager.getInstance().removeModelEnabledState(modelId);
            shadingStateManager.removeModel(modelId);

            if (itemElement.parentElement) {
                itemElement.parentElement.removeChild(itemElement);
            }

            // 处理模型选中状态：如果删除的是当前选中的模型，需要更新选中状态
            const selectedModelId = ModelOptStateManager.getInstance().getSelectedModel();
            if (selectedModelId === modelId) {
                // 尝试选择另一个模型
                const remainingModels = this.stateManager.getModels();
                if (remainingModels.length > 0) {
                    ModelOptStateManager.getInstance().selectModel(remainingModels[0].id);
                } else {
                    ModelOptStateManager.getInstance().selectModel(null);
                }
            }

            this.updateResetPhysicsButtonVisibility();
            this.onModelChange();

            toast.success('模型已删除');

            // 执行垃圾回收
            await this.executeGc();
        } catch (error) {
            console.error('删除模型失败:', error);
            toast.error('删除模型失败');
        }
    }

    private async executeGc(): Promise<void> {
        try {
            const handle = getCdpHandle();
            await handle.send('HeapProfiler.enable');
            await handle.send('HeapProfiler.collectGarbage');
            //toast.success('垃圾回收成功');
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            toast.info(`垃圾回收失败，但不影响继续使用：${errorMsg}`);
        }
    }

    refreshModelListUI(): void {
        if (!this.modelListContainer) return;

        const models = this.stateManager.getModels();

        this.modelListContainer.innerHTML = '';

        models.forEach(model => {
            const item = this.createModelItem({
                id: model.id,
                name: model.name,
                filePath: model.filePath,
                fileType: model.fileType,
                mesh: null,
                container: null
            });
            this.modelListContainer!.appendChild(item);
        });

        this.updateResetPhysicsButtonVisibility();
    }

    private updateResetPhysicsButtonVisibility(): void {
        if (!this.resetPhysicsButton) return;

        const models = this.stateManager.getModels();
        const hasModels = models.length > 0;
        this.resetPhysicsButton.style.display = hasModels ? 'flex' : 'none';
    }

    dispose(): void {
        if (this.filePickerUI) {
            this.filePickerUI.dispose();
            this.filePickerUI = null;
        }
    }
}
