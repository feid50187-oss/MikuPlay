/**
 * 灯光管理器面板（内置版）
 * 包装原 V3.2.3 插件 JS，适配宿主 UI 组件
 */
import type { IPanel } from '../../../core/IPanel';
import type { MainWindow } from '../../MainWindow';
import { Slider } from '../../shared/Slider';
import { Dropdown } from '../../shared/Dropdown';
import { ToggleSwitch } from '../../shared/ToggleSwitch';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/></svg>`;

// 导入灯光管理器核心 JS
// @ts-ignore
import * as lightCore from './lightMgrCore.js';

export class LightManagerPanel implements IPanel {
    readonly id = 'lights';
    readonly tabLabel = '灯光';
    readonly tabIcon = TAB_ICON;
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
        lightCore.onShown?.();
    }

    onHide(): void {
        lightCore.onHidden?.();
    }

    private initPanel(): void {
        if (this.initialized) return;

        const scene = this.mainWindow?.getSceneManager()?.getScene();
        if (!scene) return;

        // 构建 mp 上下文
        this.pluginContext = {
            scene: scene,
            eventBus: this.mainWindow?.getEventBus?.(),
            storage: {
                get: async (key: string) => {
                    try {
                        // 先从 localStorage 读（快速缓存）
                        const raw = localStorage.getItem(`lightMgr_${key}`);
                        if (raw) return JSON.parse(raw);

                        // 再从内容库读（持久化）
                        const { contentLibraryApi } = await import('../../../features/library/ContentLibraryApi');
                        const assets = contentLibraryApi.listAssets('lights');
                        const asset = assets.find(a => a.name === `灯光预设_${key}.json`);
                        if (asset) {
                            const data = await contentLibraryApi.readFile(asset.path);
                            const text = new TextDecoder().decode(data);
                            return JSON.parse(text);
                        }
                        return null;
                    } catch { return null; }
                },
                set: async (key: string, value: any) => {
                    try {
                        // 先存 localStorage（快速缓存）
                        localStorage.setItem(`lightMgr_${key}`, JSON.stringify(value));

                        // 再存内容库（持久化）
                        const { contentLibraryApi } = await import('../../../features/library/ContentLibraryApi');
                        const data = JSON.stringify(value);
                        const blob = new Blob([data], { type: 'application/json' });
                        await contentLibraryApi.addAsset(blob, 'lights', `灯光预设_${key}.json`);
                    } catch {}
                }
            }
        };

        // 注入全局 mp 对象（供 JS 核心使用）
        (window as any).mp = {
            ui: {
                Slider: (config: any) => new Slider(config),
                Dropdown: (config: any) => new Dropdown(config),
                ToggleSwitch: (config: any) => new ToggleSwitch(config),
                toast: {
                    success: (msg: string) => console.log('[LightMgr]', msg),
                    info: (msg: string) => console.log('[LightMgr]', msg),
                    error: (msg: string) => console.error('[LightMgr]', msg)
                }
            },
            model: {
                list: () => this.mainWindow?.getModelManager?.()?.getAllModels?.() ?? [],
                onChanged: (cb: () => void) => {
                    // 模型变化监听
                    return () => {};
                }
            }
        };

        // 调用核心 createPanel
        this.panelElement = lightCore.createPanel(this.pluginContext);
        if (this.panelElement) {
            this.element.appendChild(this.panelElement);
        }

        // 添加导入导出按钮栏
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'padding:8px;border-top:1px solid #e0e0e0;display:flex;gap:8px;';

        const exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.textContent = '导出预设到内容库';
        exportBtn.style.cssText = 'flex:1;padding:6px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;';
        exportBtn.onclick = () => this.exportPreset();

        const importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.textContent = '从内容库导入预设';
        importBtn.style.cssText = 'flex:1;padding:6px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;';
        importBtn.onclick = () => this.importPreset();

        toolbar.appendChild(exportBtn);
        toolbar.appendChild(importBtn);
        this.element.appendChild(toolbar);

        this.initialized = true;
    }

    /**
     * 导出灯光预设到内容库
     */
    private async exportPreset(): Promise<void> {
        try {
            const name = prompt('输入预设名称:', `灯光预设_${new Date().toLocaleDateString()}`);
            if (!name) return;

            // 收集当前灯光设置
            const settings: Record<string, any> = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('lightMgr_')) {
                    settings[key.replace('lightMgr_', '')] = JSON.parse(localStorage.getItem(key) || 'null');
                }
            }

            const { contentLibraryApi } = await import('../../../features/library/ContentLibraryApi');
            const data = JSON.stringify({
                format: 'MikuPlayReburn.LightPreset',
                version: '1.0',
                name: name,
                settings: settings,
                exportedAt: new Date().toISOString()
            });
            const blob = new Blob([data], { type: 'application/json' });
            await contentLibraryApi.addAsset(blob, 'lights', `${name}.json`);
            alert('预设已导出到内容库');
        } catch (e) {
            alert('导出失败: ' + (e as Error).message);
        }
    }

    /**
     * 从内容库导入灯光预设
     */
    private async importPreset(): Promise<void> {
        try {
            const { contentLibraryApi } = await import('../../../features/library/ContentLibraryApi');
            const assets = contentLibraryApi.listAssets('lights');

            if (assets.length === 0) {
                alert('内容库中没有找到灯光预设');
                return;
            }

            const list = assets.map((a, i) => `${i + 1}. ${a.name}`).join('\n');
            const choice = prompt(`选择要导入的预设:\n${list}`);
            if (!choice) return;

            const idx = Number(choice) - 1;
            if (idx < 0 || idx >= assets.length) {
                alert('无效选择');
                return;
            }

            // 读取文件内容
            const asset = assets[idx];
            const data = await contentLibraryApi.readFile(asset.path);
            const text = new TextDecoder().decode(data);
            const json = JSON.parse(text);

            if (json.format !== 'MikuPlayReburn.LightPreset') {
                alert('文件格式不正确');
                return;
            }

            // 应用导入
            Object.entries(json.settings || {}).forEach(([key, value]) => {
                localStorage.setItem(`lightMgr_${key}`, JSON.stringify(value));
            });

            alert(`已导入预设: ${json.name || asset.name}`);
            location.reload(); // 刷新应用设置
        } catch (e) {
            alert('导入失败: ' + (e as Error).message);
        }
    }

    dispose(): void {
        lightCore.dispose?.();
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

export default LightManagerPanel;
