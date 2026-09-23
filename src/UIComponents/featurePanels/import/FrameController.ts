
import type { AnimationManager, CameraManager } from '../../../features/mmd';
import { eventBus, Events } from '../../../core';

export class FrameController {
    readonly element: HTMLElement;

    private animationManager: AnimationManager;
    private cameraManager: CameraManager | null = null;
    private frameCtrlInput: HTMLInputElement | null = null;
    private currentFrame: number = 0;
    private frameUpdateCallbacks: Set<(frame: number) => void> = new Set();
    private unsubscribeFrameUpdated: (() => void) | null = null;
    private onFrameChangeCallback: ((frame: number) => void) | null = null;

    // RAF 节流：拖动时合并多个 seek 请求为每帧一次
    private _seekRafPending = false;

    // document 级监听器引用（dispose 时需移除）
    private documentMousemoveHandler: ((e: MouseEvent) => void) | null = null;
    private documentMouseupHandler: (() => void) | null = null;

    constructor(animationManager: AnimationManager, cameraManager?: CameraManager, onFrameChange?: (frame: number) => void) {
        this.animationManager = animationManager;
        this.cameraManager = cameraManager || null;
        this.onFrameChangeCallback = onFrameChange || null;
        this.element = this.create();
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // 监听帧更新事件，用于播放时同步显示
        this.unsubscribeFrameUpdated = eventBus.on(Events.FRAME_UPDATED, (data: { frame: number }) => {
            this.updateFrameFromPlayback(data.frame);
        });
    }

    private create(): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'frame-ctrl-bottom-bar';

        const jumpButtons = document.createElement('div');
        jumpButtons.className = 'frame-ctrl-jump-buttons';

        const startBtn = document.createElement('button');
        startBtn.className = 'frame-ctrl-jump-btn start';
        startBtn.innerHTML = this.getFirstPageIcon();
        startBtn.title = '跳转到开头';
        startBtn.addEventListener('click', () => this.jumpToStart());

        const endBtn = document.createElement('button');
        endBtn.className = 'frame-ctrl-jump-btn end';
        endBtn.innerHTML = this.getFirstPageIcon();
        endBtn.title = '跳转到末尾';
        endBtn.addEventListener('click', () => this.jumpToEnd());

        jumpButtons.appendChild(startBtn);
        jumpButtons.appendChild(endBtn);

        const valueController = this.createFrameValueController();

        bar.appendChild(jumpButtons);
        bar.appendChild(valueController);

        return bar;
    }

    private getFirstPageIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M240-240v-480h80v480h-80Zm440 0L440-480l240-240 56 56-184 184 184 184-56 56Z"/>
            </svg>
        `;
    }

    private jumpToStart(): void {
        this.setCurrentFrame(0);
    }

    private jumpToEnd(): void {
        const maxFrame = this.getAnimationMaxFrame();
        this.setCurrentFrame(maxFrame);
    }

    private getAnimationMaxFrame(): number {
        const maxFrame = this.animationManager.getMaxAnimationFrames();
        return maxFrame > 0 ? maxFrame : 999999;
    }

    private createFrameValueController(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'frame-ctrl-value-controller';

        const leftArrow = document.createElement('div');
        leftArrow.className = 'frame-ctrl-value-arrow left';
        leftArrow.innerHTML = this.getArrowIcon();

        this.frameCtrlInput = document.createElement('input');
        this.frameCtrlInput.className = 'frame-ctrl-value-input';
        this.frameCtrlInput.type = 'text';
        this.frameCtrlInput.value = '0';
        this.frameCtrlInput.readOnly = true;

        const rightArrow = document.createElement('div');
        rightArrow.className = 'frame-ctrl-value-arrow right';
        rightArrow.innerHTML = this.getArrowIcon();

        this.addArrowTouchSupport(leftArrow, -1);
        this.addArrowTouchSupport(rightArrow, 1);

        this.addSliderSupport(container);

        container.appendChild(leftArrow);
        container.appendChild(this.frameCtrlInput);
        container.appendChild(rightArrow);

        return container;
    }

    private getArrowIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
        `;
    }

    private addArrowTouchSupport(arrow: HTMLElement, amount: number): void {
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
                this.adjustFrame(amount);
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
            this.adjustFrame(amount);
        });
    }

    private addSliderSupport(container: HTMLElement): void {
        let startX = 0;
        let startFrame = 0;
        let isDragging = false;

        const handleStart = (clientX: number) => {
            startX = clientX;
            startFrame = this.currentFrame;
            isDragging = true;
            container.style.cursor = 'grabbing';
        };

        const handleMove = (clientX: number) => {
            if (!isDragging) return;

            const deltaX = clientX - startX;
            const frames = Math.floor(deltaX);
            const newFrame = startFrame + frames;

            if (newFrame !== this.currentFrame) {
                // 拖动时延迟 seek：RAF 合并同一帧内的多次变更
                this.setCurrentFrame(newFrame, true);
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

        this.documentMousemoveHandler = (e) => {
            handleMove(e.clientX);
        };
        this.documentMouseupHandler = () => {
            handleEnd();
        };
        document.addEventListener('mousemove', this.documentMousemoveHandler);
        document.addEventListener('mouseup', this.documentMouseupHandler);

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
    }

    private adjustFrame(delta: number): void {
        const newFrame = this.currentFrame + delta;
        this.setCurrentFrame(newFrame);
    }

    private setCurrentFrame(frame: number, deferSeek: boolean = false): void {
        if (!Number.isFinite(frame)) {
            console.warn('setCurrentFrame: 无效的帧数值', frame);
            return;
        }

        let maxFrame = this.getAnimationMaxFrame();
        if (!Number.isFinite(maxFrame) || maxFrame < 0) {
            maxFrame = 0;
        }
        const clampedFrame = Math.max(0, Math.min(frame, maxFrame));

        this.currentFrame = clampedFrame;

        // 脏检查：仅在帧值变化时更新DOM
        if (this.frameCtrlInput && this.frameCtrlInput.value !== Math.floor(this.currentFrame).toString()) {
            this.frameCtrlInput.value = Math.floor(this.currentFrame).toString();
            this._updateProgressBar();
        }

        this.frameUpdateCallbacks.forEach(callback => {
            try {
                callback(this.currentFrame);
            } catch (error) {
                console.error('帧更新回调执行失败:', error);
            }
        });

        // 通知 MainWindow 更新当前帧，以便播放时从正确位置开始
        if (this.onFrameChangeCallback) {
            this.onFrameChangeCallback(this.currentFrame);
        }

        if (deferSeek) {
            // 拖动时延迟 seek：合并同一帧内的多次变更
            if (!this._seekRafPending) {
                this._seekRafPending = true;
                requestAnimationFrame(() => {
                    this._seekRafPending = false;
                    this.animationManager.seekAnimation(this.currentFrame);
                    this.updateCameraFrame();
                });
            }
        } else {
            this.animationManager.seekAnimation(this.currentFrame);
            this.updateCameraFrame();
        }
    }

    private updateCameraFrame(): void {
        if (!this.cameraManager) {
            return;
        }

        this.cameraManager.updateAnimationForRender(this.currentFrame);
    }

    private _updateProgressBar(): void {
        if (!this.frameCtrlInput) return;
        const maxFrame = this.getAnimationMaxFrame();
        const progress = maxFrame > 0 ? (this.currentFrame / maxFrame * 100) : 0;
        this.frameCtrlInput.style.setProperty('--progress', `${progress}%`);
    }

    getCurrentFrame(): number {
        return this.currentFrame;
    }

    setPlaying(playing: boolean): void {
    }

    onFrameUpdate(callback: (frame: number) => void): void {
        this.frameUpdateCallbacks.add(callback);
    }

    offFrameUpdate(callback: (frame: number) => void): void {
        this.frameUpdateCallbacks.delete(callback);
    }

    updateFrameFromPlayback(frame: number): void {
        if (!Number.isFinite(frame)) {
            return;
        }
        this.currentFrame = frame;
        if (this.frameCtrlInput) {
            this.frameCtrlInput.value = Math.floor(frame).toString();
            this._updateProgressBar();
        }
    }

    dispose(): void {
        this.frameUpdateCallbacks.clear();
        this.unsubscribeFrameUpdated?.();
        this.unsubscribeFrameUpdated = null;
        // 移除 document 级监听器，防止泄漏
        if (this.documentMousemoveHandler) {
            document.removeEventListener('mousemove', this.documentMousemoveHandler);
            this.documentMousemoveHandler = null;
        }
        if (this.documentMouseupHandler) {
            document.removeEventListener('mouseup', this.documentMouseupHandler);
            this.documentMouseupHandler = null;
        }
    }
}
