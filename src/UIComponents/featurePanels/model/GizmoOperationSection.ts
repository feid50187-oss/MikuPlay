/**
 * Gizmo 操作区域
 * 提供模型根节点级别的可视化移动/旋转/缩放
 */
import { GizmoManager, Vector3 } from '@babylonjs/core';
import type { Scene, AbstractMesh } from '@babylonjs/core';
import type { MainWindow } from '../../MainWindow';
import { Slider } from '../../shared/Slider';

export class GizmoOperationSection {
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private gizmoManager: GizmoManager | null = null;
    private scene: Scene | null = null;
    private selectedRoot: AbstractMesh | null = null;
    private meshToRoot: Map<AbstractMesh, AbstractMesh> = new Map();
    private rootToModel: Map<AbstractMesh, any> = new Map();
    private baselineTransforms: Map<string, { position: Vector3; scaling: Vector3 }> = new Map();

    private enabled = false;
    private currentMode: 'translate' | 'rotate' | 'scale' = 'translate';
    private panelVisible = false;
    private gizmoScale = 1.0;

    private container: HTMLElement;
    private enableToggle: HTMLInputElement | null = null;
    private modelSelect: HTMLSelectElement | null = null;
    private selectedLabel: HTMLElement | null = null;
    private readoutEl: HTMLElement | null = null;
    private gizmoScaleSlider: Slider | null = null;
    private modeButtons: Record<string, HTMLButtonElement> = {};

    constructor(options: { mainWindow?: MainWindow }) {
        this.mainWindow = options.mainWindow ?? null;
        this.element = document.createElement('div');
        this.container = document.createElement('div');
        this.buildUI();
        this.element.appendChild(this.container);
    }

    private buildUI(): void {
        this.container.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:10px;';

        // 标题
        const title = document.createElement('div');
        title.textContent = 'Gizmo 操作';
        title.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:4px;';
        this.container.appendChild(title);

        // 启用开关
        const enableRow = document.createElement('div');
        enableRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
        const enableLabel = document.createElement('span');
        enableLabel.textContent = '启用 Gizmo';
        enableLabel.style.cssText = 'font-size:13px;';
        this.enableToggle = document.createElement('input');
        this.enableToggle.type = 'checkbox';
        this.enableToggle.addEventListener('change', () => {
            this.enabled = this.enableToggle!.checked;
            if (this.enabled && this.panelVisible) {
                this.initGizmo();
                this.readBaselines();
            } else {
                this.detachSelected();
            }
            this.syncGizmoEnabled();
        });
        enableRow.appendChild(enableLabel);
        enableRow.appendChild(this.enableToggle);
        this.container.appendChild(enableRow);

        // 模型选择
        const selLabel = document.createElement('div');
        selLabel.textContent = '选择模型';
        selLabel.style.cssText = 'font-size:12px;color:#888;';
        this.container.appendChild(selLabel);

        this.modelSelect = document.createElement('select');
        this.modelSelect.className = 'mp-input';
        this.modelSelect.style.cssText = 'width:100%;height:36px;box-sizing:border-box;';
        this.modelSelect.addEventListener('change', () => {
            const id = this.modelSelect!.value;
            if (!id) { this.detachSelected(); return; }
            const model = this.rootToModel.get(Array.from(this.rootToModel.entries())
                .find(([_, m]) => m.id === id)?.[0] as AbstractMesh);
            if (model) {
                const root = Array.from(this.rootToModel.keys())
                    .find(k => this.rootToModel.get(k)?.id === id);
                if (root) this.attachToModel(root);
            }
        });
        this.container.appendChild(this.modelSelect);

        // 当前选中
        const selRow = document.createElement('div');
        selRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;';
        const dot = document.createElement('span');
        dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#3b82f6;';
        this.selectedLabel = document.createElement('span');
        this.selectedLabel.textContent = '未选中';
        selRow.appendChild(dot);
        selRow.appendChild(this.selectedLabel);
        this.container.appendChild(selRow);

        // 模式按钮
        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:flex;gap:8px;';
        [
            { key: 'translate', label: '移动' },
            { key: 'rotate', label: '旋转' },
            { key: 'scale', label: '缩放' }
        ].forEach(mo => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'mp-btn small';
            btn.textContent = mo.label;
            btn.style.flex = '1';
            btn.addEventListener('click', () => this.setMode(mo.key as any));
            this.modeButtons[mo.key] = btn;
            modeRow.appendChild(btn);
        });
        this.container.appendChild(modeRow);

        // 参数读数
        const roLabel = document.createElement('div');
        roLabel.textContent = '当前参数';
        roLabel.style.cssText = 'font-size:12px;color:#888;';
        this.container.appendChild(roLabel);

        this.readoutEl = document.createElement('div');
        this.readoutEl.style.cssText = [
            'font-family:monospace','font-size:11px','line-height:1.6',
            'background:rgba(0,0,0,0.05)','border-radius:8px','padding:8px 10px',
            'white-space:pre','min-height:60px'
        ].join(';');
        this.readoutEl.textContent = '—';
        this.container.appendChild(this.readoutEl);

        // 按钮行
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;';
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'mp-btn small primary';
        resetBtn.textContent = '归位';
        resetBtn.style.flex = '1';
        resetBtn.addEventListener('click', () => this.resetSelected());
        btnRow.appendChild(resetBtn);

        const deselectBtn = document.createElement('button');
        deselectBtn.type = 'button';
        deselectBtn.className = 'mp-btn small';
        deselectBtn.textContent = '取消选中';
        deselectBtn.style.flex = '1';
        deselectBtn.addEventListener('click', () => this.detachSelected());
        btnRow.appendChild(deselectBtn);
        this.container.appendChild(btnRow);

        // 手柄大小
        try {
            this.gizmoScaleSlider = new Slider({
                label: '手柄大小', min: 0.5, max: 2.5, step: 0.1, value: this.gizmoScale
            } as any);
            this.gizmoScaleSlider.onChange((v: number) => {
                this.gizmoScale = v;
                this.applyGizmoScale();
            });
            this.container.appendChild(this.gizmoScaleSlider.element);
        } catch (e) {}

        // 指针拾取
        this.setupPointerPick();
    }

    private initGizmo(): void {
        if (this.gizmoManager) return;
        this.scene = this.mainWindow?.getSceneManager()?.getScene() ?? null;
        if (!this.scene) return;

        this.gizmoManager = new GizmoManager(this.scene);
        this.gizmoManager.usePointerToAttachGizmo = false;
        this.applyGizmoScale();
        this.syncGizmoEnabled();
        this.rebuildModelMaps();
    }

    private setupPointerPick(): void {
        // 监听模型变化
        const modelManager = this.mainWindow?.getModelManager?.();
        if (modelManager) {
            // 模型列表变化时刷新
        }
    }

    private rebuildModelMaps(): void {
        this.meshToRoot.clear();
        this.rootToModel.clear();

        const modelManager = this.mainWindow?.getModelManager?.();
        if (!modelManager || !this.scene) return;

        const models = modelManager.getAllModels?.() ?? [];
        models.forEach((m: any) => {
            if (!m || !m.mesh) return;
            const root = m.mesh;
            this.rootToModel.set(root, m);
            const descs = root.getDescendants(true);
            descs.push(root);
            descs.forEach((node: any) => {
                if (node && node.constructor?.name?.includes('Mesh')) {
                    this.meshToRoot.set(node, root);
                }
            });
        });

        this.refreshModelDropdown();
    }

    private refreshModelDropdown(): void {
        if (!this.modelSelect) return;
        const prev = this.modelSelect.value;
        this.modelSelect.innerHTML = '';

        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = '— 点击模型或从列表选择 —';
        this.modelSelect.appendChild(empty);

        Array.from(this.rootToModel.entries()).forEach(([root, m]) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.name || m.id;
            this.modelSelect!.appendChild(opt);
        });

        if (prev) this.modelSelect.value = prev;
    }

    private attachToModel(root: AbstractMesh): void {
        if (!this.gizmoManager) return;
        this.selectedRoot = root;
        this.gizmoManager.attachToMesh(root);
        const model = this.rootToModel.get(root);
        if (this.selectedLabel) this.selectedLabel.textContent = model?.name || '模型';
        if (this.modelSelect && model) this.modelSelect.value = model.id;
        this.refreshReadout();
    }

    private detachSelected(): void {
        this.selectedRoot = null;
        if (this.gizmoManager) this.gizmoManager.attachToMesh(null);
        if (this.selectedLabel) this.selectedLabel.textContent = '未选中';
        if (this.modelSelect) this.modelSelect.value = '';
        if (this.readoutEl) this.readoutEl.textContent = '—';
    }

    private setMode(mode: 'translate' | 'rotate' | 'scale'): void {
        this.currentMode = mode;
        this.syncGizmoEnabled();
        if (this.selectedRoot && this.gizmoManager) {
            this.gizmoManager.attachToMesh(null);
            this.gizmoManager.attachToMesh(this.selectedRoot);
        }
    }

    private syncGizmoEnabled(): void {
        if (!this.gizmoManager) return;
        const active = this.enabled && this.panelVisible;
        this.gizmoManager.positionGizmoEnabled = active && (this.currentMode === 'translate');
        this.gizmoManager.rotationGizmoEnabled = active && (this.currentMode === 'rotate');
        this.gizmoManager.scaleGizmoEnabled = active && (this.currentMode === 'scale');

        Object.keys(this.modeButtons).forEach(k => {
            const btn = this.modeButtons[k];
            if (btn) btn.className = k === this.currentMode ? 'mp-btn small primary' : 'mp-btn small';
        });
    }

    private applyGizmoScale(): void {
        if (!this.gizmoManager?.gizmos) return;
        const g = this.gizmoManager.gizmos;
        if (g.positionGizmo) g.positionGizmo.scale = this.gizmoScale;
        if (g.rotationGizmo) g.rotationGizmo.scale = this.gizmoScale;
        if (g.scaleGizmo) g.scaleGizmo.scale = this.gizmoScale;
    }

    private readBaselines(): void {
        this.baselineTransforms.clear();
        this.rootToModel.forEach((m, root) => {
            try {
                this.baselineTransforms.set(m.id, {
                    position: root.position.clone(),
                    scaling: root.scaling.clone()
                });
            } catch {}
        });
    }

    private resetSelected(): void {
        if (!this.selectedRoot) return;
        const model = this.rootToModel.get(this.selectedRoot);
        const snap = model && this.baselineTransforms.get(model.id);
        if (!model || !snap) return;
        this.selectedRoot.position.copyFrom(snap.position);
        this.selectedRoot.scaling.copyFrom(snap.scaling);
        this.refreshReadout();
    }

    private refreshReadout(): void {
        if (!this.readoutEl || !this.selectedRoot) {
            if (this.readoutEl) this.readoutEl.textContent = '—';
            return;
        }
        const p = this.selectedRoot.position;
        const s = this.selectedRoot.scaling;
        this.readoutEl.textContent =
            `位 ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}\n` +
            `缩 ${s.x.toFixed(2)} ${s.y.toFixed(2)} ${s.z.toFixed(2)}`;
    }

    onShow(): void {
        this.panelVisible = true;
        if (this.enabled) {
            this.initGizmo();
            this.readBaselines();
        }
        this.syncGizmoEnabled();
    }

    onHide(): void {
        this.panelVisible = false;
        this.detachSelected();
        this.syncGizmoEnabled();
    }

    dispose(): void {
        this.detachSelected();
        if (this.gizmoManager) {
            this.gizmoManager.dispose();
            this.gizmoManager = null;
        }
    }
}
