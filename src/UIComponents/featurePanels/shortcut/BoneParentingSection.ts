import type { MainWindow } from '../../MainWindow';
import { ModelOptStateManager } from '../../../features/state/ModelOptStateManager';
import { ModelStateManager } from '../../../features/mmd/ModelStateManager';
import { BoneManager } from '../../../features/mmd/BoneManager';
import { CollapsibleSection, Dropdown } from '../../shared';

export class BoneParentingSection {
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private section: CollapsibleSection;
    private bindingListEl: HTMLElement;
    private parentModelDropdown: Dropdown;
    private parentBoneDropdown: Dropdown;
    private childModelDropdown: Dropdown;
    private childBoneDropdown: Dropdown;
    private addBtn: HTMLButtonElement;
    private stateChangeCallback?: (state: any) => void;

    constructor(options: { mainWindow: MainWindow | null }) {
        this.mainWindow = options.mainWindow;

        if (!BoneManager.ENABLE_BONE_PARENTING) {
            this.element = document.createElement('div');
            this.element.style.display = 'none';
            this.section = null as any;
            this.bindingListEl = null as any;
            this.parentModelDropdown = null as any;
            this.parentBoneDropdown = null as any;
            this.childModelDropdown = null as any;
            this.childBoneDropdown = null as any;
            this.addBtn = null as any;
            return;
        }

        this.section = new CollapsibleSection({
            title: '亲骨骼绑定',
            initiallyExpanded: false
        });
        // 添加标识类名，用于CSS覆盖
        this.section.element.classList.add('bone-parenting-section');

        const contentContainer = this.section.getContentContainer();

        // 实验性提示
        // const hint = document.createElement('div');
        // hint.className = 'bone-parenting-hint';
        // hint.textContent = '⚠ 实验性功能，行为可能不稳定';
        // contentContainer.appendChild(hint);

        // 绑定列表
        this.bindingListEl = document.createElement('div');
        this.bindingListEl.className = 'bone-parenting-binding-list';
        contentContainer.appendChild(this.bindingListEl);

        // 分割线
        const divider = document.createElement('div');
        divider.className = 'bone-parenting-divider';
        contentContainer.appendChild(divider);

        // 新增绑定区域标签
        const addTitle = document.createElement('div');
        addTitle.className = 'bone-parenting-add-title';
        addTitle.textContent = '新增绑定';
        contentContainer.appendChild(addTitle);

        // 父级模型下拉
        this.parentModelDropdown = new Dropdown({
            options: this.getModelOptions(),
            selectedValue: '',
            label: '父级模型',
            placeholder: '请选择父级模型'
        });
        this.parentModelDropdown.onChange(() => this.updateBoneDropdowns());
        contentContainer.appendChild(this.parentModelDropdown.element);

        // 子级模型下拉
        this.childModelDropdown = new Dropdown({
            options: this.getModelOptions(),
            selectedValue: '',
            label: '子级模型',
            placeholder: '请选择子级模型'
        });
        this.childModelDropdown.onChange(() => this.updateBoneDropdowns());
        contentContainer.appendChild(this.childModelDropdown.element);

        // 父级骨骼下拉
        this.parentBoneDropdown = new Dropdown({
            options: [],
            selectedValue: '',
            label: '父级骨骼',
            placeholder: '请先选择父级模型'
        });
        contentContainer.appendChild(this.parentBoneDropdown.element);

        // 子级骨骼下拉
        this.childBoneDropdown = new Dropdown({
            options: [],
            selectedValue: '',
            label: '子级骨骼',
            placeholder: '请先选择子级模型'
        });
        contentContainer.appendChild(this.childBoneDropdown.element);

        // 添加按钮
        this.addBtn = document.createElement('button');
        this.addBtn.className = 'bone-parenting-add-btn';
        this.addBtn.textContent = '添加绑定';
        this.addBtn.addEventListener('click', () => this.handleAddBinding());
        contentContainer.appendChild(this.addBtn);

        this.element = this.section.element;

        this.renderBindingList();

        // 监听状态变更
        ModelOptStateManager.getInstance().subscribe(() => {
            this.renderBindingList();
        });

        // 监听模型列表变化，动态更新模型下拉框选项
        this.stateChangeCallback = () => {
            this.updateModelDropdownsOptions();
        };
        ModelStateManager.getInstance().onStateChange(this.stateChangeCallback);
    }

    private getAnimationManager() {
        return this.mainWindow?.getAnimationManager() ?? null;
    }

    private getModelManager() {
        return this.mainWindow?.getModelManager() ?? null;
    }

    private getModelOptions(): { label: string; value: string }[] {
        const modelManager = this.getModelManager();
        if (!modelManager) return [];
        return modelManager.getAllModels().map(m => ({
            label: m.name,
            value: m.id
        }));
    }

    private getBoneOptions(modelId: string): { label: string; value: string }[] {
        const animManager = this.getAnimationManager();
        if (!animManager) return [];
        const mmdModel = animManager.getMmdModel(modelId);
        if (!mmdModel) return [];
        return mmdModel.runtimeBones.map(b => ({
            label: b.name,
            value: b.name
        }));
    }

    private updateBoneDropdowns(): void {
        const parentModelId = this.parentModelDropdown.getValue();
        if (parentModelId) {
            this.parentBoneDropdown.configure({
                options: this.getBoneOptions(parentModelId),
                selectedValue: ''
            });
            this.parentBoneDropdown.configure({ placeholder: '请选择父级骨骼' });
        }

        const childModelId = this.childModelDropdown.getValue();
        if (childModelId) {
            this.childBoneDropdown.configure({
                options: this.getBoneOptions(childModelId),
                selectedValue: ''
            });
            this.childBoneDropdown.configure({ placeholder: '请选择子级骨骼' });
        }
    }

    /**
     * 更新模型下拉框的选项列表
     * 当模型加载或移除时调用，确保下拉框显示最新的模型列表
     */
    private updateModelDropdownsOptions(): void {
        const modelOptions = this.getModelOptions();
        this.parentModelDropdown.configure({ options: modelOptions });
        this.childModelDropdown.configure({ options: modelOptions });
    }

    private generateId(): string {
        return `bp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    private handleAddBinding(): void {
        const parentModelId = this.parentModelDropdown.getValue();
        const parentBoneName = this.parentBoneDropdown.getValue();
        const childModelId = this.childModelDropdown.getValue();
        const childBoneName = this.childBoneDropdown.getValue();

        if (!parentModelId || !parentBoneName || !childModelId || !childBoneName) {
            return;
        }

        if (parentModelId === childModelId) {
            return;
        }

        const bindingId = this.generateId();
        ModelOptStateManager.getInstance().addBoneParentingBinding({
            id: bindingId,
            parentModelId,
            parentBoneName,
            childModelId,
            childBoneName,
            enabled: true
        });

        const boneManager = BoneManager.getInstance();
        boneManager.setParentingBaselineZero(bindingId);
        boneManager.ensureParentingUpdate();

        // 重置表单
        this.parentBoneDropdown.configure({ placeholder: '请选择父级骨骼', selectedValue: '' });
        this.childBoneDropdown.configure({ placeholder: '请选择子级骨骼', selectedValue: '' });
    }

    private handleRemoveBinding(id: string): void {
        ModelOptStateManager.getInstance().removeBoneParentingBinding(id);
    }

    private handleToggleBinding(id: string, enabled: boolean): void {
        ModelOptStateManager.getInstance().setBoneParentingBindingEnabled(id, enabled);
    }

    private renderBindingList(): void {
        if (!this.bindingListEl) return;
        this.bindingListEl.innerHTML = '';

        const bindings = ModelOptStateManager.getInstance().getBoneParentingBindings();

        if (bindings.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'bone-parenting-empty';
            empty.textContent = '暂无绑定';
            this.bindingListEl.appendChild(empty);
            return;
        }

        for (const binding of bindings) {
            const item = document.createElement('div');
            item.className = 'bone-parenting-binding-item';

            // 信息文本
            const info = document.createElement('span');
            info.className = 'bone-parenting-binding-info';
            info.textContent = `${binding.childBoneName} >> ${binding.parentBoneName}`;

            // 启用/禁用切换按钮
            const toggleBtn = document.createElement('button');
            toggleBtn.className = `bone-parenting-toggle-btn${binding.enabled ? ' active' : ''}`;
            toggleBtn.textContent = binding.enabled ? '开' : '关';
            toggleBtn.addEventListener('click', () => {
                this.handleToggleBinding(binding.id, !binding.enabled);
            });

            // 删除按钮
            const removeBtn = document.createElement('button');
            removeBtn.className = 'bone-parenting-remove-btn';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', () => {
                this.handleRemoveBinding(binding.id);
            });

            item.appendChild(info);
            item.appendChild(toggleBtn);
            item.appendChild(removeBtn);
            this.bindingListEl.appendChild(item);
        }
    }

    dispose(): void {
        if (this.stateChangeCallback) {
            ModelStateManager.getInstance().offStateChange(this.stateChangeCallback);
        }
        this.section?.dispose();
        this.parentModelDropdown?.dispose();
        this.parentBoneDropdown?.dispose();
        this.childModelDropdown?.dispose();
        this.childBoneDropdown?.dispose();
        this.element.remove();
    }
}
