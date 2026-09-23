import type { IPanel } from '../../../core/IPanel';
import type { MainWindow } from '../../MainWindow';
import { injectStyles } from '../../../styles/mainWindow.css';
import { modelOptPanelStyles } from '../../../styles/panels/modelOptPanel.css';
import { ModelOptStateManager, type ModelOptMode, type AxisType } from '../../../features/state/ModelOptStateManager';
import { BoneManager } from '../../../features/mmd/BoneManager';
import { ModelManager } from '../../../features/mmd/ModelManager';
import { BoneOperationSection } from './BoneOperationSection';
import { BoneCorrectionSection } from './BoneCorrectionSection';
import { MorphOperationSection } from './MorphOperationSection';
import { GizmoOperationSection } from './GizmoOperationSection';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

//导出模型操作面板类
export class ModelOptPanel implements IPanel {
    readonly id = 'model';
    readonly tabLabel = '模型';
    readonly tabIcon = TAB_ICON;
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private currentMode: ModelOptMode = 'move';
    private currentAxis: AxisType = 'x';
    private unsubscribers: (() => void)[] = [];
    private mousemoveHandler: ((e: MouseEvent) => void) | null = null;
    private mouseupHandler: (() => void) | null = null;

    private boneSection: BoneOperationSection | null = null;
    private correctionSection: BoneCorrectionSection | null = null;
    private morphSection: MorphOperationSection | null = null;
    private gizmoSection: GizmoOperationSection | null = null;

    constructor(options: { mainWindow?: MainWindow }) {
        this.mainWindow = options.mainWindow ?? null;
        injectStyles(modelOptPanelStyles, 'panel-modelopt');
        this.element = this.buildPanel();
    }

    private buildPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'model-opt-panel';

        const contentContainer = document.createElement('div');
        contentContainer.className = 'model-opt-panel-content';

        this.boneSection = new BoneOperationSection({ mainWindow: this.mainWindow });
        this.correctionSection = new BoneCorrectionSection({ mainWindow: this.mainWindow });
        this.morphSection = new MorphOperationSection({ mainWindow: this.mainWindow });
        this.gizmoSection = new GizmoOperationSection({ mainWindow: this.mainWindow });

        contentContainer.appendChild(this.gizmoSection.element);
        contentContainer.appendChild(this.boneSection.element);
        contentContainer.appendChild(this.createSkeletonToggle());
        contentContainer.appendChild(this.createPostPhysicsAppendToggle());
        contentContainer.appendChild(this.correctionSection.element);
        contentContainer.appendChild(this.morphSection.element);

        panel.appendChild(contentContainer);

        const bottomBar = this.createBottomBar();
        panel.appendChild(bottomBar);

        return panel;
    }

    // 创建骨架显示切换开关
    private createSkeletonToggle(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'model-opt-skeleton-toggle';

        const label = document.createElement('span');
        label.className = 'model-opt-skeleton-toggle-label';
        label.textContent = '显示骨架';

        const switchTrack = document.createElement('div');
        switchTrack.className = 'model-opt-skeleton-toggle-track';

        const switchThumb = document.createElement('div');
        switchThumb.className = 'model-opt-skeleton-toggle-thumb';

        switchTrack.appendChild(switchThumb);
        container.appendChild(label);
        container.appendChild(switchTrack);

        // 将骨架显示状态与 BoneManager 同步
        const boneManager = BoneManager.getInstance();
        const scene = this.mainWindow?.getSceneManager()?.getScene();
        if (scene) {
            boneManager.setScene(scene);
        }

        const updateToggle = (active: boolean) => {
            if (active) {
                switchTrack.classList.add('active');
            } else {
                switchTrack.classList.remove('active');
            }
        };

        updateToggle(boneManager.isSkeletonVisible());

        container.addEventListener('click', () => {
            const newState = !boneManager.isSkeletonVisible();
            boneManager.setSkeletonVisible(newState);
            updateToggle(newState);
        });

        return container;
    }

    // 创建物理后付与开关
    private createPostPhysicsAppendToggle(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'model-opt-skeleton-toggle';

        const label = document.createElement('span');
        label.className = 'model-opt-skeleton-toggle-label';
        label.textContent = '物理后付与';

        const switchTrack = document.createElement('div');
        switchTrack.className = 'model-opt-skeleton-toggle-track';

        const switchThumb = document.createElement('div');
        switchThumb.className = 'model-opt-skeleton-toggle-thumb';

        switchTrack.appendChild(switchThumb);
        container.appendChild(label);
        container.appendChild(switchTrack);

        // 获取 ModelManager 实例
        const modelManager = this.mainWindow?.getModelManager();
        
        // 获取当前状态（如果没有模型，默认为 false）
        const getCurrentState = (): boolean => {
            if (!modelManager) return false;
            const state = modelManager.getPostPhysicsAppendTransformEnabled();
            return state !== undefined ? state : false;
        };

        const updateToggle = (active: boolean) => {
            if (active) {
                switchTrack.classList.add('active');
            } else {
                switchTrack.classList.remove('active');
            }
        };

        updateToggle(getCurrentState());

        container.addEventListener('click', () => {
            if (!modelManager) return;
            const newState = !getCurrentState();
            modelManager.setPostPhysicsAppendTransformEnabled(newState);
            updateToggle(newState);
        });

        return container;
    }

    // 创建底部工具栏，包括模式切换、轴选择和数值调整
    private createBottomBar(): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'model-opt-bottom-bar';

        const { axisSelector, updateAxisUIForMode } = this.createAxisSelector();
        const { modeToggle, setMode } = this.createModeToggle(updateAxisUIForMode);
        const valueController = this.createValueController();

        bar.appendChild(modeToggle);
        bar.appendChild(axisSelector);
        bar.appendChild(valueController);

        return bar;
    }

    // 创建模式切换按钮
    private createModeToggle(updateAxisUI: (mode: ModelOptMode) => void): { modeToggle: HTMLElement; setMode: (mode: ModelOptMode) => void } {
        const container = document.createElement('div');
        container.className = 'model-opt-mode-toggle';

        const moveBtn = document.createElement('div');
        moveBtn.className = 'model-opt-mode-btn active';
        moveBtn.textContent = '移';

        const rotateBtn = document.createElement('div');
        rotateBtn.className = 'model-opt-mode-btn';
        rotateBtn.textContent = '转';

        const scaleBtn = document.createElement('div');
        scaleBtn.className = 'model-opt-mode-btn';
        scaleBtn.textContent = '缩';

        const allButtons = [moveBtn, rotateBtn, scaleBtn];

        const updateMode = (mode: ModelOptMode) => {
            this.currentMode = mode;
            ModelOptStateManager.getInstance().setMode(mode);
            updateAxisUI(mode);
        };

        moveBtn.addEventListener('click', () => {
            allButtons.forEach(b => b.classList.remove('active'));
            moveBtn.classList.add('active');
            updateMode('move');
        });

        rotateBtn.addEventListener('click', () => {
            allButtons.forEach(b => b.classList.remove('active'));
            rotateBtn.classList.add('active');
            updateMode('rotate');
        });

        scaleBtn.addEventListener('click', () => {
            allButtons.forEach(b => b.classList.remove('active'));
            scaleBtn.classList.add('active');
            updateMode('scale');
            ModelOptStateManager.getInstance().setScaleAxes(['x', 'y', 'z']);
        });

        container.appendChild(moveBtn);
        container.appendChild(rotateBtn);
        container.appendChild(scaleBtn);

        return {
            modeToggle: container,
            setMode: (mode: ModelOptMode) => {
                this.currentMode = mode;
                allButtons.forEach(b => b.classList.remove('active'));
                if (mode === 'move') moveBtn.classList.add('active');
                else if (mode === 'rotate') rotateBtn.classList.add('active');
                else scaleBtn.classList.add('active');
            }
        };
    }

    // 创建轴选择按钮
    private createAxisSelector(): { axisSelector: HTMLElement; updateAxisUIForMode: (mode: ModelOptMode) => void } {
        const container = document.createElement('div');
        container.className = 'model-opt-axis-selector';

        const axes: { label: string; class: AxisType }[] = [
            { label: 'X', class: 'x' },
            { label: 'Y', class: 'y' },
            { label: 'Z', class: 'z' }
        ];

        const axisButtons: Map<AxisType, HTMLElement> = new Map();

        const updateAxis = (axis: AxisType) => {
            this.currentAxis = axis;
            ModelOptStateManager.getInstance().setAxis(axis);
        };

        // 更新轴按钮的激活状态，保证互斥
        const updateButtonStates = () => {
            const mode = this.currentMode;
            axisButtons.forEach((btn, axis) => {
                if (mode === 'scale') {
                    const isActive = ModelOptStateManager.getInstance().isScaleAxisActive(axis);
                    if (isActive) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                } else {
                    if (axis === this.currentAxis) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                }
            });
        };

        axes.forEach((axis, index) => {
            const btn = document.createElement('div');
            btn.className = `model-opt-axis-btn ${axis.class}${index === 0 ? ' active' : ''}`;
            btn.textContent = axis.label;
            axisButtons.set(axis.class, btn);

            btn.addEventListener('click', () => {
                const mode = this.currentMode;
                if (mode === 'scale') {
                    ModelOptStateManager.getInstance().toggleScaleAxis(axis.class);
                    updateButtonStates();
                } else {
                    container.querySelectorAll('.model-opt-axis-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    updateAxis(axis.class);
                }
            });

            container.appendChild(btn);
        });

        return {
            axisSelector: container,
            updateAxisUIForMode: (mode: ModelOptMode) => {
                updateButtonStates();
            }
        };
    }

    private createValueController(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'model-opt-value-controller';

        const leftArrow = document.createElement('div');
        leftArrow.className = 'model-opt-value-arrow left';
        leftArrow.innerHTML = this.createArrowSVG();

        const input = document.createElement('input');
        input.className = 'model-opt-value-input';
        input.type = 'text';
        input.value = '0.00';
        input.readOnly = true;

        const rightArrow = document.createElement('div');
        rightArrow.className = 'model-opt-value-arrow right';
        rightArrow.innerHTML = this.createArrowSVG();

        const getCurrentValue = (): number => {
            const mode = this.currentMode;
            if (mode === 'scale') {
                const activeAxes = ModelOptStateManager.getInstance().getActiveScaleAxes();
                const axes = Array.from(activeAxes);
                if (axes.length === 0) return 1;
                const stateValue = ModelOptStateManager.getInstance().getModelOptValue(mode, axes[0]);
                // 当状态值为默认(1.0)时，通过父级链获取有效缩放值
                if (stateValue === 1) {
                    const selected = ModelOptStateManager.getInstance().getSelectedBone();
                    if (selected.modelId && selected.boneName) {
                        const effectiveScale = BoneManager.getInstance().getBoneEffectiveScale(selected.modelId, selected.boneName);
                        return effectiveScale[axes[0]];
                    }
                }
                return stateValue;
            }
            return ModelOptStateManager.getInstance().getModelOptValue(mode, this.currentAxis);
        };

        let currentValue = getCurrentValue();
        input.value = currentValue.toFixed(2);

        const updateValue = (newValue: number) => {
            currentValue = parseFloat(newValue.toFixed(2));
            input.value = currentValue.toFixed(2);

            const mode = this.currentMode;
            const selected = ModelOptStateManager.getInstance().getSelectedBone();

            if (selected.modelId && selected.boneName) {
                const boneManager = BoneManager.getInstance();

                if (mode === 'scale') {
                    const activeAxes = ModelOptStateManager.getInstance().getActiveScaleAxes();
                    activeAxes.forEach(axis => {
                        ModelOptStateManager.getInstance().setModelOptValue(mode, axis, currentValue);
                    });
                    boneManager.applyBoneScaleSync(selected.modelId, selected.boneName, activeAxes, currentValue);
                } else {
                    ModelOptStateManager.getInstance().setModelOptValue(mode, this.currentAxis, currentValue);
                    if (mode === 'move') {
                        boneManager.applyBoneTranslation(selected.modelId, selected.boneName, this.currentAxis, currentValue);
                    } else if (mode === 'rotate') {
                        boneManager.applyBoneRotation(selected.modelId, selected.boneName, this.currentAxis, currentValue);
                    }
                }
            }
        };

        const adjustValueByClick = (amount: number) => {
            updateValue(currentValue + amount);
        };

        const addArrowTouchSupport = (arrow: HTMLElement, amount: number | (() => number)) => {
            let touchStarted = false;
            let touchHandled = false;

            arrow.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                touchStarted = true;
                touchHandled = false;
            });

            arrow.addEventListener('touchend', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (touchStarted) {
                    const value = typeof amount === 'function' ? amount() : amount;
                    adjustValueByClick(value);
                    touchHandled = true;
                }
                touchStarted = false;
            });

            arrow.addEventListener('touchcancel', (e) => {
                e.stopPropagation();
                touchStarted = false;
            });

            arrow.addEventListener('click', (e) => {
                if (touchHandled) {
                    e.preventDefault();
                    touchHandled = false;
                    return;
                }
                const value = typeof amount === 'function' ? amount() : amount;
                adjustValueByClick(value);
            });
        };

        //移动模式增量0.1，旋转模式增量0.01
        const getSensitivity = () => this.currentMode === 'move' ? 0.1 : 0.01;
        addArrowTouchSupport(leftArrow, () => -getSensitivity());
        addArrowTouchSupport(rightArrow, () => getSensitivity());

        let startX = 0;
        let currentX = 0;
        let isDragging = false;

        const handleStart = (clientX: number) => {
            startX = clientX;
            currentX = clientX;
            isDragging = true;
            container.style.cursor = 'grabbing';
        };

        const handleMove = (clientX: number) => {
            if (!isDragging) return;

            const deltaX = clientX - currentX;
            currentX = clientX;

            if (Math.abs(deltaX) >= 0.01) {
                const sensitivity = this.currentMode === 'move' ? 0.1 : 0.01;
                const amount = deltaX > 0 ? sensitivity : -sensitivity;
                updateValue(currentValue + amount);
            }
        };

        const handleEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            container.style.cursor = '';
        };

        container.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handleStart(e.clientX);
        });

        this.mousemoveHandler = (e) => {
            handleMove(e.clientX);
        };
        document.addEventListener('mousemove', this.mousemoveHandler);

        this.mouseupHandler = () => {
            handleEnd();
        };
        document.addEventListener('mouseup', this.mouseupHandler);

        container.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length === 1) {
                handleStart(e.touches[0].clientX);
            }
        });

        container.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length === 1 && isDragging) {
                handleMove(e.touches[0].clientX);
            }
        });

        container.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleEnd();
        });

        container.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            handleEnd();
        });

        const unsubscribe = ModelOptStateManager.getInstance().subscribe(() => {
            const savedValue = getCurrentValue();
            currentValue = savedValue;
            input.value = currentValue.toFixed(2);
        });
        this.unsubscribers.push(unsubscribe);

        container.appendChild(leftArrow);
        container.appendChild(input);
        container.appendChild(rightArrow);

        return container;
    }

    private createArrowSVG(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
        `;
    }

    onShown(): void {
    }

    onHidden(): void {
    }

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        this.element.remove();
    }

    dispose(): void {
        this.boneSection?.dispose();
        this.correctionSection?.dispose();
        this.morphSection?.dispose();
        this.boneSection = null;
        this.correctionSection = null;
        this.morphSection = null;

        if (this.mousemoveHandler) {
            document.removeEventListener('mousemove', this.mousemoveHandler);
            this.mousemoveHandler = null;
        }
        if (this.mouseupHandler) {
            document.removeEventListener('mouseup', this.mouseupHandler);
            this.mouseupHandler = null;
        }

        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.element.remove();
    }
}
