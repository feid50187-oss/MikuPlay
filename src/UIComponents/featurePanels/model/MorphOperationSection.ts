import type { MainWindow } from '../../MainWindow';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { IReadonlyRuntimeMorph } from 'babylon-mmd/esm/Runtime/mmdMorphControllerBase';
import { ModelOptStateManager, type MorphInfo } from '../../../features/state/ModelOptStateManager';
import { ModelStateManager } from '../../../features/mmd/ModelStateManager';
import { Slider } from '../../shared/Slider';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { cancelLazyDestroy, scheduleLazyDestroy } from '../../shared/lazyRender';

export class MorphOperationSection {
    readonly element: HTMLElement;
    private mainWindow: MainWindow | null;
    private unsubscribers: (() => void)[] = [];

    // 每个形态键分类的懒加载状态：展开时才建 Slider，收起后延迟销毁
    private readonly morphCategoryState = new WeakMap<HTMLElement, {
        entries: Array<{ morph: IReadonlyRuntimeMorph; index: number; morphInfo: MorphInfo }>;
        modelId: string;
        mmdModel: MmdModel;
        sliders: Array<{ dispose: () => void }>;
    }>();

    private static readonly CATEGORY_LABELS: Record<number, string> = {
        0: '系统',   // System
        1: '眉',     // Eyebrow
        2: '目',     // Eye
        3: '口',     // Lip
        4: '其他'    // Other
    };

    // Category display order
    private static readonly CATEGORY_ORDER = [0, 1, 2, 3, 4];

    constructor(options: { mainWindow: MainWindow | null }) {
        this.mainWindow = options.mainWindow;
        this.element = this.create();
    }

    private create(): HTMLElement {
        const collapsible = new CollapsibleSection({ title: '变形操作', initiallyExpanded: true });
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
            const morphTreeContainer = document.createElement('div');
            morphTreeContainer.className = 'model-opt-morph-tree';

            models.forEach(model => {
                const modelEntry = this.createMorphModelEntry(model.id, model.name);
                morphTreeContainer.appendChild(modelEntry);
            });

            contentContainer.appendChild(morphTreeContainer);
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
                const morphTreeContainer = document.createElement('div');
                morphTreeContainer.className = 'model-opt-morph-tree';

                updatedModels.forEach(model => {
                    const modelEntry = this.createMorphModelEntry(model.id, model.name);
                    morphTreeContainer.appendChild(modelEntry);
                });

                contentContainer.appendChild(morphTreeContainer);
            }
        });

        return collapsible.element;
    }

    private createMorphModelEntry(modelId: string, modelName: string): HTMLElement {
        const entry = document.createElement('div');
        entry.className = 'model-opt-morph-entry';
        entry.dataset.modelId = modelId;

        const modelRow = document.createElement('div');
        modelRow.className = 'model-opt-morph-row';

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
        nameLabel.className = 'model-opt-morph-name';
        nameLabel.textContent = modelName;

        const morphsContainer = document.createElement('div');
        morphsContainer.className = 'model-opt-morphs-container';
        const morphsInner = document.createElement('div');
        morphsInner.className = 'model-opt-morphs-inner';
        morphsContainer.appendChild(morphsInner);

        modelRow.appendChild(expandIcon);
        modelRow.appendChild(nameLabel);

        modelRow.addEventListener('click', () => {
            const willExpand = !entry.classList.contains('expanded');
            entry.classList.toggle('expanded');
            if (willExpand) {
                cancelLazyDestroy(entry);
                if (entry.dataset.morphsLoaded !== '1') {
                    this.loadMorphsForModel(modelId, morphsInner, entry);
                }
            } else {
                // 折叠：等动画结束再销毁全部分类及其 Slider，真正释放 DOM
                scheduleLazyDestroy(entry, 320, () => {
                    if (!entry.classList.contains('expanded')) {
                        entry.querySelectorAll('.model-opt-morph-category').forEach(g => this.unloadCategorySliders(g as HTMLElement));
                        morphsInner.innerHTML = '';
                        delete entry.dataset.morphsLoaded;
                    }
                });
            }
        });

        entry.appendChild(modelRow);
        entry.appendChild(morphsContainer);

        return entry;
    }

    private loadMorphsForModel(modelId: string, container: HTMLElement, entry: HTMLElement): void {
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
                        // categories are now stored in AnimationManager (captured before metadata trim)
                        const categories = animationManager.getMorphCategories(modelId);
                        this.displayMorphs(modelId, mmdModel!, container, categories);
                        entry.dataset.morphsLoaded = '1';
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
            // Model already exists, categories are stored in AnimationManager
            if (entry.classList.contains('expanded')) {
                const categories = animationManager.getMorphCategories(modelId);
                this.displayMorphs(modelId, mmdModel, container, categories);
                entry.dataset.morphsLoaded = '1';
            }
        }
    }

    private displayMorphs(modelId: string, mmdModel: MmdModel, container: HTMLElement, categories?: number[]): void {
        const morphs = mmdModel.morph.morphs;
        if (morphs.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'model-opt-empty-state';
            emptyState.textContent = '该模型没有形态键';
            container.appendChild(emptyState);
            return;
        }

        // 先清空，保证重复加载（竞态/重新展开）不会产生重复分类
        container.innerHTML = '';

        // If categories not available, try to restore from state
        if (!categories) {
            const existingState = ModelOptStateManager.getInstance().getModelMorphState(modelId);
            if (existingState && existingState.morphs.length === morphs.length) {
                categories = existingState.morphs.map(m => m.category);
            } else {
                // Default all to Other (4) if no category info available
                categories = morphs.map(() => 4);
            }
        }

        const morphInfos: MorphInfo[] = morphs.map((morph, index) => ({
            name: morph.name,
            index: index,
            weight: mmdModel.morph.getMorphWeightFromIndex(index),
            category: categories![index]
        }));

        ModelOptStateManager.getInstance().initializeModelMorphs(modelId, morphInfos);

        // Group morphs by category
        const grouped = this.groupMorphsByCategory(morphInfos, morphs);

        // Create category groups in defined order
        for (const cat of MorphOperationSection.CATEGORY_ORDER) {
            const entries = grouped.get(cat);
            if (!entries || entries.length === 0) continue;

            const categoryGroup = this.createCategoryGroup(cat, entries, modelId, mmdModel);
            container.appendChild(categoryGroup);
        }
    }

    private groupMorphsByCategory(
        morphInfos: MorphInfo[],
        runtimeMorphs: readonly IReadonlyRuntimeMorph[]
    ): Map<number, Array<{ morph: IReadonlyRuntimeMorph; index: number; morphInfo: MorphInfo }>> {
        const grouped = new Map<number, Array<{ morph: IReadonlyRuntimeMorph; index: number; morphInfo: MorphInfo }>>();

        morphInfos.forEach((info, index) => {
            const cat = info.category;
            if (!grouped.has(cat)) {
                grouped.set(cat, []);
            }
            grouped.get(cat)!.push({
                morph: runtimeMorphs[index],
                index: info.index,
                morphInfo: info
            });
        });

        return grouped;
    }

    private createCategoryGroup(
        category: number,
        entries: Array<{ morph: IReadonlyRuntimeMorph; index: number; morphInfo: MorphInfo }>,
        modelId: string,
        mmdModel: MmdModel
    ): HTMLElement {
        const group = document.createElement('div');
        group.className = 'model-opt-morph-category';
        group.dataset.category = String(category);

        // Header row
        const header = document.createElement('div');
        header.className = 'model-opt-morph-category-header';

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
        nameLabel.className = 'model-opt-morph-category-name';
        nameLabel.textContent = MorphOperationSection.CATEGORY_LABELS[category] ?? `分类${category}`;

        header.appendChild(expandIcon);
        header.appendChild(nameLabel);

        // Content container (collapsible via grid animation)
        const contentContainer = document.createElement('div');
        contentContainer.className = 'model-opt-morph-category-content';

        const contentInner = document.createElement('div');
        contentInner.className = 'model-opt-morph-category-inner';
        contentContainer.appendChild(contentInner);

        // 记录该分类的懒加载状态：Slider 仅在首次展开时构建
        this.morphCategoryState.set(group, { entries, modelId, mmdModel, sliders: [] });

        // Toggle expand/collapse（按需渲染 + 延迟销毁）
        header.addEventListener('click', () => {
            const willExpand = !group.classList.contains('expanded');
            group.classList.toggle('expanded');
            if (willExpand) {
                cancelLazyDestroy(group);
                const state = this.morphCategoryState.get(group);
                if (state && state.sliders.length === 0) {
                    this.loadCategorySliders(group);
                }
            } else {
                scheduleLazyDestroy(group, 320, () => {
                    if (!group.classList.contains('expanded')) {
                        this.unloadCategorySliders(group);
                    }
                });
            }
        });

        group.appendChild(header);
        group.appendChild(contentContainer);

        return group;
    }

    private createMorphSlider(modelId: string, morph: IReadonlyRuntimeMorph, index: number, mmdModel: MmdModel): { element: HTMLElement; dispose: () => void } {
        const savedWeight = ModelOptStateManager.getInstance().getMorphWeight(modelId, index);

        const slider = new Slider({
            label: morph.name,
            min: 0,
            max: 1,
            step: 0.01,
            value: savedWeight,
            showValue: true
        });

        slider.onChange((value) => {
            mmdModel.morph.setMorphWeightFromIndex(index, value);
            ModelOptStateManager.getInstance().setMorphWeight(modelId, index, value);
        });

        const unsubscribe = ModelOptStateManager.getInstance().subscribe((state) => {
            const morphState = state.morphStates.get(modelId);
            if (morphState) {
                const morphInfo = morphState.morphs.find(m => m.index === index);
                if (morphInfo && morphInfo.weight !== slider.getValue()) {
                    slider.setValue(morphInfo.weight);
                }
            }
        });

        // 返回可销毁句柄：收起分类时调用，释放 DOM 与订阅
        return {
            element: slider.element,
            dispose: () => {
                unsubscribe();
                slider.dispose();
            }
        };
    }

    private loadCategorySliders(group: HTMLElement): void {
        const state = this.morphCategoryState.get(group);
        if (!state) return;
        const contentInner = group.querySelector('.model-opt-morph-category-inner') as HTMLElement;
        for (const entry of state.entries) {
            const handle = this.createMorphSlider(state.modelId, entry.morph, entry.index, state.mmdModel);
            contentInner.appendChild(handle.element);
            state.sliders.push(handle);
        }
    }

    private unloadCategorySliders(group: HTMLElement): void {
        const state = this.morphCategoryState.get(group);
        if (!state) return;
        for (const handle of state.sliders) {
            handle.dispose();
        }
        state.sliders = [];
        const contentInner = group.querySelector('.model-opt-morph-category-inner') as HTMLElement;
        if (contentInner) {
            contentInner.innerHTML = '';
        }
    }

    dispose(): void {
        // 销毁所有已加载分类的 Slider（含其订阅），避免泄漏
        this.element.querySelectorAll('.model-opt-morph-category').forEach(g => this.unloadCategorySliders(g as HTMLElement));
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.element.remove();
    }
}