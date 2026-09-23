
import type { MainWindow } from '../../MainWindow';
import type { MmdModel } from 'babylon-mmd/esm/Runtime/mmdModel';
import type { Material } from '@babylonjs/core/Materials/material';
import { ModelStateManager } from '../../../features/mmd/ModelStateManager';
import { ModelOptStateManager } from '../../../features/state/ModelOptStateManager';
import { shadingStateManager } from '../../../features/state';

interface MaterialSlot {
    name: string;
    index: number;
}

export class MaterialListSection {
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private materialListContent: HTMLElement | null = null;
    private currentMaterials: MaterialSlot[] = [];
    private selectedMaterialIndex: number | null = null;
    private currentModelId: string | null = null;
    private currentMmdModel: MmdModel | null = null;

    onMaterialSelected: (index: number) => void = () => {};

    private _materialMenu: HTMLElement | null = null;
    private _menuOutsideHandler: ((e: PointerEvent) => void) | null = null;
    private _longPressTimers = new Map<HTMLElement, number>();

    constructor(options: { mainWindow: MainWindow | null }) {
        this.mainWindow = options.mainWindow;
        this.element = this.create();
    }

    private create(): HTMLElement {
        const materialList = document.createElement('div');
        materialList.className = 'shading-material-list';

        this.materialListContent = document.createElement('div');
        this.materialListContent.className = 'shading-material-list-content';
        this.materialListContent.id = 'shading-material-list';

        materialList.appendChild(this.materialListContent);

        return materialList;
    }

    updateMaterialList(modelId: string | null): void {
        if (!this.materialListContent) {
            return;
        }

        this.materialListContent.innerHTML = '';
        this.currentMaterials = [];
        this.selectedMaterialIndex = null;
        this.currentModelId = modelId;
        this.currentMmdModel = null;

        if (!modelId) {
            const emptyState = document.createElement('div');
            emptyState.className = 'shading-empty-state';
            emptyState.textContent = '请先选择一个模型';
            this.materialListContent.appendChild(emptyState);
            return;
        }

        const animationManager = this.mainWindow?.getAnimationManager();

        if (!animationManager) {
            const emptyState = document.createElement('div');
            emptyState.className = 'shading-empty-state';
            emptyState.textContent = '管理器未初始化';
            this.materialListContent.appendChild(emptyState);
            return;
        }

        let mmdModel: MmdModel | null = animationManager.getMmdModel(modelId) ?? null;

        if (!mmdModel) {
            const modelManager = this.mainWindow?.getModelManager();
            if (modelManager) {
                const modelInfo = modelManager.getModel(modelId);
                if (modelInfo && modelInfo.mesh) {
                    animationManager.createMmdModel(modelId, modelInfo.mesh as any)
                        .then((model) => {
                            this.currentMmdModel = model;
                            this.renderMaterialSlots(model, this.materialListContent!, modelId);
                            this.restoreSelectedMaterial(modelId);
                        })
                        .catch(() => {
                            const emptyState = document.createElement('div');
                            emptyState.className = 'shading-empty-state';
                            emptyState.textContent = '加载模型失败';
                            this.materialListContent!.appendChild(emptyState);
                        });
                    return;
                }
            }

            const emptyState = document.createElement('div');
            emptyState.className = 'shading-empty-state';
            emptyState.textContent = '模型未加载';
            this.materialListContent.appendChild(emptyState);
            return;
        }

        this.currentMmdModel = mmdModel;
        this.renderMaterialSlots(mmdModel, this.materialListContent, modelId);
        this.restoreSelectedMaterial(modelId);
    }

    renderMaterialSlots(mmdModel: MmdModel, container: HTMLElement, modelId: string): void {
        const materials = mmdModel.mesh.metadata.materials;

        if (!materials || materials.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'shading-empty-state';
            emptyState.textContent = '该模型没有材质';
            container.appendChild(emptyState);
            return;
        }

        this.currentMaterials = materials.map((mat: Material, index: number) => ({
            name: mat.name,
            index: index
        }));

        this.currentMaterials.forEach((material) => {
            const item = document.createElement('div');
            item.className = 'shading-material-item';
            item.dataset.index = material.index.toString();

            const indicator = document.createElement('div');
            indicator.className = 'shading-material-indicator active';

            const savedState = shadingStateManager.getMaterialState(modelId, material.index);
            const isVisible = savedState?.isVisible ?? true;

            if (!isVisible) {
                indicator.classList.remove('active');
                indicator.classList.add('inactive');
            }

            indicator.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.toggleMaterialVisibility(modelId, material.index, indicator, mmdModel);
            });

            const nameLabel = document.createElement('span');
            nameLabel.className = 'shading-material-name';
            nameLabel.textContent = `${material.index + 1}.${material.name}`;

            item.appendChild(indicator);
            item.appendChild(nameLabel);

            // 长按弹出 全选/反选 菜单（移动端优先，桌面长按同样可用）
            let longPressTriggered = false;
            let startX = 0;
            let startY = 0;

            item.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                longPressTriggered = false;
                startX = e.clientX;
                startY = e.clientY;
                this.clearLongPress(item);
                const timer = window.setTimeout(() => {
                    this._longPressTimers.delete(item);
                    longPressTriggered = true;
                    this.showMaterialMenu(item);
                }, 500);
                this._longPressTimers.set(item, timer);
            });

            item.addEventListener('pointermove', (e) => {
                const timer = this._longPressTimers.get(item);
                if (timer === undefined) return;
                if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
                    this.clearLongPress(item);
                }
            });

            item.addEventListener('pointerup', () => this.clearLongPress(item));
            item.addEventListener('pointercancel', () => this.clearLongPress(item));
            item.addEventListener('pointerleave', () => this.clearLongPress(item));

            item.addEventListener('click', () => {
                if (longPressTriggered) {
                    longPressTriggered = false;
                    return; // 长按结束的抬起不视为选择
                }
                this.selectMaterial(material.index);
            });

            container.appendChild(item);

        });
    }

    /** 取消 item 上未触发的长按计时器 */
    private clearLongPress(item: HTMLElement): void {
        const timer = this._longPressTimers.get(item);
        if (timer !== undefined) {
            clearTimeout(timer);
            this._longPressTimers.delete(item);
        }
    }

    /** 在长按的材质项附近弹出 全选/反选 菜单 */
    private showMaterialMenu(anchor: HTMLElement): void {
        this.hideMaterialMenu();

        const menu = document.createElement('div');
        menu.className = 'shading-material-menu';

        const selectAllBtn = document.createElement('div');
        selectAllBtn.className = 'shading-material-menu-item';
        selectAllBtn.textContent = '全选';
        selectAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.currentModelId) {
                this.applyVisibilityToAll(this.currentModelId, 'select-all');
            }
            this.hideMaterialMenu();
        });

        const invertBtn = document.createElement('div');
        invertBtn.className = 'shading-material-menu-item';
        invertBtn.textContent = '反选';
        invertBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.currentModelId) {
                this.applyVisibilityToAll(this.currentModelId, 'invert');
            }
            this.hideMaterialMenu();
        });

        menu.appendChild(selectAllBtn);
        menu.appendChild(invertBtn);
        // 菜单内交互不触发外部点击关闭
        menu.addEventListener('pointerdown', (e) => e.stopPropagation());

        document.body.appendChild(menu);

        // 定位到 anchor 下方，视口内不溢出
        const anchorRect = anchor.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        let left = anchorRect.left;
        let top = anchorRect.bottom + 4;
        if (left + menuRect.width > window.innerWidth - 8) {
            left = window.innerWidth - menuRect.width - 8;
        }
        if (top + menuRect.height > window.innerHeight - 8) {
            top = Math.max(8, anchorRect.top - menuRect.height - 4);
        }
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;

        this._materialMenu = menu;

        // 点击菜单外任意处关闭
        this._menuOutsideHandler = (e: PointerEvent) => {
            if (this._materialMenu && !this._materialMenu.contains(e.target as Node)) {
                this.hideMaterialMenu();
            }
        };
        document.addEventListener('pointerdown', this._menuOutsideHandler);
    }

    private hideMaterialMenu(): void {
        if (this._materialMenu) {
            this._materialMenu.remove();
            this._materialMenu = null;
        }
        if (this._menuOutsideHandler) {
            document.removeEventListener('pointerdown', this._menuOutsideHandler);
            this._menuOutsideHandler = null;
        }
    }

    /**
     * 批量设置所有材质可见性。
     * select-all：全部设为可见；invert：逐个翻转当前可见状态。
     */
    private applyVisibilityToAll(modelId: string, mode: 'select-all' | 'invert'): void {
        const mmdModel = this.currentMmdModel;
        if (!mmdModel) return;
        const meshes = mmdModel.mesh.metadata.meshes;
        const materials = mmdModel.mesh.metadata.materials;
        if (!materials) return;

        this.currentMaterials.forEach((material) => {
            const savedState = shadingStateManager.getMaterialState(modelId, material.index);
            const currentVisible = savedState?.isVisible ?? true;
            const newVisible = mode === 'select-all' ? true : !currentVisible;

            const targetMaterial = materials[material.index];
            if (targetMaterial) {
                for (const mesh of meshes) {
                    if (mesh.material === targetMaterial) {
                        mesh.isVisible = newVisible;
                    }
                }
            }

            shadingStateManager.updateMaterialState(modelId, material.index, { isVisible: newVisible });

            // 同步 indicator 样式
            const item = this.materialListContent?.querySelector(
                `.shading-material-item[data-index="${material.index}"]`
            );
            const indicator = item?.querySelector('.shading-material-indicator');
            if (indicator) {
                if (newVisible) {
                    indicator.classList.add('active');
                    indicator.classList.remove('inactive');
                } else {
                    indicator.classList.remove('active');
                    indicator.classList.add('inactive');
                }
            }
        });
    }

    toggleMaterialVisibility(modelId: string, materialIndex: number, indicator: HTMLElement, mmdModel: MmdModel): void {
        const savedState = shadingStateManager.getMaterialState(modelId, materialIndex);
        const currentVisible = savedState?.isVisible ?? true;
        const newVisible = !currentVisible;

        const meshes = mmdModel.mesh.metadata.meshes;
        const targetMaterial = mmdModel.mesh.metadata.materials[materialIndex];

        for (const mesh of meshes) {
            if (mesh.material === targetMaterial) {
                mesh.isVisible = newVisible;
            }
        }

        shadingStateManager.updateMaterialState(modelId, materialIndex, { isVisible: newVisible });

        if (newVisible) {
            indicator.classList.add('active');
            indicator.classList.remove('inactive');
        } else {
            indicator.classList.remove('active');
            indicator.classList.add('inactive');
        }
    }

    restoreSelectedMaterial(modelId: string): void {
        const savedIndex = shadingStateManager.getSelectedMaterialIndex(modelId);
        if (savedIndex !== null && savedIndex < this.currentMaterials.length) {
            this.selectMaterial(savedIndex);
        }
    }

    getCurrentModelId(): string | null {
        return this.currentModelId;
    }

    getCurrentMmdModel(): MmdModel | null {
        return this.currentMmdModel;
    }

    getCurrentMaterials(): MaterialSlot[] {
        return this.currentMaterials;
    }

    selectMaterial(index: number): void {
        this.selectedMaterialIndex = index;

        if (this.currentModelId) {
            shadingStateManager.setSelectedMaterialIndex(this.currentModelId, index);
        }

        const items = document.querySelectorAll('.shading-material-item');
        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });

        this.onMaterialSelected(index);
    }

    dispose(): void {
        this.hideMaterialMenu();
        this._longPressTimers.forEach((timer) => clearTimeout(timer));
        this._longPressTimers.clear();
        this.materialListContent = null;
        this.currentMaterials = [];
        this.selectedMaterialIndex = null;
        this.currentModelId = null;
        this.currentMmdModel = null;
        this.element.remove();
    }
}
