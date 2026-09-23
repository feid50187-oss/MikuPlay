/**
 * 开发者控制台入口（pdev 变体专用）
 *
 * 职责：
 * 1. 动态加载 Eruda 并初始化
 * 2. 暴露 window.__dev 全局对象（mp / createContext / refreshPlugins）
 * 3. 创建可拖动的 SVG 刷新按钮（JS 侧热重载入口）
 *
 * 正式版（非 pdev）此模块不会被 import，经 tree-shake 移除。
 */

import type { MainWindow } from '../UIComponents/MainWindow';
import type { PluginContext } from '../core/IPlugin';
import { pluginRegistry } from '../core/PluginRegistry';
import { pluginLoader } from '../plugins/PluginLoader';
// Eruda 原始 UMD 文件作为静态资源打包（?url），仅当本模块被引用时才进入构建产物
import erudaUrl from 'eruda/eruda.js?url';

/** dev 全局对象接口 */
export interface DevGlobal {
    /** 刷新（热重载）所有开发插件 */
    refreshPlugins(): Promise<void>;
    /** 创建插件上下文（供 REPL 使用） */
    createContext(pluginId: string): PluginContext;
    /** 打开 Eruda 控制台 */
    showConsole(): void;
}

/** Eruda 全局对象最小类型（window.eruda，经 script 标签加载的原始 UMD） */
export interface ErudaGlobal {
    init(options?: {
        container?: HTMLElement;
        tool?: string[];
        autoScale?: boolean;
        defaults?: { displaySize?: number; transparency?: number; theme?: 'Dark' | 'Light' };
    }): void;
    get(name: string): { show(): void } | undefined;
}

let erudaReady = false;

/**
 * 通过 <script> 标签加载 Eruda 原始 UMD 文件（eruda/eruda.js 经 ?url 打包为静态资源）。
 * 返回 Promise 在脚本加载完成（或超时）后 resolve。
 */
function loadErudaByScriptTag(): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-eruda="1"]`) as HTMLScriptElement | null;
        if (existing && (window as unknown as { eruda?: ErudaGlobal }).eruda) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = erudaUrl;
        script.async = true;
        script.dataset.eruda = '1';
        script.onload = () => {
            if (!(window as unknown as { eruda?: ErudaGlobal }).eruda) {
                reject(new Error(`Eruda 加载后 window.eruda 未定义: ${erudaUrl}`));
                return;
            }
            resolve();
        };
        script.onerror = () => reject(new Error(`Eruda 脚本加载失败: ${erudaUrl}`));
        document.head.appendChild(script);

        // 5s 兜底超时，避免阻塞后续初始化
        setTimeout(() => {
            if (!(window as unknown as { eruda?: ErudaGlobal }).eruda) {
                reject(new Error('Eruda 加载超时'));
            }
        }, 5000);
    });
}

/**
 * 初始化开发者控制台。
 * 仅在 pdev 变体且场景初始化完成后调用。
 *
 * 注意：Eruda 是 webpack UMD 打包产物，经 Vite/Rolldown 转 ESM 后
 * 内部状态被破坏（window.eruda 残缺、工具初始化抛 TypeError）。
 * 因此这里不 import('eruda')，而是以原始 UMD 文件通过 <script> 标签
 * 加载（src/public/eruda.js 经 vite public 目录原样拷贝到 dist），
 * 保证 window.eruda 为完整 API。
 */
export async function initDevConsole(mainWindow: MainWindow): Promise<void> {
    if (typeof __PDEV__ === 'undefined' || !__PDEV__) return;
    if (erudaReady) return;

    try {
        await loadErudaByScriptTag();
        const eruda = (window as unknown as { eruda?: ErudaGlobal }).eruda;
        if (!eruda) {
            throw new Error('window.eruda 未定义');
        }

        eruda.init({
            // 注意：不能传 container: document.body。
            // Eruda _initContainer 会对传入 container 执行 e.style.all = "initial" 并设 e.id = "eruda"，
            // 这会直接污染 body 内联样式，导致 body 变成 display:inline、宽高塌缩为 0×0，前端界面消失。
            // 不传 container 时 Eruda 自建隔离容器 div（挂在 <html> 下，all:initial 只作用于其自身子树）。
            tool: ['console', 'elements', 'network', 'resources', 'info', 'snippets'],
            autoScale: true,
            defaults: {
                displaySize: 50,
                transparency: 0.9,
                theme: 'Dark',
            },
        });

        // 防御性兜底：确保 body 内联样式未被污染（all: initial 会让 body 变为 inline/0×0）
        document.body.style.all = '';

        erudaReady = true;
        console.log('[DevConsole] Eruda 已初始化');
    } catch (error) {
        console.error('[DevConsole] Eruda 加载失败:', error);
    }

    // 暴露 dev 全局对象
    const devGlobal: DevGlobal = {
        async refreshPlugins(): Promise<void> {
            await refreshDevPlugins(mainWindow);
        },
        createContext(pluginId: string): PluginContext {
            return mainWindow.createPluginContext(pluginId);
        },
        showConsole(): void {
            if (erudaReady) {
                const eruda = (window as unknown as { eruda?: ErudaGlobal }).eruda;
                eruda?.get('console')?.show();
            }
        },
    };

    (window as any).__dev = devGlobal;

    // 创建可拖动刷新按钮
    createDraggableRefreshButton(devGlobal);
}

/**
 * 热重载插件：
 * 1. 注销所有非内置插件的 tab 和 overlay
 * 2. 释放所有非内置插件资源并清空注册表
 * 3. 重新加载开发插件（本地磁盘）与磁盘安装插件
 * 4. 重新注册 tab 和 overlay
 */
async function refreshDevPlugins(mainWindow: MainWindow): Promise<void> {
    console.log('[DevConsole] 开始热重载插件...');

    // 1. 注销 UI
    mainWindow.unregisterPluginTabs();
    mainWindow.unmountPluginOverlays();

    // 2. 释放所有非内置插件资源
    const allPlugins = pluginRegistry.getAll();
    for (const entry of allPlugins) {
        if (!entry.builtIn) {
            pluginRegistry.unregister(entry.manifest.id);
        }
    }

    // 3. 重新加载开发插件与磁盘插件
    await pluginLoader.loadFromDevFolder((pluginId: string) => {
        return mainWindow.createPluginContext(pluginId);
    });
    await pluginLoader.loadFromDisk((pluginId: string) => {
        return mainWindow.createPluginContext(pluginId);
    });

    // 4. 重新注册 UI
    mainWindow.registerPluginTabs();
    mainWindow.mountPluginOverlays();

    console.log('[DevConsole] 插件热重载完成');
}

// ─────────────────────────────────────────────
// 可拖动 SVG 刷新按钮
// ─────────────────────────────────────────────

function createDraggableRefreshButton(devGlobal: DevGlobal): void {
    const btn = document.createElement('div');
    btn.id = 'pdev-refresh-btn';
    btn.style.cssText = [
        'position:fixed',
        'z-index:99998',
        'width:44px',
        'height:44px',
        'border-radius:50%',
        'background:rgba(75,63,227,0.9)',
        'box-shadow:0 2px 8px rgba(0,0,0,0.3)',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'cursor:pointer',
        'touch-action:none',
        'user-select:none',
        '-webkit-user-select:none',
        'transition:transform 0.15s ease',
    ].join(';');

    // 刷新图标 SVG
    btn.innerHTML = `
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 2v6h-6"/>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
            <path d="M3 22v-6h6"/>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        </svg>
    `;

    // 初始位置：右上角
    let posX = window.innerWidth - 60;
    let posY = 80;
    btn.style.left = posX + 'px';
    btn.style.top = posY + 'px';

    document.body.appendChild(btn);

    // 拖拽逻辑
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startPosX = 0;
    let startPosY = 0;
    let hasMoved = false;

    const DRAG_THRESHOLD = 5;

    function onPointerDown(e: PointerEvent): void {
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        startPosX = posX;
        startPosY = posY;
        btn.style.transition = 'none';
        btn.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent): void {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
            hasMoved = true;
        }
        posX = Math.max(0, Math.min(window.innerWidth - 44, startPosX + dx));
        posY = Math.max(0, Math.min(window.innerHeight - 44, startPosY + dy));
        btn.style.left = posX + 'px';
        btn.style.top = posY + 'px';
    }

    function onPointerUp(e: PointerEvent): void {
        isDragging = false;
        btn.style.transition = 'transform 0.15s ease';
        btn.releasePointerCapture(e.pointerId);
        // 未移动 = 点击，触发刷新
        if (!hasMoved) {
            btn.style.transform = 'scale(0.85)';
            setTimeout(() => { btn.style.transform = 'scale(1)'; }, 150);
            devGlobal.refreshPlugins();
        }
    }

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerUp);
}
