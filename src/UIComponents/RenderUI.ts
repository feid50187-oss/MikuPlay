
import { injectStyles } from '../styles/mainWindow.css';
import { renderUIStyles } from '../styles/components/renderUI.css';
import { Capacitor } from '@capacitor/core';
import { Slider } from './shared/Slider';
import { ToggleSwitch } from './shared/ToggleSwitch';
import { theme } from '../styles/theme';
import { eventBus, Events } from '../core';
import { Fullscreen } from '../utils/platform';

export interface RenderSettings {
    renderMode: 'realtime' | 'offline' | 'frame';
    resolution: {
        preset?: 'original' | '720p' | '1080p';
        width?: number;
        height?: number;
    };
    frameRate: number;
    bitrate: number;
    /** 实时渲染帧率上限（fps）。null = 无限制（默认）；非 null 时用固定步长慢放推进动画 */
    renderFps?: number | null;
    /** 渲染帧范围（MMD 帧基准 30fps，起止均含），仅离线渲染模式生效 */
    frameRange?: { start: number; end: number };
    autoCompose?: boolean;
    workerCount?: number;
    forceColorFix?: boolean;
    transparentOutput?: boolean;
}

export class RenderUI {
    private overlay: HTMLElement;
    private panel: HTMLElement;
    private isOpen: boolean = false;
    private isFullscreen: boolean = false;

    private onStartRenderCallback: ((settings: RenderSettings) => void) | null = null;

    private renderModeDropdown: HTMLElement | null = null;
    private frameRangeSection: HTMLElement | null = null;
    private startFrameInput: HTMLInputElement | null = null;
    private endFrameInput: HTMLInputElement | null = null;
    private maxAnimationFrames: number = 0;
    private resolutionContainer: HTMLElement | null = null;
    private resolutionInputs: HTMLElement | null = null;
    private resolutionHint: HTMLElement | null = null;
    private widthInput: HTMLInputElement | null = null;
    private heightInput: HTMLInputElement | null = null;
    private frameRateSlider: Slider | null = null;
    private bitrateSlider: Slider | null = null;
    private renderFpsSlider: Slider | null = null;
    private autoComposeToggle: HTMLInputElement | null = null;
    private autoComposeSection: HTMLElement | null = null;
    private colorFixSection: HTMLElement | null = null;
    private colorFixToggle: ToggleSwitch | null = null;
    private transparentOutputSection: HTMLElement | null = null;
    private transparentOutputToggle: ToggleSwitch | null = null;
    private resolutionSection: HTMLElement | null = null;
    private frameRateSection: HTMLElement | null = null;
    private bitrateSection: HTMLElement | null = null;
    private renderFpsSection: HTMLElement | null = null;
    private frameRateHint: HTMLElement | null = null;
    private workerCountSlider: Slider | null = null;
    private advancedSettingsSection: HTMLElement | null = null;
    private sliders: Slider[] = [];

    // 存储全局事件监听器引用，用于 dispose 时清理
    private dropdownClickListeners: Array<() => void> = [];
    private fullscreenChangeListeners: Array<() => void> = [];

    private currentRenderMode: 'realtime' | 'offline' | 'frame' = 'offline';
    private currentAutoCompose: boolean = true;
    private currentFrameRate: number = 30;
    private currentBitrate: number = 12;
    /** 实时渲染帧率上限：null = 无限制（默认），数值 = 目标 fps */
    private currentRenderFps: number | null = null;
    private currentWorkerCount: number = 1;

    constructor() {
        injectStyles(renderUIStyles, 'view-renderui');

        this.overlay = this.createOverlay();
        this.panel = this.createPanel();

        document.body.appendChild(this.overlay);
        document.body.appendChild(this.panel);

        // 监听全屏状态变化，同步 isFullscreen 状态
        this.setupFullscreenListeners();
    }

    public onStartRender(callback: (settings: RenderSettings) => void): void {
        this.onStartRenderCallback = callback;
    }

    public async open(): Promise<void> {
        if (!this.isOpen) {
            this.isOpen = true;
            // 先进入全屏
            await this.enterFullscreen();
            // 等待一小段时间确保全屏完成
            await new Promise(resolve => setTimeout(resolve, 50));
            // 显示元素
            this.overlay.style.display = 'block';
            this.panel.style.display = 'block';
            // 再显示 UI，确保在全屏层级之上
            this.overlay.classList.add('visible');
            this.panel.classList.add('open');
            // 提高 panel 的 z-index 确保在最上层
            this.panel.style.zIndex = '65535';
        }
    }

    public async close(): Promise<void> {
        if (this.isOpen) {
            this.isOpen = false;
            this.overlay.classList.remove('visible');
            this.panel.classList.remove('open');
            // 隐藏元素，确保不拦截点击事件
            this.overlay.style.display = 'none';
            this.panel.style.display = 'none';
            // 关闭时自动退出全屏
            await this.exitFullscreen();
        }
    }

    public async toggle(): Promise<void> {
        if (this.isOpen) {
            await this.close();
        } else {
            await this.open();
        }
    }

    public isOpened(): boolean {
        return this.isOpen;
    }

    /**
     * 设置全屏状态监听
     * 用于同步 isFullscreen 状态，处理用户手动退出全屏的情况
     */
    private setupFullscreenListeners(): void {
        const fullscreenEvents = [
            'fullscreenchange',
            'webkitfullscreenchange',
            'mozfullscreenchange',
            'MSFullscreenChange'
        ];

        fullscreenEvents.forEach(eventName => {
            const handler = () => {
                const isFullscreenNow = this.checkFullscreenState();
                if (this.isFullscreen !== isFullscreenNow) {
                    this.isFullscreen = isFullscreenNow;
                    console.log('[RenderUI] 全屏状态已更改:', isFullscreenNow);
                    // 同步通知 MainWindow 的全屏状态处理器
                    eventBus.emit(Events.FULLSCREEN_CHANGED, { isFullscreen: isFullscreenNow });
                }
            };
            document.addEventListener(eventName, handler);
            this.fullscreenChangeListeners.push(() => {
                document.removeEventListener(eventName, handler);
            });
        });
    }

    /**
     * 检查当前全屏状态
     */
    private checkFullscreenState(): boolean {
        return !!(
            document.fullscreenElement ||
            (document as any).webkitFullscreenElement ||
            (document as any).mozFullScreenElement ||
            (document as any).msFullscreenElement
        );
    }

    private createOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        overlay.className = 'render-ui-overlay';
        overlay.addEventListener('click', () => {
            this.close().catch(error => {
                console.error('[RenderUI] 关闭失败:', error);
            });
        });
        return overlay;
    }

    private createPanel(): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'render-ui-panel';

        const header = this.createHeader();
        panel.appendChild(header);

        const content = this.createContent();
        panel.appendChild(content);

        const footer = this.createFooter();
        panel.appendChild(footer);

        return panel;
    }

    private createHeader(): HTMLElement {
        const header = document.createElement('div');
        header.className = 'render-ui-header';

        const title = document.createElement('span');
        title.className = 'render-ui-title';
        title.textContent = '渲染设置';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'render-ui-close-btn';
        closeBtn.innerHTML = this.getCloseIcon();
        closeBtn.addEventListener('click', () => {
            this.close().catch(error => {
                console.error('[RenderUI] Close failed:', error);
            });
        });

        header.appendChild(title);
        header.appendChild(closeBtn);

        return header;
    }

    private createContent(): HTMLElement {
        const content = document.createElement('div');
        content.className = 'render-ui-content';

        const renderModeSection = this.createRenderModeSection();
        content.appendChild(renderModeSection);

        const frameRangeSection = this.createFrameRangeSection();
        this.frameRangeSection = frameRangeSection;
        content.appendChild(frameRangeSection);

        const resolutionSection = this.createResolutionSection();
        this.resolutionSection = resolutionSection;
        content.appendChild(resolutionSection);

        const frameRateSection = this.createFrameRateSection();
        this.frameRateSection = frameRateSection;
        content.appendChild(frameRateSection);

        const bitrateSection = this.createBitrateSection();
        this.bitrateSection = bitrateSection;
        content.appendChild(bitrateSection);

        const renderFpsSection = this.createRenderFpsSection();
        this.renderFpsSection = renderFpsSection;
        content.appendChild(renderFpsSection);

        const colorFixSection = this.createColorFixSection();
        this.colorFixSection = colorFixSection;
        content.appendChild(colorFixSection);

        const transparentOutputSection = this.createTransparentOutputSection();
        this.transparentOutputSection = transparentOutputSection;
        content.appendChild(transparentOutputSection);

        //const advancedSettingsSection = this.createAdvancedSettingsSection();
        //this.advancedSettingsSection = advancedSettingsSection;
        //content.appendChild(advancedSettingsSection);

        const notesSection = this.createNotesSection();
        content.appendChild(notesSection);

        // Apply initial visibility based on current render mode
        this.updateRealtimeControls();

        return content;
    }

    private createNotesSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section render-ui-notes-section';

        const notesContainer = document.createElement('div');
        notesContainer.className = 'render-ui-notes-container';
        notesContainer.style.cssText = `
            background-color: ${theme.warningBg};
            border-left: 3px solid ${theme.warningColor};
            padding: 12px 16px;
            border-radius: 4px;
            margin-top: 8px;
        `;

        const note1 = document.createElement('p');
        note1.className = 'render-ui-note';
        note1.style.cssText = `
            margin: 0;
            font-size: 13px;
            color: var(--color-text-primary);
            line-height: 1.5;
        `;
        note1.textContent = '1.离线渲染不受屏幕尺寸和性能限制，可以输出任意分辨率、绝对不掉帧的视频';

        const note2 = document.createElement('p');
        note2.className = 'render-ui-note';
        note2.style.cssText = `
            margin: 0;
            font-size: 13px;
            color: var(--color-text-primary);
            line-height: 1.5;
        `;
        note2.textContent = '2.实时渲染帧率应该小于等于预览时的最低帧率';

        notesContainer.appendChild(note1);
        notesContainer.appendChild(note2);
        

        section.appendChild(notesContainer);

        return section;
    }

    private createRenderModeSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section';

        const label = document.createElement('label');
        label.className = 'render-ui-label';
        label.textContent = '渲染方式';

        const options = [
            { value: 'realtime', label: '实时渲染' },
            { value: 'offline', label: '离线渲染' },
            { value: 'frame', label: '帧输出' }
        ];

        const dropdown = this.createDropdown(
            options,
            'offline',
            (value) => {
                this.currentRenderMode = value as 'realtime' | 'offline' | 'frame';
                this.updateResolutionControls();
                this.updateRealtimeControls();
            }
        );
        this.renderModeDropdown = dropdown;

        section.appendChild(label);
        section.appendChild(dropdown);

        return section;
    }

    /**
     * 设置动画最大帧数并刷新帧范围输入框（每次打开面板前由 RenderManager 调用）
     * 默认自动填入 0 和末尾帧；用户已修改过的值在合法范围内保留
     */
    public setMaxFrames(max: number): void {
        const prevMax = this.maxAnimationFrames;
        this.maxAnimationFrames = Math.max(0, Math.floor(max));
        if (!this.startFrameInput || !this.endFrameInput) return;

        let start = parseInt(this.startFrameInput.value);
        if (Number.isNaN(start)) start = 0;

        let end = parseInt(this.endFrameInput.value);
        // 结束帧为空、或跟随上一版最大值、或超出新范围时，自动填入新的末尾帧
        if (Number.isNaN(end) || (prevMax > 0 && end >= prevMax) || end > this.maxAnimationFrames) {
            end = this.maxAnimationFrames;
        }

        start = Math.min(Math.max(start, 0), this.maxAnimationFrames);
        end = Math.min(Math.max(end, start), this.maxAnimationFrames);

        this.startFrameInput.value = start.toString();
        this.endFrameInput.value = end.toString();
    }

    /**
     * 失焦时归一化帧范围输入（clamp 到 [0, 最大帧] 并保证 start <= end）
     * @param editedEnd 本次编辑的是否为结束帧（冲突时以被编辑的一侧为准）
     */
    private normalizeFrameRange(editedEnd: boolean): void {
        if (!this.startFrameInput || !this.endFrameInput) return;

        let start = parseInt(this.startFrameInput.value);
        if (Number.isNaN(start)) start = 0;
        let end = parseInt(this.endFrameInput.value);
        if (Number.isNaN(end)) end = this.maxAnimationFrames;

        start = Math.min(Math.max(start, 0), this.maxAnimationFrames);
        end = Math.min(Math.max(end, 0), this.maxAnimationFrames);
        if (start > end) {
            if (editedEnd) {
                start = end;
            } else {
                end = start;
            }
        }

        this.startFrameInput.value = start.toString();
        this.endFrameInput.value = end.toString();
    }

    /**
     * 获取帧范围设置（离线渲染模式使用）
     */
    private getFrameRange(): { start: number; end: number } {
        let start = parseInt(this.startFrameInput?.value ?? '0');
        let end = parseInt(this.endFrameInput?.value ?? '');
        if (Number.isNaN(start)) start = 0;
        // maxAnimationFrames 为 0 时（setMaxFrames 未被调用或无动画），
        // 信任用户输入值，不做 clamp，交给 OfflineRenderManager 做合法性校验
        const max = this.maxAnimationFrames;
        if (max > 0) {
            if (Number.isNaN(end)) end = max;
            start = Math.min(Math.max(start, 0), max);
            end = Math.min(Math.max(end, 0), max);
            if (start > end) end = start;
        } else {
            if (Number.isNaN(end)) end = 0;
            if (start > end) end = start;
        }
        return { start, end };
    }

    private createFrameRangeSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section';

        const label = document.createElement('label');
        label.className = 'render-ui-label';
        label.textContent = '帧范围';

        const inputsRow = document.createElement('div');
        inputsRow.className = 'render-ui-inputs-row';

        const startGroup = document.createElement('div');
        startGroup.className = 'render-ui-input-group';

        const startLabel = document.createElement('span');
        startLabel.className = 'render-ui-input-label';
        startLabel.textContent = '起始帧';

        this.startFrameInput = document.createElement('input');
        this.startFrameInput.className = 'render-ui-input';
        this.startFrameInput.type = 'number';
        this.startFrameInput.value = '0';
        this.startFrameInput.min = '0';
        this.startFrameInput.step = '1';
        this.startFrameInput.addEventListener('blur', () => this.normalizeFrameRange(false));

        startGroup.appendChild(startLabel);
        startGroup.appendChild(this.startFrameInput);

        const separator = document.createElement('span');
        separator.className = 'render-ui-frame-range-separator';
        separator.textContent = '—';

        const endGroup = document.createElement('div');
        endGroup.className = 'render-ui-input-group';

        const endLabel = document.createElement('span');
        endLabel.className = 'render-ui-input-label';
        endLabel.textContent = '结束帧';

        this.endFrameInput = document.createElement('input');
        this.endFrameInput.className = 'render-ui-input';
        this.endFrameInput.type = 'number';
        this.endFrameInput.value = ''; // 留空：首次 setMaxFrames 时自动填入末尾帧
        this.endFrameInput.min = '0';
        this.endFrameInput.step = '1';
        this.endFrameInput.addEventListener('blur', () => this.normalizeFrameRange(true));

        endGroup.appendChild(endLabel);
        endGroup.appendChild(this.endFrameInput);

        inputsRow.appendChild(startGroup);
        inputsRow.appendChild(separator);
        inputsRow.appendChild(endGroup);

        const hint = document.createElement('div');
        hint.className = 'render-ui-resolution-hint';
        hint.textContent = '以 MMD 动画帧为单位（30fps），默认渲染全部帧';

        section.appendChild(label);
        section.appendChild(inputsRow);
        section.appendChild(hint);

        return section;
    }

    private updateRealtimeControls(): void {
        if (this.currentRenderMode === 'realtime') {
            if (this.frameRangeSection) {
                this.frameRangeSection.style.display = 'none';
            }
            if (this.resolutionSection) {
                this.resolutionSection.style.display = 'none';
            }
            if (this.frameRateSection) {
                this.frameRateSection.style.display = 'none';
            }
            if (this.bitrateSection) {
                this.bitrateSection.style.display = 'block';
            }
            if (this.renderFpsSection) {
                this.renderFpsSection.style.display = 'block';
            }
            if (this.autoComposeSection) {
                this.autoComposeSection.style.display = 'none';
            }
            if (this.colorFixSection) {
                this.colorFixSection.style.display = 'none';
            }
            if (this.transparentOutputSection) {
                this.transparentOutputSection.style.display = 'none';
            }
            if (this.advancedSettingsSection) {
                this.advancedSettingsSection.style.display = 'none';
            }
        } else if (this.currentRenderMode === 'frame') {
            // 帧输出模式：显示分辨率和透明背景，隐藏帧率/码率/偏色修复/帧范围
            if (this.frameRangeSection) {
                this.frameRangeSection.style.display = 'none';
            }
            if (this.resolutionSection) {
                this.resolutionSection.style.display = 'block';
            }
            if (this.frameRateSection) {
                this.frameRateSection.style.display = 'none';
            }
            if (this.bitrateSection) {
                this.bitrateSection.style.display = 'none';
            }
            if (this.renderFpsSection) {
                this.renderFpsSection.style.display = 'none';
            }
            if (this.autoComposeSection) {
                this.autoComposeSection.style.display = 'none';
            }
            if (this.colorFixSection) {
                this.colorFixSection.style.display = 'none';
            }
            if (this.transparentOutputSection) {
                this.transparentOutputSection.style.display = 'block';
            }
            if (this.frameRateHint) {
                this.frameRateHint.style.display = 'none';
            }
            if (this.frameRateSlider) {
                this.frameRateSlider.configure({ max: 120 });
            }
        } else {
            // 离线渲染模式
            if (this.frameRangeSection) {
                this.frameRangeSection.style.display = 'block';
            }
            if (this.resolutionSection) {
                this.resolutionSection.style.display = 'block';
            }
            if (this.frameRateSection) {
                this.frameRateSection.style.display = 'block';
            }
            if (this.bitrateSection) {
                this.bitrateSection.style.display = 'block';
            }
            if (this.renderFpsSection) {
                this.renderFpsSection.style.display = 'none';
            }
            if (this.autoComposeSection) {
                this.autoComposeSection.style.display = 'none';
            }
            if (this.colorFixSection) {
                this.colorFixSection.style.display = 'block';
            }
            if (this.transparentOutputSection) {
                this.transparentOutputSection.style.display = 'block';
            }
            if (this.frameRateHint) {
                this.frameRateHint.style.display = 'none';
            }
            if (this.frameRateSlider) {
                this.frameRateSlider.configure({ max: 120 });
            }
        }
    }

    private createResolutionSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section';

        const label = document.createElement('label');
        label.className = 'render-ui-label';
        label.textContent = '分辨率';

        this.resolutionContainer = document.createElement('div');
        this.resolutionContainer.className = 'render-ui-resolution-container';

        const inputsRow = this.createResolutionInputs();
        this.resolutionInputs = inputsRow;

        this.resolutionContainer.appendChild(inputsRow);

        const presetButtonsRow = this.createPresetButtonsRow();
        this.resolutionContainer.appendChild(presetButtonsRow);

        this.resolutionHint = document.createElement('div');
        this.resolutionHint.className = 'render-ui-resolution-hint';
        this.resolutionHint.textContent = '分辨率必须为偶数 推荐16的整倍数倍';
        this.resolutionHint.style.display = 'none';
        this.resolutionContainer.appendChild(this.resolutionHint);

        section.appendChild(label);
        section.appendChild(this.resolutionContainer);

        return section;
    }

    private createResolutionInputs(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'render-ui-inputs-row';

        const widthGroup = document.createElement('div');
        widthGroup.className = 'render-ui-input-group';

        const widthLabel = document.createElement('span');
        widthLabel.className = 'render-ui-input-label';
        widthLabel.textContent = '宽度 (px)';

        this.widthInput = document.createElement('input');
        this.widthInput.className = 'render-ui-input';
        this.widthInput.type = 'number';
        this.widthInput.value = '1080';
        this.widthInput.min = '1';
        this.widthInput.step = '2';
        this.widthInput.addEventListener('blur', () => {
            if (this.widthInput) {
                const value = parseInt(this.widthInput.value) || 1080;
                this.widthInput.value = this.makeEven(value).toString();
            }
        });

        widthGroup.appendChild(widthLabel);
        widthGroup.appendChild(this.widthInput);

        const exchangeBtn = this.createExchangeButton();

        const heightGroup = document.createElement('div');
        heightGroup.className = 'render-ui-input-group';

        const heightLabel = document.createElement('span');
        heightLabel.className = 'render-ui-input-label';
        heightLabel.textContent = '高度 (px)';

        this.heightInput = document.createElement('input');
        this.heightInput.className = 'render-ui-input';
        this.heightInput.type = 'number';
        this.heightInput.value = '1920';
        this.heightInput.min = '1';
        this.heightInput.step = '2';
        this.heightInput.addEventListener('blur', () => {
            if (this.heightInput) {
                const value = parseInt(this.heightInput.value) || 1920;
                this.heightInput.value = this.makeEven(value).toString();
            }
        });

        heightGroup.appendChild(heightLabel);
        heightGroup.appendChild(this.heightInput);

        container.appendChild(widthGroup);
        container.appendChild(exchangeBtn);
        container.appendChild(heightGroup);

        return container;
    }

    private createExchangeButton(): HTMLElement {
        const btn = document.createElement('button');
        btn.className = 'render-ui-exchange-btn';
        btn.innerHTML = this.getExchangeIcon();
        btn.addEventListener('click', () => {
            if (this.widthInput && this.heightInput) {
                const temp = this.widthInput.value;
                this.widthInput.value = this.heightInput.value;
                this.heightInput.value = temp;
            }
        });
        return btn;
    }

    private createPresetButtonsRow(): HTMLElement {
        const row = document.createElement('div');
        row.className = 'render-ui-preset-buttons-row';

        const presets = [
            // {label: '开发预览', width: 240, height: 420},
            { label: '720P', width: 720, height: 1280 },
            { label: '1080P', width: 1080, height: 1920 },
            { label: '2K', width: 1440, height: 2560 }
        ];

        presets.forEach(preset => {
            const btn = document.createElement('button');
            btn.className = 'render-ui-preset-btn';
            btn.textContent = preset.label;
            btn.addEventListener('click', () => {
                if (this.widthInput && this.heightInput) {
                    this.widthInput.value = preset.width.toString();
                    this.heightInput.value = preset.height.toString();
                }
            });
            row.appendChild(btn);
        });

        return row;
    }

    private createFrameRateSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section';

        const label = document.createElement('label');
        label.className = 'render-ui-label';
        //label.textContent = '帧率';

        this.frameRateSlider = new Slider({
            label: '帧率',
            min: 1,
            max: 120,
            step: 1,
            value: 30,
            valueFormatter: (v) => `${v} FPS`
        });

        const SNAP_POINTS = [30, 60, 120];
        const SNAP_THRESHOLD = 3;

        this.frameRateSlider.onChange((value) => {
            let snappedValue = value;
            for (const snap of SNAP_POINTS) {
                if (Math.abs(value - snap) <= SNAP_THRESHOLD) {
                    snappedValue = snap;
                    this.frameRateSlider!.setValue(snap);
                    break;
                }
            }
            this.currentFrameRate = snappedValue;
            warning.style.display = snappedValue > 60 ? 'block' : 'none';
        });
        this.sliders.push(this.frameRateSlider);

        const warning = document.createElement('div');
        warning.textContent = '警告：部分设备可能不支持';
        warning.style.cssText = `
            font-size: 11px;
            color: ${theme.errorColor};
            font-style: italic;
            margin-top: 4px;
            display: none;
        `;

        const hint = document.createElement('div');
        hint.style.cssText = `
            font-size: 11px;
            color: ${theme.mutedMetaText};
            margin-top: 4px;
            font-style: italic;
        `;

        section.appendChild(label);
        section.appendChild(this.frameRateSlider.element);
        section.appendChild(warning);

        return section;
    }

    private createBitrateSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section';

        const label = document.createElement('label');
        label.className = 'render-ui-label';
        //label.textContent = '码率';

        this.bitrateSlider = new Slider({
            label: '码率',
            min: 1,
            max: 30,
            step: 1,
            value: 12,
            valueFormatter: (v) => `${v} MB/s`
        });
        this.bitrateSlider.onChange((value) => {
            this.currentBitrate = value;
        });
        this.sliders.push(this.bitrateSlider);

        section.appendChild(label);
        section.appendChild(this.bitrateSlider.element);

        return section;
    }

    /**
     * 渲染帧率上限滑块（仅实时渲染模式生效）
     * 滑块 1~30 FPS，最右端为「无限制」（默认）。非无限制时用固定步长慢放推进动画，
     * 渲染能力不足时动画整体慢放但不丢帧，用户自行倍速即可得到帧率稳定的视频。
     */
    private createRenderFpsSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section';
        section.style.display = 'none'; // 默认隐藏，仅实时渲染模式显示

        // 用 max=31 编码「无限制」档：1~30 为真实 fps，31 表示无限制
        this.renderFpsSlider = new Slider({
            label: '渲染帧率',
            min: 1,
            max: 31,
            step: 1,
            value: 31,
            valueFormatter: (v) => (v >= 31 ? '无限制' : `${v} FPS`)
        });
        this.renderFpsSlider.onChange((value) => {
            this.currentRenderFps = value >= 31 ? null : value;
        });
        this.sliders.push(this.renderFpsSlider);

        //const hint = document.createElement('div');
        //hint.className = 'render-ui-resolution-hint';
        //hint.textContent = '无限制=按真实时间渲染；设置帧率后渲染不足时动画慢放、不丢帧';

        section.appendChild(this.renderFpsSlider.element);
        //section.appendChild(hint);

        return section;
    }

    private createColorFixSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section';
        section.style.display = 'none';

        this.colorFixToggle = new ToggleSwitch({
            label: '偏色修复',
            initialState: false
        });

        const hint = document.createElement('div');
        hint.style.cssText = `
            font-size: 11px;
            color: ${theme.errorColor};
            margin-top: -8px;
            font-style: italic;
        `;
        hint.textContent = '仅在确认视频颜色不正常的情况下开启';

        section.appendChild(this.colorFixToggle.element);
        section.appendChild(hint);

        return section;
    }

    private createTransparentOutputSection(): HTMLElement {
        const section = document.createElement('div');
        section.className = 'render-ui-section';
        section.style.display = 'none';

        this.transparentOutputToggle = new ToggleSwitch({
            label: '透明背景',
            initialState: false
        });

        const hint = document.createElement('div');
        hint.style.cssText = `
            font-size: 11px;
            color: ${theme.warningColor};
            margin-top: -8px;
            font-style: italic;
        `;
        hint.textContent = '需在背景设置中选择「透明背景」';

        section.appendChild(this.transparentOutputToggle.element);
        section.appendChild(hint);

        return section;
    }

    private createFooter(): HTMLElement {
        const footer = document.createElement('div');
        footer.className = 'render-ui-footer';

        const startBtn = document.createElement('button');
        startBtn.className = 'render-ui-start-btn';
        startBtn.textContent = '开始渲染';
        startBtn.addEventListener('click', () => {
            this.handleStartRender().catch(error => {
                console.error('[RenderUI] Start render failed:', error);
            });
        });

        footer.appendChild(startBtn);

        return footer;
    }

    private createDropdown(
        options: { value: string; label: string }[],
        defaultValue: string,
        onChange?: (value: string) => void
    ): HTMLElement {
        const dropdown = document.createElement('div');
        dropdown.className = 'render-ui-dropdown';
        dropdown.dataset.value = defaultValue;

        const selectedDisplay = document.createElement('div');
        selectedDisplay.className = 'render-ui-dropdown-selected';

        const selectedText = document.createElement('span');
        selectedText.className = 'render-ui-dropdown-text';
        const defaultOption = options.find(opt => opt.value === defaultValue);
        selectedText.textContent = defaultOption?.label ?? options[0].label;

        const arrowIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        arrowIcon.setAttribute('class', 'render-ui-dropdown-arrow');
        arrowIcon.setAttribute('viewBox', '0 0 24 24');
        arrowIcon.setAttribute('fill', 'none');
        arrowIcon.setAttribute('stroke', 'currentColor');
        arrowIcon.setAttribute('stroke-width', '2');
        arrowIcon.setAttribute('stroke-linecap', 'round');
        arrowIcon.setAttribute('stroke-linejoin', 'round');
        arrowIcon.innerHTML = '<polyline points="9 18 15 12 9 6"></polyline>';

        selectedDisplay.appendChild(selectedText);
        selectedDisplay.appendChild(arrowIcon);

        const optionsList = document.createElement('div');
        optionsList.className = 'render-ui-dropdown-options';

        options.forEach(option => {
            const optionItem = document.createElement('div');
            optionItem.className = 'render-ui-dropdown-option';
            optionItem.textContent = option.label;
            optionItem.dataset.value = option.value;

            if (option.value === defaultValue) {
                optionItem.classList.add('selected');
            }

            optionItem.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedText.textContent = option.label;
                optionsList.querySelectorAll('.render-ui-dropdown-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                optionItem.classList.add('selected');
                dropdown.classList.remove('open');
                dropdown.dataset.value = option.value;
                onChange?.(option.value);
            });

            optionsList.appendChild(optionItem);
        });

        selectedDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            this.panel.querySelectorAll('.render-ui-dropdown.open').forEach((openDropdown) => {
                if (openDropdown !== dropdown) {
                    openDropdown.classList.remove('open');
                }
            });
            dropdown.classList.toggle('open');
        });

        const documentClickHandler = () => {
            dropdown.classList.remove('open');
        };
        document.addEventListener('click', documentClickHandler);
        this.dropdownClickListeners.push(() => {
            document.removeEventListener('click', documentClickHandler);
        });

        dropdown.appendChild(selectedDisplay);
        dropdown.appendChild(optionsList);

        return dropdown;
    }

    private updateResolutionControls(): void {
        this.widthInput!.disabled = false;
        this.heightInput!.disabled = false;
        this.resolutionInputs!.style.opacity = '1';
        if (this.resolutionHint) {
            this.resolutionHint.style.display = 'block';
        }
    }

    /**
     * 计算渲染分辨率
     * 所有渲染模式均使用用户输入的分辨率（自动调整为偶数）
     */
    private calculateResolution(): { width: number; height: number } {
        // 获取用户输入并调整为偶数
        let width = parseInt(this.widthInput?.value ?? '1920');
        let height = parseInt(this.heightInput?.value ?? '1080');

        // 调整为最大偶数（如果不是偶数则向下取整）
        width = this.makeEven(width);
        height = this.makeEven(height);

        // 同步更新UI显示
        if (this.widthInput) {
            this.widthInput.value = width.toString();
        }
        if (this.heightInput) {
            this.heightInput.value = height.toString();
        }

        return { width, height };
    }

    /**
     * 将数值调整为偶数（如果不是偶数则向下取最大偶数）
     */
    private makeEven(value: number): number {
        if (value % 2 !== 0) {
            return Math.max(2, value - 1);
        }
        return value;
    }

    private async handleStartRender(): Promise<void> {
        const resolution = this.calculateResolution();
        const settings: RenderSettings = {
            renderMode: this.currentRenderMode,
            resolution: {
                width: resolution.width,
                height: resolution.height
            },
            frameRate: this.currentFrameRate,
            bitrate: this.currentBitrate,
            renderFps: this.currentRenderFps,
            frameRange: this.currentRenderMode === 'offline' ? this.getFrameRange() : undefined,
            workerCount: this.currentWorkerCount,
            forceColorFix: this.colorFixToggle?.getValue() ?? false,
            transparentOutput: this.transparentOutputToggle?.getValue() ?? false
        };

        this.onStartRenderCallback?.(settings);
    }

    /**
     * 进入全屏模式
     */
    private async enterFullscreen(): Promise<void> {
        // 检查实际全屏状态，而不仅依赖 isFullscreen 标志
        if (this.checkFullscreenState()) {
            this.isFullscreen = true;
            return;
        }

        try {
            const docEl = document.documentElement;
            let requestMethod;

            if (docEl.requestFullscreen) {
                requestMethod = docEl.requestFullscreen.bind(docEl);
            } else if ((docEl as any).webkitRequestFullscreen) {
                requestMethod = (docEl as any).webkitRequestFullscreen.bind(docEl);
            } else if ((docEl as any).mozRequestFullScreen) {
                requestMethod = (docEl as any).mozRequestFullScreen.bind(docEl);
            } else if ((docEl as any).msRequestFullscreen) {
                requestMethod = (docEl as any).msRequestFullscreen.bind(docEl);
            }

            if (requestMethod) {
                await requestMethod();
                this.isFullscreen = true;

                // 在原生平台设置沉浸式模式
                if (Capacitor.isNativePlatform()) {
                    try {
                        await Fullscreen.setImmersiveMode({ enabled: true });
                    } catch (e) {
                        console.warn('[RenderUI] 设置沉浸模式失败:', e);
                    }
                }

                console.log('[RenderUI] 已进入全屏模式');
            }
        } catch (error) {
            console.error('[RenderUI] 进入全屏失败:', error);
        }
    }

    /**
     * 退出全屏模式
     */
    private async exitFullscreen(): Promise<void> {
        if (!this.isFullscreen) return;

        try {
            let exitMethod;

            if (document.exitFullscreen) {
                exitMethod = document.exitFullscreen.bind(document);
            } else if ((document as any).webkitExitFullscreen) {
                exitMethod = (document as any).webkitExitFullscreen.bind(document);
            } else if ((document as any).mozCancelFullScreen) {
                exitMethod = (document as any).mozCancelFullScreen.bind(document);
            } else if ((document as any).msExitFullscreen) {
                exitMethod = (document as any).msExitFullscreen.bind(document);
            }

            if (exitMethod) {
                await exitMethod();
                this.isFullscreen = false;

                if (Capacitor.isNativePlatform()) {
                    try {
                        await Fullscreen.setImmersiveMode({ enabled: false });
                    } catch (e) {
                        console.warn('[RenderUI] 退出沉浸模式失败:', e);
                    }
                }

                console.log('[RenderUI] 已退出全屏模式');
            }
        } catch (error) {
            console.error('[RenderUI] 退出全屏失败:', error);
        }
    }

    private getExchangeIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="m320-160-56-57 103-103H80v-80h287L264-503l56-57 200 200-200 200Zm320-240L440-600l200-200 56 57-103 103h287v80H593l103 103-56 57Z"/></svg>
        `;
    }

    private getCloseIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
    }

    public dispose(): void {
        // 清理 Slider 组件
        this.sliders.forEach(s => s.dispose());
        this.sliders = [];

        // 移除全局事件监听器
        this.dropdownClickListeners.forEach(removeListener => removeListener());
        this.dropdownClickListeners = [];

        this.fullscreenChangeListeners.forEach(removeListener => removeListener());
        this.fullscreenChangeListeners = [];

        // 移除 DOM 元素
        if (this.overlay.parentElement) {
            this.overlay.parentElement.removeChild(this.overlay);
        }
        if (this.panel.parentElement) {
            this.panel.parentElement.removeChild(this.panel);
        }
    }
}
