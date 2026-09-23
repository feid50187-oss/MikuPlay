
import { Capacitor } from '@capacitor/core';
import { RegisterDxBmpTextureLoader } from 'babylon-mmd/esm/Loader/registerDxBmpTextureLoader';
import { MainWindow } from './UIComponents/MainWindow';

// 注册 BMP 纹理加载器，修复 BMP 纹理 alpha 通道问题
RegisterDxBmpTextureLoader();
import { eventBus } from './core';
import { styleManager } from './styles/styleManager';
import { commonStyles } from './styles/shared';
import { initTheme } from './styles/theme';
import {
    BackgroundStateManager,
    GroundStateManager,
    ParticleStateManager,
    PostProcStateManager,
    ModelOptStateManager
} from './features/state';
import { WorldPanel } from './UIComponents/featurePanels/world';
import { registerBuiltinPlugins } from './plugins/BuiltinPluginRegistrar';
import { pluginLoader } from './plugins/PluginLoader';

class App {
    private mainWindow: MainWindow | null = null;
    private initialized: boolean = false;

    public init(): void {
        document.addEventListener('DOMContentLoaded', () => {
            this.onDeviceReady();
        });

        if (Capacitor.isNativePlatform()) {
            document.addEventListener('deviceready', () => {
                this.onDeviceReady();
            }, false);
        }
    }

    private onDeviceReady(): void {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        styleManager.inject('shared-common', commonStyles);
        initTheme();

        registerBuiltinPlugins();

        this.mainWindow = new MainWindow();
        this.mainWindow.mount();

        this.mainWindow.onSceneInitialized(async () => {
            await this.loadPluginsFromDisk();
        });
    }

    private async loadPluginsFromDisk(): Promise<void> {
        if (!this.mainWindow) return;

        const mainWindow = this.mainWindow;

        // 1. 先加载开发环境插件（Web端 DEV 模式 或 pdev 变体手机本地磁盘）
        await pluginLoader.loadFromDevFolder((pluginId: string) => {
            return mainWindow.createPluginContext(pluginId);
        });

        // 2. 再加载磁盘插件（注册表中的已安装插件）
        await pluginLoader.loadFromDisk((pluginId: string) => {
            return mainWindow.createPluginContext(pluginId);
        });

        mainWindow.registerPluginTabs();
        mainWindow.mountPluginOverlays();

        // 3. pdev 变体：初始化开发者控制台（Eruda + 可拖动刷新按钮）
        if (typeof __PDEV__ !== 'undefined' && __PDEV__) {
            const { initDevConsole } = await import('./devconsole');
            await initDevConsole(mainWindow);
        }
    }

    public getMainWindow(): MainWindow | null {
        return this.mainWindow;
    }
}

const app = new App();
app.init();

(window as unknown as { eventBus: typeof eventBus }).eventBus = eventBus;

const globalWindow = window as unknown as {
    BackgroundStateManager: typeof BackgroundStateManager;
    GroundStateManager: typeof GroundStateManager;
    ParticleStateManager: typeof ParticleStateManager;
    PostProcStateManager: typeof PostProcStateManager;
    ModelOptStateManager: typeof ModelOptStateManager;
    WorldPanel: typeof WorldPanel;
};
globalWindow.BackgroundStateManager = BackgroundStateManager;
globalWindow.GroundStateManager = GroundStateManager;
globalWindow.ParticleStateManager = ParticleStateManager;
globalWindow.PostProcStateManager = PostProcStateManager;
globalWindow.ModelOptStateManager = ModelOptStateManager;
globalWindow.WorldPanel = WorldPanel;

export { App };
