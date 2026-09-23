
import { injectStyles } from '../styles/mainWindow.css';
import { topBarStyles } from '../styles/components/topBar.css';
import { SidePanel } from './sidePanel';
import { PerformanceMonitor } from '../features/performance/PerformanceMonitor';
import { MusicManager } from '../features/audio/MusicManager';
import { Capacitor } from '@capacitor/core';
import { RenderManager } from '../features/render/RenderManager';
import { eventBus, Events } from '../core';
import { theme } from '../styles/theme';
import { Fullscreen } from '../utils/platform';

export class TopBar {
    private container: HTMLElement;
    private menuButton: HTMLElement;
    private sidePanel: SidePanel;
    private animationControls: HTMLElement;
    private playPauseButton: HTMLElement;
    private stopButton: HTMLElement;
    private fullscreenButton: HTMLElement;
    private renderButton: HTMLElement;
    private render: RenderManager;
    private performanceMonitorContainer: HTMLElement;
    private fpsDisplay!: HTMLElement;
    private performanceMonitor: PerformanceMonitor | null = null;
    private musicManager: MusicManager;

    private isPlaying: boolean = false;
    private isFullscreen: boolean = false;
    private onPlayPauseCallback: (() => void) | null = null;
    private onStopCallback: (() => void) | null = null;

    // 性能显示缓存（脏检查）
    private lastDisplayedFps: number = -1;

    constructor() {
        injectStyles(topBarStyles, 'view-topbar');

        this.sidePanel = new SidePanel();
        this.render = new RenderManager();
        this.musicManager = MusicManager.getInstance();
        this.container = this.createContainer();
        this.menuButton = this.createMenuButton();
        this.performanceMonitorContainer = this.createPerformanceMonitorContainer();
        this.animationControls = this.createAnimationControls();
        this.fullscreenButton = this.createFullscreenButton();
        this.renderButton = this.createRenderButton();
        this.stopButton = this.createStopButton();
        this.playPauseButton = this.createPlayPauseButton();

        this.animationControls.appendChild(this.renderButton);
        this.animationControls.appendChild(this.fullscreenButton);
        this.animationControls.appendChild(this.stopButton);
        this.animationControls.appendChild(this.playPauseButton);

        this.container.appendChild(this.menuButton);
        this.container.appendChild(this.performanceMonitorContainer);
        this.container.appendChild(this.createSpacer());
        this.container.appendChild(this.animationControls);

        // 设置性能监测开关回调
        this.sidePanel.onPerformanceToggle((enabled) => {
            this.togglePerformanceMonitor(enabled);
        });

        // 性能监测默认开启，初始化时主动启动
        if (this.sidePanel.isPerformanceMonitorEnabled()) {
            this.startPerformanceMonitor();
        }

        // 监听音乐播放状态变化
        this.setupMusicStateListener();

        // 设置全屏状态监听
        this.setupFullscreenListeners();
    }

    private setupMusicStateListener(): void {
        eventBus.on(Events.MUSIC_STATE_CHANGED, (state: MusicPlaybackState) => {
            if (state === 'playing') {
                this.isPlaying = true;
            } else if (state === 'paused' || state === 'stopped') {
                this.isPlaying = false;
            }
            this.updatePlayPauseButton();
        });
    }

    private createContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'top-bar-container';
        return container;
    }

    private createMenuButton(): HTMLElement {
        const button = document.createElement('button');
        button.className = 'menu-button';
        button.setAttribute('aria-label', '打开菜单');
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
        `;

        button.addEventListener('click', () => {
            this.sidePanel.toggle();
        });

        return button;
    }

    private createSpacer(): HTMLElement {
        const spacer = document.createElement('div');
        spacer.className = 'top-bar-spacer';
        return spacer;
    }

    private createAnimationControls(): HTMLElement {
        const controls = document.createElement('div');
        controls.className = 'animation-controls';
        return controls;
    }

    private createPlayPauseButton(): HTMLElement {
        const button = document.createElement('button');
        button.className = 'control-button';
        button.setAttribute('aria-label', '播放');
        button.innerHTML = this.getPlayIcon();

        button.addEventListener('click', () => {
            this.togglePlayPause();
        });

        return button;
    }

    private createStopButton(): HTMLElement {
        const button = document.createElement('button');
        button.className = 'control-button';
        button.setAttribute('aria-label', '停止');
        button.innerHTML = this.getStopIcon();

        button.addEventListener('click', () => {
            this.stop();
        });

        return button;
    }

    private getPlayIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
        `;
    }

    private getPauseIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
        `;
    }

    private getStopIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h12v12H6z"/>
            </svg>
        `;
    }

    private getFullscreenIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M560-280h200v-200h-80v120H560v80ZM200-480h80v-120h120v-80H200v200Zm-40 320q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Z"/>
            </svg>
        `;
    }

    private getRenderIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M456-600h320q-27-69-82.5-118.5T566-788L456-600Zm-92 80 160-276q-11-2-22-3t-22-1q-66 0-123 25t-101 67l108 188ZM170-400h218L228-676q-32 41-50 90.5T160-480q0 21 2.5 40.5T170-400Zm224 228 108-188H184q27 69 82.5 118.5T394-172Zm86 12q66 0 123-25t101-67L596-440 436-164q11 2 21.5 3t22.5 1Zm252-124q32-41 50-90.5T800-480q0-21-2.5-40.5T790-560H572l160 276ZM480-480Zm0 400q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q83 0 155.5 31.5t127 86q54.5 54.5 86 127T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z"/>
            </svg>
        `;
    }

    private createRenderButton(): HTMLElement {
        const button = document.createElement('button');
        button.className = 'control-button render-button';
        button.setAttribute('aria-label', '渲染');
        button.innerHTML = this.getRenderIcon();
        button.style.color = 'var(--color-accent)';

        button.addEventListener('click', () => {
            this.render.toggle().catch(error => {
                console.error('[TopBar] 切换渲染失败:', error);
            });
        });

        return button;
    }

    private getFullscreenExitIcon(): string {
        return `
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
                <path d="M240-200v-160h-80v-80h160v240h-80Zm400 0v-240h160v80h-80v160h-80ZM160-560v-80h80v-160h80v240H160Zm480 0v-240h80v160h80v80H640Z"/>
            </svg>
        `;
    }

    private createFullscreenButton(): HTMLElement {
        const button = document.createElement('button');
        button.className = 'control-button fullscreen-button';
        button.setAttribute('aria-label', '全屏');
        button.innerHTML = this.getFullscreenIcon();

        button.addEventListener('click', () => {
            this.toggleFullscreen();
        });

        return button;
    }

    private setupFullscreenListeners(): void {
        const fullscreenEvents = [
            'fullscreenchange',
            'webkitfullscreenchange',
            'mozfullscreenchange',
            'MSFullscreenChange'
        ];

        fullscreenEvents.forEach(eventName => {
            document.addEventListener(eventName, () => {
                const isFullscreen = this.checkFullscreenState();
                if (this.isFullscreen !== isFullscreen) {
                    this.isFullscreen = isFullscreen;
                    this.updateFullscreenButton();
                    eventBus.emit(Events.FULLSCREEN_CHANGED, { isFullscreen: this.isFullscreen });
                }
            });
        });


    }

    private checkFullscreenState(): boolean {
        return !!(
            document.fullscreenElement ||
            (document as any).webkitFullscreenElement ||
            (document as any).mozFullScreenElement ||
            (document as any).msFullscreenElement
        );
    }

    private async toggleFullscreen(): Promise<void> {
        if (this.isFullscreen) {
            await this.exitFullscreen();
        } else {
            await this.enterFullscreen();
        }
    }

    private async enterFullscreen(): Promise<void> {
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
                this.updateFullscreenButton();
                this.showFullscreenToast();
                eventBus.emit(Events.FULLSCREEN_CHANGED, { isFullscreen: true });

                if (Capacitor.isNativePlatform()) {
                    try {
                        await Fullscreen.setImmersiveMode({ enabled: true });
                    } catch (e) {
                        console.warn('设置沉浸模式失败:', e);
                    }
                }
            }
        } catch (error) {
            console.error('进入全屏失败:', error);
        }
    }

    public async exitFullscreen(): Promise<void> {
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
                this.updateFullscreenButton();
                eventBus.emit(Events.FULLSCREEN_CHANGED, { isFullscreen: false });

                if (Capacitor.isNativePlatform()) {
                    try {
                        await Fullscreen.setImmersiveMode({ enabled: false });
                    } catch (e) {
                        console.warn('退出沉浸模式失败:', e);
                    }
                }
            }
        } catch (error) {
            console.error('退出全屏失败:', error);
        }
    }

    private updateFullscreenButton(): void {
        this.fullscreenButton.setAttribute('aria-label', this.isFullscreen ? '退出全屏' : '全屏');
        this.fullscreenButton.innerHTML = this.isFullscreen ? this.getFullscreenExitIcon() : this.getFullscreenIcon();
    }

    private showFullscreenToast(): void {
        // 检测是否为移动端
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // 创建 toast 提示
        const toast = document.createElement('div');
        toast.className = 'fullscreen-toast';
        toast.textContent = isMobile ? '点击返回键退出全屏' : '按 ESC 键退出全屏';
        toast.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: ${theme.overlayDarkBg80};
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 10000;
            pointer-events: none;
            animation: fadeInOut 2s ease-in-out forwards;
        `;

        // 添加动画样式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
                20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(toast);

        // 2秒后移除
        setTimeout(() => {
            toast.remove();
            style.remove();
        }, 2000);
    }

    public isInFullscreen(): boolean {
        return this.isFullscreen;
    }

    private togglePlayPause(): void {
        // 转发事件，由 MainWindow 统一处理音乐和动画的同步控制
        if (this.onPlayPauseCallback) {
            this.onPlayPauseCallback();
        }
    }

    private stop(): void {
        this.isPlaying = false;
        this.updatePlayPauseButton();
        // 转发事件，由 MainWindow 统一处理音乐和动画的同步控制
        if (this.onStopCallback) {
            this.onStopCallback();
        }
    }

    private updatePlayPauseButton(): void {
        this.playPauseButton.setAttribute('aria-label', this.isPlaying ? '暂停' : '播放');
        this.playPauseButton.innerHTML = this.isPlaying ? this.getPauseIcon() : this.getPlayIcon();
    }

    public onPlayPause(callback: () => void): void {
        this.onPlayPauseCallback = callback;
    }

    public onStop(callback: () => void): void {
        this.onStopCallback = callback;
    }

    public setPlaying(playing: boolean): void {
        this.isPlaying = playing;
        this.updatePlayPauseButton();
    }

    public getElement(): HTMLElement {
        return this.container;
    }

    public getSidePanel(): SidePanel {
        return this.sidePanel;
    }

    /**
     * 获取音乐管理器实例
     * @returns MusicManager实例
     */
    public getMusicManager(): MusicManager {
        return this.musicManager;
    }

    /**
     * 获取渲染管理器实例
     * @returns RenderManager实例
     */
    public getRenderManager(): RenderManager {
        return this.render;
    }

    /**
     * 创建性能监测容器
     * @returns 性能监测容器元素
     */
    private createPerformanceMonitorContainer(): HTMLElement {
        const container = document.createElement('div');
        container.className = 'performance-monitor-container';
        container.style.display = 'none'; // 默认隐藏

        // FPS 显示行
        const fpsRow = document.createElement('div');
        fpsRow.className = 'performance-monitor-row';

        const fpsLabel = document.createElement('span');
        fpsLabel.className = 'performance-monitor-label';
        fpsLabel.textContent = 'FPS';

        this.fpsDisplay = document.createElement('span');
        this.fpsDisplay.className = 'performance-monitor-value fps-value';
        this.fpsDisplay.textContent = '0';

        fpsRow.appendChild(fpsLabel);
        fpsRow.appendChild(this.fpsDisplay);

        container.appendChild(fpsRow);

        return container;
    }

    /**
     * 切换性能监测状态
     * @param enabled 是否启用
     */
    private togglePerformanceMonitor(enabled: boolean): void {
        if (enabled) {
            this.startPerformanceMonitor();
        } else {
            this.stopPerformanceMonitor();
        }
    }

    /**
     * 启动性能监测
     */
    private startPerformanceMonitor(): void {
        if (!this.performanceMonitor) {
            this.performanceMonitor = new PerformanceMonitor();
        }

        this.performanceMonitorContainer.style.display = 'flex';

        this.performanceMonitor.start((fps) => {
            this.updatePerformanceDisplay(fps);
        });
    }

    /**
     * 停止性能监测
     */
    private stopPerformanceMonitor(): void {
        this.performanceMonitor?.stop();
        this.performanceMonitor?.dispose();
        this.performanceMonitor = null;

        this.performanceMonitorContainer.style.display = 'none';
    }

    /**
     * 更新性能数据显示
     * @param fps FPS值
     */
    private updatePerformanceDisplay(fps: number): void {
        // 脏检查：仅在值变化时更新DOM
        if (this.lastDisplayedFps !== fps) {
            this.lastDisplayedFps = fps;
            this.fpsDisplay.textContent = fps.toString();

            // 根据FPS值设置颜色
            this.fpsDisplay.classList.remove('fps-good', 'fps-warning', 'fps-bad');
            if (fps >= 55) {
                this.fpsDisplay.classList.add('fps-good');
            } else if (fps >= 30) {
                this.fpsDisplay.classList.add('fps-warning');
            } else {
                this.fpsDisplay.classList.add('fps-bad');
            }
        }
    }

    /**
     * 获取性能监测是否启用
     * @returns 是否启用
     */
    public isPerformanceMonitorEnabled(): boolean {
        return this.sidePanel.isPerformanceMonitorEnabled();
    }

    public dispose(): void {
        this.stopPerformanceMonitor();
        this.sidePanel.dispose();
        this.render.dispose();
        this.musicManager.dispose();
    }
}
