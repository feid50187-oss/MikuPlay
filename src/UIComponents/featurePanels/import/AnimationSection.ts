
import type { ModelManager, ModelStateManager, AnimationManager, PersistedAnimationData, PersistedModelData } from '../../../features/mmd';
import { FilePickerUI } from '../../FilePickerUI';
import type { FileItem } from '../../../plugins/FilePicker';
import { filePathMemory } from '../../../utils/FilePathMemory';
import { isValidVmdFile } from '../../../utils/fileValidation';
import { toast } from '../../shared/Toast';
import { showConfirmDialog, showChoiceDialog } from '../../shared/ConfirmDialog';
import { ModelOptStateManager } from '../../../features/state/ModelOptStateManager';
import type { MmdMesh } from 'babylon-mmd/esm/Runtime/mmdMesh';
import { theme } from '../../../styles/theme';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { applyMiddleEllipsis } from '../../../utils/dom';
import { vmdApiService } from '../../../features/mmd/VmdApiService';

export class AnimationSection {
    element: HTMLElement;
    private collapsible!: CollapsibleSection;

    private modelManager: ModelManager;
    private stateManager: ModelStateManager;
    private animationManager: AnimationManager;
    private filePickerUI: FilePickerUI | null = null;
    private motionCardContent: HTMLElement | null = null;

    constructor(
        modelManager: ModelManager,
        stateManager: ModelStateManager,
        animationManager: AnimationManager
    ) {
        this.modelManager = modelManager;
        this.stateManager = stateManager;
        this.animationManager = animationManager;
        this.element = this.create();
    }

    private create(): HTMLElement {
        this.collapsible = new CollapsibleSection({ title: '动作导入', initiallyExpanded: true });
        this.collapsible.element.classList.add('import-card');
        this.collapsible.getContentContainer().style.padding = '0 20px 16px 20px';

        this.motionCardContent = document.createElement('div');
        this.motionCardContent.className = 'motion-list';

        this.collapsible.getContentContainer().appendChild(this.motionCardContent);

        // VMD API 区域
        this.collapsible.getContentContainer().appendChild(this.createVmdApiSection());

        this.updateMotionCardState();

        this.element = this.collapsible.element;
        return this.element;
    }

    /**
     * 创建 VMD API 区域
     * 展示可用于插件开发的 VMD 操作接口
     */
    private createVmdApiSection(): HTMLElement {
        const container = document.createElement('div');
        container.style.cssText = 'border-top:1px solid #e0e0e0;margin-top:12px;padding-top:12px;';

        const title = document.createElement('div');
        title.textContent = 'VMD API（插件开发接口）';
        title.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:8px;';
        container.appendChild(title);

        const desc = document.createElement('div');
        desc.textContent = '以下接口已开放，可通过 vmdApiService 调用：';
        desc.style.cssText = 'font-size:11px;color:#888;margin-bottom:8px;';
        container.appendChild(desc);

        const apiList = [
            { method: 'parseVmd(filePath)', desc: '解析 VMD 文件，返回 MmdAnimation 对象' },
            { method: 'getAnimationInfo(anim)', desc: '获取动画摘要：骨骼名/形变名/最大帧' },
            { method: 'getBoneFrames(anim, boneName)', desc: '获取指定骨骼的所有帧数据' },
            { method: 'getMorphFrames(anim, morphName)', desc: '获取指定形变的所有权重帧' },
            { method: 'getCameraFrames(anim)', desc: '获取镜头动画的所有帧' },
            { method: 'setBoneFrame(anim, boneName, frame, data)', desc: '修改/新增骨骼帧' },
            { method: 'setMorphFrame(anim, morphName, frame, weight)', desc: '修改/新增形变帧' },
            { method: 'exportVmd(anim, fileName)', desc: '导出动画为 VMD 文件' },
            { method: 'listLoadedAnimations()', desc: '列出当前已加载的所有动画' },
            { method: 'loadAnimationToModel(path, name, modelId)', desc: '加载 VMD 到指定模型' }
        ];

        const listEl = document.createElement('div');
        listEl.style.cssText = 'font-family:monospace;font-size:11px;line-height:1.8;';
        apiList.forEach(api => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;';
            const methodEl = document.createElement('span');
            methodEl.style.cssText = 'color:#3b82f6;min-width:220px;';
            methodEl.textContent = api.method;
            const descEl = document.createElement('span');
            descEl.style.cssText = 'color:#666;';
            descEl.textContent = api.desc;
            row.appendChild(methodEl);
            row.appendChild(descEl);
            listEl.appendChild(row);
        });
        container.appendChild(listEl);

        // 初始化按钮
        const initBtn = document.createElement('button');
        initBtn.type = 'button';
        initBtn.className = 'mp-btn small primary';
        initBtn.textContent = '初始化 VMD API';
        initBtn.style.cssText = 'margin-top:10px;';
        initBtn.addEventListener('click', () => {
            vmdApiService.setAnimationManager(this.animationManager);
            toast.success('VMD API 已初始化');
        });
        container.appendChild(initBtn);

        return container;
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

    updateMotionCardState(): void {
        if (!this.motionCardContent) return;

        const models = this.stateManager.getModels();

        if (models.length === 0) {
            this.motionCardContent.innerHTML = '';
            this.motionCardContent.appendChild(this.createEmptyState('暂无模型'));
        } else {
            this.renderMotionModelList(models);
        }
    }

    private createEmptyState(text: string): HTMLElement {
        const state = document.createElement('div');
        state.className = 'empty-state';
        state.textContent = text;
        return state;
    }

    private renderMotionModelList(models: ReadonlyArray<PersistedModelData>): void {
        if (!this.motionCardContent) return;

        this.motionCardContent.innerHTML = '';

        models.forEach(model => {
            const modelEntry = this.createMotionModelEntry(model);
            this.motionCardContent!.appendChild(modelEntry);
        });
    }

    private createMotionModelEntry(model: PersistedModelData): HTMLElement {
        const entryCollapsible = new CollapsibleSection({ title: model.name });
        entryCollapsible.element.classList.add('motion-model-entry');
        entryCollapsible.element.dataset.modelId = model.id;
        entryCollapsible.getContentContainer().style.padding = '0 12px 12px 12px';

        const headerEl = entryCollapsible.element.querySelector('.mp-collapsible-header')!;
        headerEl.classList.add('motion-model-header');

        const arrowEl = entryCollapsible.element.querySelector('.mp-collapsible-arrow')!;
        arrowEl.classList.add('motion-model-expand-icon');

        const titleEl = entryCollapsible.element.querySelector('.mp-collapsible-title') as HTMLElement;
        if (titleEl) {
            applyMiddleEllipsis(titleEl, model.name);
        }

        const animationList = document.createElement('div');
        animationList.className = 'animation-list';
        animationList.dataset.animationList = 'true';

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'motion-button-container';

        const importMotionButton = this.createAddButton('导入动作', () => {
            this.handleImportMotion(model.id);
        });

        const clearButton = document.createElement('button');
        clearButton.className = 'clear-animations-button';
        clearButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>清空动画</span>
        `;
        clearButton.addEventListener('click', async () => {
            const confirmed = await showConfirmDialog({
                title: '清空动画',
                message: '确定要清空所有动画吗？此操作不可恢复。',
                confirmText: '清空',
                cancelText: '取消',
                danger: true
            });
            if (confirmed) {
                await this.clearModelAnimations(model.id, entryCollapsible.element);
            }
        });

        buttonContainer.appendChild(importMotionButton);
        buttonContainer.appendChild(clearButton);

        entryCollapsible.getContentContainer().appendChild(animationList);
        entryCollapsible.getContentContainer().appendChild(buttonContainer);

        if (model.animations && model.animations.length > 0) {
            model.animations.forEach(animation => {
                this.addAnimationToModelEntry(model.id, animation.fileName, entryCollapsible.element);
            });
        }

        return entryCollapsible.element;
    }

    private handleImportMotion(modelId: string): void {
        if (!this.filePickerUI) {
            this.filePickerUI = new FilePickerUI();
        }

        const hasExistingAnimation = this.animationManager.hasAnimation(modelId);

        this.filePickerUI.setFileFilter(['vmd']);

        const lastPath = filePathMemory.getPath('animation');

        this.filePickerUI.show(async (file: FileItem) => {
            if (!isValidVmdFile(file.name)) {
                toast.error(`不支持的格式`);
                return;
            }

            let appendMode: 'blend' | 'append' = 'blend';

            if (hasExistingAnimation) {
                const choice = await showChoiceDialog({
                    title: '追加动画',
                    message: '模型已经绑定动画，请选择追加方式，一般选择混合',
                    cancelText: '取消',
                    options: [
                        { label: '加到末尾', value: 'append' },
                        { label: '混合', value: 'blend', primary: true }
                    ]
                });
                if (choice === null) {
                    return;
                }
                appendMode = choice as 'blend' | 'append';
            }

            try {
                await this.loadAnimation(file.fileUrl || file.path, file.name, modelId, appendMode);
                const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
                filePathMemory.setPath('animation', parentPath);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : '动画加载失败';
                toast.error(errorMessage);
            }
        }, lastPath ? { startPath: lastPath } : undefined);
    }

    private async loadAnimation(filePath: string, fileName: string, modelId: string, appendMode: 'blend' | 'append' = 'blend'): Promise<void> {
        const model = this.modelManager.getModel(modelId);
        if (!model) {
            throw new Error('模型不存在');
        }

        if (!model.mesh) {
            throw new Error('模型尚未加载完成');
        }

        try {
            await this.animationManager.loadAnimation(
                filePath,
                fileName,
                modelId,
                model.mesh as MmdMesh,
                appendMode
            );

            const animationData: PersistedAnimationData = {
                filePath,
                fileName,
                appendMode
            };
            this.stateManager.addAnimation(modelId, animationData);

            const animationCount = this.animationManager.getAnimationCount(modelId);
            if (animationCount > 1) {
                toast.success(`动画加载成功，共 ${animationCount} 个动画`);
            } else {
                toast.success(`动画加载成功`);
            }

            this.addAnimationToModelEntry(modelId, fileName);
        } catch (error) {
            throw error;
        }
    }

    private addAnimationToModelEntry(modelId: string, animationName: string, entryElement?: HTMLElement): void {
        if (!this.motionCardContent) return;

        const entry = entryElement || this.motionCardContent.querySelector(`[data-model-id="${modelId}"]`) as HTMLElement;
        if (!entry) return;

        const header = entry.querySelector('.motion-model-header');
        if (header) {
            let animationBadge = header.querySelector('.animation-badge');
            if (!animationBadge) {
                animationBadge = document.createElement('span');
                animationBadge.className = 'animation-badge';
                header.appendChild(animationBadge);
            }
            const animationCount = this.animationManager.getAnimationCount(modelId) || 0;
            animationBadge.textContent = animationCount > 1 ? `● ${animationCount}` : '●';
            (animationBadge as HTMLElement).style.cssText = `
                color: ${theme.colorAxisY};
                margin-left: 8px;
                font-size: 12px;
            `;
        }

        const animationList = entry.querySelector('[data-animation-list="true"]') as HTMLElement;
        if (animationList) {
            const animationItem = document.createElement('div');
            animationItem.className = 'animation-item';
            animationItem.dataset.animationName = animationName;
            animationItem.innerHTML = `
                <div style="
                    padding: 8px 12px;
                    background: ${theme.activeBg};
                    border-radius: 6px;
                    margin-bottom: 8px;
                    font-size: 13px;
                    color: ${theme.colorAxisY};
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    min-width: 0;
                    overflow: hidden;
                ">
                    <span>▶</span>
                    <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${animationName}
                    </span>
                </div>
            `;
            animationList.appendChild(animationItem);
        }
    }

    private async clearModelAnimations(modelId: string, entryElement: HTMLElement): Promise<void> {
        try {
            this.animationManager.clearAnimations(modelId);

            this.stateManager.removeAnimation(modelId);

            ModelOptStateManager.getInstance().removeModelMorphs(modelId);
            ModelOptStateManager.getInstance().removeModelBones(modelId);

            const animationList = entryElement.querySelector('[data-animation-list="true"]') as HTMLElement;
            if (animationList) {
                animationList.innerHTML = '';
            }

            const header = entryElement.querySelector('.motion-model-header');
            if (header) {
                const animationBadge = header.querySelector('.animation-badge');
                if (animationBadge) {
                    animationBadge.remove();
                }
            }

            toast.success('已清空所有动画');
        } catch (error) {
            console.error('清空动画失败:', error);
            toast.error('清空动画失败');
        }
    }

    dispose(): void {
        if (this.filePickerUI) {
            this.filePickerUI.dispose();
            this.filePickerUI = null;
        }
    }
}
