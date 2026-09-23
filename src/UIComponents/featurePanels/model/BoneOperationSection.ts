
import type { MainWindow } from '../../MainWindow';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { IMmdRuntimeBone } from 'babylon-mmd/esm/Runtime/IMmdRuntimeBone';
import { ModelOptStateManager } from '../../../features/state/ModelOptStateManager';
import { ModelStateManager } from '../../../features/mmd/ModelStateManager';
import { BoneManager } from '../../../features/mmd/BoneManager';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { cancelLazyDestroy, scheduleLazyDestroy } from '../../shared/lazyRender';
import { Events, eventBus } from '../../../core';

interface BoneNode {
    bone: IMmdRuntimeBone;
    children: BoneNode[];
}

interface BoneTree {
    roots: BoneNode[];
    boneMap: Map<string, BoneNode>;
}

export class BoneOperationSection {
    readonly element: HTMLElement;
    private mainWindow: MainWindow | null;
    private unsubscribers: (() => void)[] = [];

    constructor(options: { mainWindow: MainWindow | null }) {
        this.mainWindow = options.mainWindow;
        this.element = this.create();
    }

    private create(): HTMLElement {
        const collapsible = new CollapsibleSection({ title: '骨骼层级', initiallyExpanded: true });
        collapsible.element.classList.add('model-opt-section');
        collapsible.getContentContainer().style.padding = '0';

        const contentContainer = collapsible.getContentContainer();

        const stateManager = ModelStateManager.getInstance();
        const models = stateManager.getModels();

        if (models.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'model-opt-empty-state';
            emptyState.textContent = '暂无已加载模型';
            contentContainer.appendChild(emptyState);
        } else {
            const boneTreeContainer = document.createElement('div');
            boneTreeContainer.className = 'model-opt-bone-tree';

            models.forEach(model => {
                ModelOptStateManager.getInstance().initializeModelEnabledState(model.id);
                const modelEntry = this.createBoneModelEntry(model.id, model.name);
                boneTreeContainer.appendChild(modelEntry);
                const isEnabled = ModelOptStateManager.getInstance().isModelEnabled(model.id);
                this.setModelVisibility(model.id, isEnabled);
            });

            contentContainer.appendChild(boneTreeContainer);
        }

        stateManager.onStateChange((state) => {
            contentContainer.innerHTML = '';
            const updatedModels = state.models;

            if (updatedModels.length === 0) {
                const emptyState = document.createElement('div');
                emptyState.className = 'model-opt-empty-state';
                emptyState.textContent = '暂无已加载模型';
                contentContainer.appendChild(emptyState);
            } else {
                const boneTreeContainer = document.createElement('div');
                boneTreeContainer.className = 'model-opt-bone-tree';

                updatedModels.forEach(model => {
                    ModelOptStateManager.getInstance().initializeModelEnabledState(model.id);
                    const modelEntry = this.createBoneModelEntry(model.id, model.name);
                    boneTreeContainer.appendChild(modelEntry);
                    const isEnabled = ModelOptStateManager.getInstance().isModelEnabled(model.id);
                    this.setModelVisibility(model.id, isEnabled);
                });

                contentContainer.appendChild(boneTreeContainer);
            }
        });

        const section = collapsible.element;

        const unsubscribeModelEnabled = eventBus.on(Events.MODEL_VISIBILITY_CHANGED, ({ modelId: changedModelId, visible: enabled }) => {
            const entry = section.querySelector(`[data-model-id="${changedModelId}"]`) as HTMLElement;
            if (entry) {
                const controller = entry.querySelector('.model-opt-circle-controller');
                if (controller) {
                    if (enabled) {
                        controller.classList.add('enabled');
                    } else {
                        controller.classList.remove('enabled');
                    }
                }
            }
        });
        this.unsubscribers.push(unsubscribeModelEnabled);

        const unsubscribeModelSelection = eventBus.on(Events.MODEL_SELECTED, (selectedModelId) => {
            section.querySelectorAll('.model-opt-bone-entry').forEach(el => el.classList.remove('selected'));
            section.querySelectorAll('.model-opt-bone-item').forEach(el => el.classList.remove('selected'));
            if (selectedModelId) {
                const entry = section.querySelector(`[data-model-id="${selectedModelId}"]`) as HTMLElement;
                if (entry) {
                    entry.classList.add('selected');
                }
            }
        });
        this.unsubscribers.push(unsubscribeModelSelection);

        return section;
    }

    private createBoneModelEntry(modelId: string, modelName: string): HTMLElement {
        const entry = document.createElement('div');
        entry.className = 'model-opt-bone-entry';
        entry.dataset.modelId = modelId;

        const modelRow = document.createElement('div');
        modelRow.className = 'model-opt-bone-row';

        const controller = document.createElement('div');
        const isEnabled = ModelOptStateManager.getInstance().isModelEnabled(modelId);
        controller.className = `model-opt-circle-controller${isEnabled ? ' enabled' : ''}`;

        controller.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentlyEnabled = controller.classList.contains('enabled');
            const newEnabled = !currentlyEnabled;
            if (newEnabled) {
                controller.classList.add('enabled');
            } else {
                controller.classList.remove('enabled');
            }
            ModelOptStateManager.getInstance().setModelEnabled(modelId, newEnabled);
            this.setModelVisibility(modelId, newEnabled);
            eventBus.emit(Events.MODEL_VISIBILITY_CHANGED, { modelId, visible: newEnabled });
        });

        const expandIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        expandIcon.setAttribute('class', 'model-opt-expand-icon');
        expandIcon.setAttribute('viewBox', '0 0 24 24');
        expandIcon.setAttribute('fill', 'none');
        expandIcon.setAttribute('stroke', 'currentColor');
        expandIcon.setAttribute('stroke-width', '2');
        expandIcon.setAttribute('stroke-linecap', 'round');
        expandIcon.setAttribute('stroke-linejoin', 'round');
        expandIcon.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>';

        const nameLabel = document.createElement('span');
        nameLabel.className = 'model-opt-bone-name';
        nameLabel.textContent = modelName;

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'model-opt-bone-children';
        const childrenInner = document.createElement('div');
        childrenInner.className = 'model-opt-bone-children-inner';
        childrenContainer.appendChild(childrenInner);

        modelRow.appendChild(controller);
        modelRow.appendChild(expandIcon);
        modelRow.appendChild(nameLabel);

        // IK 开关按钮
        const ikBtn = document.createElement('button');
        ikBtn.className = 'model-opt-ik-btn';
        const animManager = this.mainWindow?.getAnimationManager();
        const isIkOn = animManager?.getModelIkEnabled(modelId) ?? true;
        ikBtn.textContent = isIkOn ? 'IK开' : 'IK关';
        if (isIkOn) {
            ikBtn.classList.add('active');
        }
        ikBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const mgr = this.mainWindow?.getAnimationManager();
            if (!mgr) return;
            const current = mgr.getModelIkEnabled(modelId) ?? true;
            const next = !current;
            mgr.setModelIkEnabled(modelId, next);
            ikBtn.classList.toggle('active', next);
            ikBtn.textContent = next ? 'IK开' : 'IK关';
        });
        modelRow.appendChild(ikBtn);

        modelRow.addEventListener('click', () => {
            this.element.querySelectorAll('.model-opt-bone-entry').forEach(el => el.classList.remove('selected'));
            this.element.querySelectorAll('.model-opt-bone-item').forEach(el => el.classList.remove('selected'));
            entry.classList.add('selected');
            ModelOptStateManager.getInstance().selectModel(modelId);
            eventBus.emit(Events.MODEL_SELECTED, modelId);

            const willExpand = !entry.classList.contains('expanded');
            entry.classList.toggle('expanded');
            if (willExpand) {
                cancelLazyDestroy(entry);
                if (entry.dataset.bonesLoaded !== '1') {
                    this.loadBonesForModel(modelId, childrenInner, entry);
                }
            } else {
                // 折叠：等动画结束再销毁整棵骨骼树，真正释放 DOM 节点
                scheduleLazyDestroy(entry, 320, () => {
                    if (!entry.classList.contains('expanded')) {
                        while (childrenInner.firstChild) {
                            childrenInner.removeChild(childrenInner.firstChild);
                        }
                        delete entry.dataset.bonesLoaded;
                    }
                });
            }
        });

        entry.appendChild(modelRow);
        entry.appendChild(childrenContainer);

        return entry;
    }

    private setModelVisibility(modelId: string, visible: boolean): void {
        const modelManager = this.mainWindow?.getModelManager();
        if (modelManager) {
            modelManager.setModelVisible(modelId, visible);
        }
    }

    private loadBonesForModel(modelId: string, container: HTMLElement, entry: HTMLElement): void {
        const animationManager = this.mainWindow?.getAnimationManager();
        const modelManager = this.mainWindow?.getModelManager();

        if (!animationManager || !modelManager) {
            const emptyState = document.createElement('div');
            emptyState.className = 'model-opt-empty-state';
            emptyState.textContent = '管理器未初始化';
            container.appendChild(emptyState);
            return;
        }

        let mmdModel = animationManager.getMmdModel(modelId);

        if (!mmdModel) {
            const modelInfo = modelManager.getModel(modelId);
            if (!modelInfo || !modelInfo.mesh) {
                const emptyState = document.createElement('div');
                emptyState.className = 'model-opt-empty-state';
                emptyState.textContent = '模型未加载';
                container.appendChild(emptyState);
                return;
            }

            animationManager.createMmdModel(modelId, modelInfo.mesh as any)
                .then((model) => {
                    mmdModel = model;
                    // 仅在仍处于展开态时渲染，避免折叠后又被异步结果回填
                    if (entry.classList.contains('expanded')) {
                        this.displayBones(mmdModel!, container);
                        entry.dataset.bonesLoaded = '1';
                    }
                })
                .catch((error) => {
                    console.error('创建MMD模型失败:', error);
                    if (entry.classList.contains('expanded')) {
                        const emptyState = document.createElement('div');
                        emptyState.className = 'model-opt-empty-state';
                        emptyState.textContent = '创建模型失败';
                        container.appendChild(emptyState);
                    }
                });
        } else {
            if (entry.classList.contains('expanded')) {
                this.displayBones(mmdModel, container);
                entry.dataset.bonesLoaded = '1';
            }
        }
    }

    private displayBones(mmdModel: MmdModel, container: HTMLElement): void {
        const runtimeBones = mmdModel.runtimeBones;
        if (runtimeBones.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'model-opt-empty-state';
            emptyState.textContent = '该模型没有骨骼';
            container.appendChild(emptyState);
            return;
        }

        // 先清空，保证重复加载（竞态/重新展开）不会产生重复节点
        container.innerHTML = '';

        const boneTree = this.buildBoneTree(runtimeBones);

        boneTree.roots.forEach(rootBone => {
            const boneItem = this.createBoneItem(rootBone);
            container.appendChild(boneItem);
        });
    }

    private buildBoneTree(runtimeBones: readonly IMmdRuntimeBone[]): BoneTree {
        const boneMap = new Map<string, BoneNode>();
        const roots: BoneNode[] = [];

        runtimeBones.forEach(bone => {
            boneMap.set(bone.name, {
                bone,
                children: []
            });
        });

        runtimeBones.forEach(bone => {
            const node = boneMap.get(bone.name)!;
            if (bone.parentBone) {
                const parentNode = boneMap.get(bone.parentBone.name);
                if (parentNode) {
                    parentNode.children.push(node);
                } else {
                    roots.push(node);
                }
            } else {
                roots.push(node);
            }
        });

        return { roots, boneMap };
    }

    private createBoneItem(boneNode: BoneNode): HTMLElement {
        const item = document.createElement('div');
        item.className = 'model-opt-bone-item';
        item.dataset.boneId = boneNode.bone.name;

        const row = document.createElement('div');
        row.className = 'model-opt-bone-row';

        const expandIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        expandIcon.setAttribute('class', 'model-opt-expand-icon');
        expandIcon.setAttribute('viewBox', '0 0 24 24');
        expandIcon.setAttribute('fill', 'none');
        expandIcon.setAttribute('stroke', 'currentColor');
        expandIcon.setAttribute('stroke-width', '2');
        expandIcon.setAttribute('stroke-linecap', 'round');
        expandIcon.setAttribute('stroke-linejoin', 'round');
        expandIcon.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>';

        if (boneNode.children.length === 0) {
            expandIcon.style.visibility = 'hidden';
        }

        const nameLabel = document.createElement('span');
        nameLabel.className = 'model-opt-bone-name';
        nameLabel.textContent = boneNode.bone.name;

        row.appendChild(expandIcon);
        row.appendChild(nameLabel);

        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'model-opt-bone-children';
        const childrenInner = document.createElement('div');
        childrenInner.className = 'model-opt-bone-children-inner';
        childrenContainer.appendChild(childrenInner);

        expandIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            const willExpand = !item.classList.contains('expanded');
            item.classList.toggle('expanded');
            if (willExpand) {
                // 重新展开时取消可能待执行的销毁
                cancelLazyDestroy(item);
                // 仅首次展开时按需构建子骨骼，避免一次性全量渲染整棵树
                if (!item.dataset.loaded) {
                    boneNode.children.forEach(childNode => {
                        childrenInner.appendChild(this.createBoneItem(childNode));
                    });
                    item.dataset.loaded = '1';
                }
            } else {
                // 折叠：等动画结束后销毁子节点，真正释放 DOM
                scheduleLazyDestroy(item, 320, () => {
                    if (!item.classList.contains('expanded')) {
                        while (childrenInner.firstChild) {
                            childrenInner.removeChild(childrenInner.firstChild);
                        }
                        delete item.dataset.loaded;
                    }
                });
            }
        });

        row.addEventListener('click', () => {
            this.element.querySelectorAll('.model-opt-bone-entry').forEach(el => el.classList.remove('selected'));
            this.element.querySelectorAll('.model-opt-bone-item').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');

            const modelId = this.getFirstAncestorModelId(item);
            const boneName = boneNode.bone.name;

            ModelOptStateManager.getInstance().setSelectedBone(modelId, boneName);

            if (modelId) {
                const boneManager = BoneManager.getInstance();
                boneManager.restoreBoneTransform(modelId, boneName);
            }
        });

        item.appendChild(row);
        item.appendChild(childrenContainer);

        return item;
    }

    private getFirstAncestorModelId(element: HTMLElement): string | null {
        let current: HTMLElement | null = element;
        while (current) {
            const entry = current.closest('.model-opt-bone-entry') as HTMLElement | null;
            if (entry && entry.dataset.modelId) {
                return entry.dataset.modelId;
            }
            current = current.parentElement;
        }
        return null;
    }

    dispose(): void {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.element.remove();
    }
}
