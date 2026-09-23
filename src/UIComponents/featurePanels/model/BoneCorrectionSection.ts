
import type { MainWindow } from '../../MainWindow';
import { ModelOptStateManager } from '../../../features/state/ModelOptStateManager';
import { BoneManager } from '../../../features/mmd/BoneManager';
import { AnimationCorrectionManager } from '../../../features/mmd/AnimationCorrectionManager';
import { Slider } from '../../shared/Slider';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { eventBus, Events } from '../../../core';
import { theme } from '../../../styles/theme';

export class BoneCorrectionSection {
    readonly element: HTMLElement;
    private mainWindow: MainWindow | null;
    private sliders: Map<string, Slider> = new Map();
    private currentFrameDisplay: HTMLElement | null = null;
    private startFrameInput: HTMLInputElement | null = null;
    private endFrameInput: HTMLInputElement | null = null;
    private maxFrame: number = 0;
    private unsubscribeFrameUpdated: (() => void) | null = null;
    private toastEl: HTMLElement | null = null;
    private selectedBoneDisplay: HTMLElement | null = null;

    // 帧显示缓存（脏检查）
    private lastDisplayedFrame: number = -1;

    constructor(options: { mainWindow: MainWindow | null }) {
        this.mainWindow = options.mainWindow;
        this.element = this.create();
    }

    private create(): HTMLElement {
        const collapsible = new CollapsibleSection({ title: '动作微调(实验性)', initiallyExpanded: false });
        collapsible.element.classList.add('model-opt-section');
        collapsible.element.querySelector('.mp-collapsible-header')!.classList.add('model-opt-section-header');
        collapsible.getContentContainer().style.padding = '0';

        const contentContainer = collapsible.getContentContainer();

        // 信息行（选中骨骼 + 当前帧 + 帧范围）
        const infoRow = this.createInfoRow();
        contentContainer.appendChild(infoRow);

        // 骨架说明提示
        const hintRow = document.createElement('div');
        hintRow.className = 'bone-correction-hint';
        hintRow.textContent = '锥体仅显示骨骼间连接关系，与骨骼的实际位置可能有偏差，末端骨骼显示为圆球';
        contentContainer.appendChild(hintRow);

        // 旋转滑块组
        const slidersContainer = document.createElement('div');
        slidersContainer.className = 'bone-correction-sliders';

        const axes = ['x', 'y', 'z'] as const;
        const axisLabels = { x: 'X轴', y: 'Y轴', z: 'Z轴' };
        const axisColors = { x: theme.colorAxisX, y: theme.colorAxisY, z: theme.colorAxisZ };

        axes.forEach(axis => {
            const sliderRow = document.createElement('div');
            sliderRow.className = 'bone-correction-slider-row';

            const label = document.createElement('span');
            label.className = 'bone-correction-label';
            label.textContent = axisLabels[axis];
            label.style.color = axisColors[axis];

            const slider = new Slider({
                label: '',
                min: -30,
                max: 30,
                value: 0,
                step: 1,
                showValue: true,
                valueFormatter: (v) => `${v.toFixed(0)}°`
            });

            slider.onChange((value) => this.handleSliderChange(axis, value));

            this.sliders.set(axis, slider);

            sliderRow.appendChild(label);
            sliderRow.appendChild(slider.element);
            slidersContainer.appendChild(sliderRow);
        });

        contentContainer.appendChild(slidersContainer);

        // 按钮组
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'bone-correction-buttons';

        // 重置按钮
        const resetButton = document.createElement('button');
        resetButton.className = 'bone-correction-reset-btn';
        resetButton.textContent = '重置';
        resetButton.addEventListener('click', () => this.handleReset());
        buttonGroup.appendChild(resetButton);

        // 永久应用按钮
        const applyButton = document.createElement('button');
        applyButton.className = 'bone-correction-apply-btn';
        applyButton.textContent = '永久应用';
        applyButton.addEventListener('click', () => this.handlePermanentApply());
        buttonGroup.appendChild(applyButton);

        contentContainer.appendChild(buttonGroup);

        // Toast 提示
        this.toastEl = document.createElement('div');
        this.toastEl.className = 'bone-correction-toast';
        this.toastEl.style.display = 'none';
        contentContainer.appendChild(this.toastEl);

        // 监听骨骼选择变化
        const unsubscribeState = ModelOptStateManager.getInstance().subscribe(() => {
            this.updateSelectedBoneDisplay();
            this.updateSliderValues();
        });

        // 监听帧更新事件
        this.setupFrameListener();

        // 将状态监听的取消函数绑定到元素上，便于 dispose 时清理
        (collapsible.element as any)._unsubscribeState = unsubscribeState;

        return collapsible.element;
    }

    private updateSelectedBoneDisplay(): void {
        if (!this.selectedBoneDisplay) return;
        const selected = ModelOptStateManager.getInstance().getSelectedBone();
        if (selected.boneName) {
            this.selectedBoneDisplay.textContent = `${selected.boneName}`;
            this.selectedBoneDisplay.classList.add('has-selection');
        } else {
            this.selectedBoneDisplay.textContent = '请选择骨骼';
            this.selectedBoneDisplay.classList.remove('has-selection');
        }
    }

    private updateSliderValues(): void {
        const selected = ModelOptStateManager.getInstance().getSelectedBone();
        if (!selected.modelId || !selected.boneName) return;

        const axes = ['x', 'y', 'z'] as const;
        axes.forEach(axis => {
            const value = ModelOptStateManager.getInstance()
                .getBoneCorrectionValue(selected.modelId!, selected.boneName!, axis);
            const slider = this.sliders.get(axis);
            if (slider) {
                slider.setValue(value * (180 / Math.PI)); // 弧度转角度
            }
        });
    }

    private handleSliderChange(axis: 'x' | 'y' | 'z', degrees: number): void {
        const selected = ModelOptStateManager.getInstance().getSelectedBone();
        if (!selected.modelId || !selected.boneName) return;

        const radians = degrees * (Math.PI / 180); // 角度转弧度

        // 应用旋转偏移（内部会更新状态并同步所有轴）
        const boneManager = BoneManager.getInstance();
        boneManager.applyBoneRotationOffset(
            selected.modelId, selected.boneName, axis, radians
        );
    }

    private handleReset(): void {
        const selected = ModelOptStateManager.getInstance().getSelectedBone();
        if (!selected.modelId || !selected.boneName) return;

        const boneManager = BoneManager.getInstance();
        boneManager.resetBoneRotationOffset(selected.modelId, selected.boneName);

        // 重置滑块
        this.sliders.forEach(slider => slider.setValue(0));
    }

    private handlePermanentApply(): void {
        const selected = ModelOptStateManager.getInstance().getSelectedBone();
        if (!selected.modelId || !selected.boneName) {
            this.showToast('请先选择骨骼');
            return;
        }

        const animationManager = this.mainWindow?.getAnimationManager();
        const animationInfo = animationManager?.getAnimationByModelId(selected.modelId);

        if (!animationInfo?.mmdAnimation) {
            this.showToast('未找到动画数据');
            return;
        }

        // 获取偏移值（弧度）
        const offsets = ModelOptStateManager.getInstance()
            .getBoneCorrectionOffsets(selected.modelId, selected.boneName);

        const frameRange = this.getFrameRange();

        const correctionManager = AnimationCorrectionManager.getInstance();
        const success = correctionManager.applyRotationOffsetsSync(
            animationInfo.mmdAnimation,
            selected.boneName,
            offsets,
            frameRange
        );

        if (success) {
            const rangeText = frameRange.start === 0 && frameRange.end === this.maxFrame
                ? '全部帧'
                : `帧 ${frameRange.start}-${frameRange.end}`;
            this.showToast(`已永久应用到 ${rangeText}`);
            animationManager?.seekAnimation(0);
        } else {
            this.showToast('应用失败：未找到骨骼轨道');
        }
    }

    private showToast(message: string): void {
        if (!this.toastEl) return;
        this.toastEl.textContent = message;
        this.toastEl.style.display = 'block';
        this.toastEl.classList.add('show');
        setTimeout(() => {
            if (this.toastEl) {
                this.toastEl.classList.remove('show');
                this.toastEl.style.display = 'none';
            }
        }, 2000);
    }

    /**
     * 创建信息行（选中骨骼 + 当前帧 + 帧范围）
     */
    private createInfoRow(): HTMLElement {
        const row = document.createElement('div');
        row.className = 'bone-correction-info-row';

        // 选中骨骼显示
        this.selectedBoneDisplay = document.createElement('span');
        this.selectedBoneDisplay.className = 'bone-correction-info-item bone-correction-selected';
        this.updateSelectedBoneDisplay();

        // 当前帧显示
        const currentFrameSection = document.createElement('span');
        currentFrameSection.className = 'bone-correction-info-item';

        const frameLabel = document.createElement('span');
        frameLabel.className = 'bone-correction-info-label';
        frameLabel.textContent = '当前帧:';

        this.currentFrameDisplay = document.createElement('span');
        this.currentFrameDisplay.className = 'bone-correction-current-frame-value';
        this.currentFrameDisplay.textContent = '0';

        currentFrameSection.appendChild(frameLabel);
        currentFrameSection.appendChild(this.currentFrameDisplay);

        // 帧范围输入
        const frameRangeSection = document.createElement('span');
        frameRangeSection.className = 'bone-correction-info-item';

        const rangeLabel = document.createElement('span');
        rangeLabel.className = 'bone-correction-info-label';
        rangeLabel.textContent = '帧范围:';

        this.startFrameInput = document.createElement('input');
        this.startFrameInput.className = 'bone-correction-frame-input';
        this.startFrameInput.type = 'number';
        this.startFrameInput.value = '0';
        this.startFrameInput.min = '0';
        this.startFrameInput.addEventListener('change', () => this.validateFrameRange());

        const separator = document.createElement('span');
        separator.className = 'bone-correction-frame-separator';
        separator.textContent = '至';

        this.endFrameInput = document.createElement('input');
        this.endFrameInput.className = 'bone-correction-frame-input';
        this.endFrameInput.type = 'number';
        this.endFrameInput.value = '0';
        this.endFrameInput.min = '0';
        this.endFrameInput.addEventListener('change', () => this.validateFrameRange());

        frameRangeSection.appendChild(rangeLabel);
        frameRangeSection.appendChild(this.startFrameInput);
        frameRangeSection.appendChild(separator);
        frameRangeSection.appendChild(this.endFrameInput);

        row.appendChild(this.selectedBoneDisplay);
        row.appendChild(currentFrameSection);
        row.appendChild(frameRangeSection);

        return row;
    }

    /**
     * 设置帧监听器
     */
    private setupFrameListener(): void {
        this.unsubscribeFrameUpdated = eventBus.on(Events.FRAME_UPDATED, (data: { frame: number }) => {
            this.updateCurrentFrameDisplay(data.frame);
        });

        // 获取最大帧数并更新默认值
        this.updateMaxFrame();
    }

    /**
     * 更新最大帧数
     */
    private updateMaxFrame(): void {
        const animationManager = this.mainWindow?.getAnimationManager();
        if (animationManager) {
            this.maxFrame = animationManager.getMaxAnimationFrames();
            if (this.endFrameInput) {
                this.endFrameInput.value = this.maxFrame.toString();
                this.endFrameInput.max = this.maxFrame.toString();
            }
            if (this.startFrameInput) {
                this.startFrameInput.max = this.maxFrame.toString();
            }
        }
    }

    /**
     * 更新当前帧显示
     */
    private updateCurrentFrameDisplay(frame: number): void {
        const flooredFrame = Math.floor(frame);
        // 脏检查：仅在帧值变化时更新DOM
        if (this.currentFrameDisplay && this.lastDisplayedFrame !== flooredFrame) {
            this.lastDisplayedFrame = flooredFrame;
            this.currentFrameDisplay.textContent = flooredFrame.toString();
        }
    }

    /**
     * 验证帧范围有效性
     */
    private validateFrameRange(): void {
        if (!this.startFrameInput || !this.endFrameInput) return;

        let start = parseInt(this.startFrameInput.value) || 0;
        let end = parseInt(this.endFrameInput.value) || this.maxFrame;

        // 确保 start >= 0
        start = Math.max(0, start);

        // 确保 end <= maxFrame
        end = Math.min(this.maxFrame, end);

        // 确保 start <= end
        if (start > end) {
            start = end;
        }

        this.startFrameInput.value = start.toString();
        this.endFrameInput.value = end.toString();
    }

    /**
     * 获取当前帧范围
     */
    private getFrameRange(): { start: number; end: number } {
        const start = this.startFrameInput ? parseInt(this.startFrameInput.value) || 0 : 0;
        const end = this.endFrameInput ? parseInt(this.endFrameInput.value) || this.maxFrame : this.maxFrame;
        return { start, end };
    }

    dispose(): void {
        this.unsubscribeFrameUpdated?.();
        const unsubscribeState = (this.element as any)._unsubscribeState;
        if (typeof unsubscribeState === 'function') {
            unsubscribeState();
        }
        this.sliders.forEach(s => s.dispose());
        this.sliders.clear();
        this.element.remove();
    }
}
