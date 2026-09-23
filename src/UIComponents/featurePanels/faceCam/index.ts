/**
 * 面部相机面板（内置版）
 * 包装原 V1.0 插件 JS，适配宿主 UI 组件
 */
import type { IPanel } from '../../../core/IPanel';
import type { MainWindow } from '../../MainWindow';

// @ts-ignore
import * as faceCore from './faceCamCore.js';

export class FaceCameraPanel implements IPanel {
    readonly id = 'facecamera';
    readonly tabLabel = '面部相机';
    readonly tabIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>`;
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private panelElement: HTMLElement | null = null;
    private pluginContext: any = null;
    private initialized = false;

    constructor(options: { mainWindow?: MainWindow }) {
        this.mainWindow = options.mainWindow ?? null;
        this.element = document.createElement('div');
        this.element.style.cssText = 'height:100%;';
    }

    onShow(): void {
        if (!this.initialized) {
            this.initPanel();
        }
        faceCore.onShown?.();
    }

    onHide(): void {
        faceCore.onHidden?.();
    }

    private initPanel(): void {
        if (this.initialized) return;

        const scene = this.mainWindow?.getSceneManager()?.getScene();
        if (!scene) return;

        this.pluginContext = {
            scene: scene,
            eventBus: (this.mainWindow as any)?.getEventBus?.(),
            storage: {
                get: async (key: string) => {
                    try {
                        const raw = localStorage.getItem(`faceCam_${key}`);
                        return raw ? JSON.parse(raw) : null;
                    } catch { return null; }
                },
                set: (key: string, value: any) => {
                    try {
                        localStorage.setItem(`faceCam_${key}`, JSON.stringify(value));
                    } catch {}
                }
            }
        };

        // 注入全局 mp 对象
        (window as any).mp = {
            ui: {
                Slider: (config: any) => ({ element: document.createElement('div'), onChange: () => {}, dispose: () => {} }),
                Dropdown: (config: any) => ({ element: document.createElement('div'), onChange: () => {}, dispose: () => {} }),
                ToggleSwitch: (config: any) => ({ element: document.createElement('div'), onChange: () => {}, dispose: () => {} }),
                toast: {
                    success: (msg: string) => console.log('[FaceCam]', msg),
                    info: (msg: string) => console.log('[FaceCam]', msg),
                    error: (msg: string) => console.error('[FaceCam]', msg)
                }
            },
            model: {
                list: () => this.mainWindow?.getModelManager?.()?.getAllModels?.() ?? [],
                onChanged: (cb: () => void) => () => {}
            }
        };

        this.panelElement = faceCore.createPanel(this.pluginContext);
        if (this.panelElement) {
            this.element.appendChild(this.panelElement);
        }

        this.initialized = true;
    }

    dispose(): void {
        faceCore.dispose?.();
        this.panelElement = null;
        this.pluginContext = null;
        this.initialized = false;
    }

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }
}

export default FaceCameraPanel;
