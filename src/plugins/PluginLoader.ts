import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type {
    PluginManifest,
    PluginExports,
    PluginContext,
    PluginRegistryData,
    RegistryEntry,
    ShadingPluginExports,
    PostProcessPluginExports,
} from '../core/IPlugin';
import { pluginRegistry } from '../core/PluginRegistry';
import { materialAdapterRegistry } from '../features/shading/MaterialAdapterRegistry';
import { postProcessAdapterRegistry } from '../features/postproc/PostProcessAdapterRegistry';
import { Events, eventBus } from '../core/index';
import { RegistryIO } from './RegistryIO';
import { PluginFileSaver } from './PluginFileSaver';
import { ModelReadBridge } from './ModelReadBridge';
import { PluginApiFactory } from './PluginApiFactory';
import { PluginExecutor } from './PluginExecutor';
import { type PluginSource, createDevPluginSource } from './PluginSource';

/**
 * 插件系统门面：负责插件加载 / 安装 / 卸载 / 启停的编排。
 * 已拆分出的职责：注册表 I/O（RegistryIO）、文件保存桥（PluginFileSaver）、
 * 模型便利层（ModelReadBridge）、全局 API 组装（PluginApiFactory）、代码执行（PluginExecutor）。
 */
export class PluginLoader {
    private registryIO = new RegistryIO();
    private fileSaver = new PluginFileSaver();
    private modelBridge = new ModelReadBridge();
    private apiFactory = new PluginApiFactory(this.fileSaver, this.modelBridge);
    private executor = new PluginExecutor();

    // ---- Registry 委托 ----

    async readRegistry(): Promise<PluginRegistryData> {
        return this.registryIO.read();
    }

    async writeRegistry(data: PluginRegistryData): Promise<void> {
        await this.registryIO.write(data);
    }

    async updateRegistryEntry(pluginId: string, updates: Partial<RegistryEntry>): Promise<void> {
        await this.registryIO.update(pluginId, updates);
    }

    async removeRegistryEntry(pluginId: string): Promise<void> {
        await this.registryIO.remove(pluginId);
    }

    // ---- 加载 ----

    /**
     * 从原生平台插件目录（Directory.Data/plugins）加载已安装插件。
     */
    async loadFromDisk(contextFactory: (pluginId: string) => PluginContext): Promise<void> {
        const registry = await this.registryIO.read();
        for (const [pluginId, entry] of Object.entries(registry.plugins)) {
            if (!entry) continue; // 防御旧 registry 遗留的 undefined 条目
            try {
                const manifest = await this.readDiskManifest(pluginId);
                if (!this.validateManifest(pluginId, manifest)) continue;
                // 禁用插件只注册到 registry，不读 index.js 也不执行
                if (!entry.enabled) {
                    pluginRegistry.register({ manifest, data: {} as PluginExports, enabled: false, builtIn: false });
                    console.log(`[PluginLoader] 插件已注册(禁用): ${manifest.name} (${manifest.id})`);
                    continue;
                }
                const code = await this.readDiskCode(pluginId);
                const assetsDir = await this.getDiskAssetsDir(pluginId);
                await this.processPlugin(pluginId, manifest, code, assetsDir, contextFactory);
            } catch (error) {
                console.error(`[PluginLoader] 加载插件 ${pluginId} 失败:`, error);
            }
        }
    }

    /**
     * 从开发插件来源加载插件。
     * - Vite dev server: 经 HTTP fetch 从 testPlugins/ 读取
     * - pdev 变体（原生平台）: 经 Capacitor Filesystem 扫描手机本地目录
     * 非开发环境返回空操作。
     */
    async loadFromDevFolder(contextFactory: (pluginId: string) => PluginContext): Promise<void> {
        const source = createDevPluginSource();
        if (!source) return;

        try {
            const pluginIds = await source.scanPluginIds();
            if (pluginIds.length === 0) {
                console.log('[PluginLoader] 开发插件目录为空或不存在');
                return;
            }
            for (const pluginId of pluginIds) {
                try {
                    const manifest = await source.readManifest(pluginId);
                    if (!this.validateManifest(pluginId, manifest)) continue;
                    const code = await source.readCode(pluginId);
                    const assetsDir = await source.getAssetsDir(pluginId);
                    await this.processPlugin(pluginId, manifest, code, assetsDir, contextFactory);
                } catch (error) {
                    console.error(`[PluginLoader] 加载开发插件 ${pluginId} 失败:`, error);
                }
            }
        } catch (error) {
            console.error('[PluginLoader] 扫描开发插件目录失败:', error);
        }
    }

    /**
     * 加载单个插件（磁盘 / 开发两条路径共用的收尾逻辑）：
     * 组装 api → 执行代码 → 注册 → 按 target 挂适配器并广播事件。
     */
    private async processPlugin(
        pluginId: string,
        manifest: PluginManifest,
        code: string,
        assetsDir: string,
        contextFactory: (pluginId: string) => PluginContext
    ): Promise<void> {
        const context = contextFactory(pluginId);
        context.assetsDir = assetsDir;
        const api = await this.apiFactory.build(context, pluginId, manifest.name);
        const data = await this.executor.evaluate(code, api, manifest);

        pluginRegistry.register({ manifest, data, enabled: true, builtIn: false });

        // 着色插件：注册材质适配器
        if (manifest.target === 'shading' && data && 'adapter' in data) {
            const shadingData = data as ShadingPluginExports;
            materialAdapterRegistry.register(shadingData.adapter);
            eventBus.emit(Events.SHADING_ADAPTER_REGISTERED, { typeId: shadingData.adapter.typeId });
        }

        // 后处理插件：注册后处理适配器
        if (manifest.target === 'postproc' && data && 'adapter' in data) {
            const ppData = data as PostProcessPluginExports;
            postProcessAdapterRegistry.register(ppData.adapter);
            eventBus.emit(Events.POSTPROC_ADAPTER_REGISTERED, { typeId: ppData.adapter.typeId });
        }

        console.log(`[PluginLoader] 已加载插件: ${manifest.name} (${manifest.id})`);
    }

    private validateManifest(pluginId: string, manifest: PluginManifest): boolean {
        if (!manifest.id || !manifest.type) {
            console.warn(`[PluginLoader] 插件 ${pluginId} manifest 缺少必需字段，跳过`);
            return false;
        }
        return true;
    }

    // ---- 磁盘插件读取（原生平台）----

    private async readDiskManifest(pluginId: string): Promise<PluginManifest> {
        const result = await Filesystem.readFile({
            path: `plugins/${pluginId}/manifest.json`,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        const data = typeof result.data === 'string' ? result.data : await this.blobToString(result.data);
        return JSON.parse(data) as PluginManifest;
    }

    private async readDiskCode(pluginId: string): Promise<string> {
        const result = await Filesystem.readFile({
            path: `plugins/${pluginId}/index.js`,
            directory: Directory.Data,
            encoding: Encoding.UTF8,
        });
        return typeof result.data === 'string' ? result.data : await this.blobToString(result.data);
    }

    private async getDiskAssetsDir(pluginId: string): Promise<string> {
        try {
            const uriResult = await Filesystem.getUri({
                path: `plugins/${pluginId}`,
                directory: Directory.Data,
            });
            return Capacitor.convertFileSrc(uriResult.uri);
        } catch {
            return '';
        }
    }

    // ---- 安装 / 卸载 / 启停 ----

    async installPlugin(sourcePath: string): Promise<string | null> {
        const { pluginInstaller } = await import('./PluginInstaller');
        const pluginsDir = await this.getPluginsBaseDir();

        const result = await pluginInstaller.install({ sourcePath, pluginsDir });
        if (!result.success) {
            return null;
        }

        await this.registryIO.update(result.manifestId, {
            version: result.version || '1.0',
            enabled: true,
            installedAt: new Date().toISOString(),
        });
        eventBus.emit(Events.PLUGIN_INSTALLED, { pluginId: result.manifestId });

        return result.manifestId;
    }

    async uninstallPlugin(pluginId: string): Promise<void> {
        const entry = pluginRegistry.get(pluginId);

        // 着色插件：注销材质适配器
        if (entry?.manifest.target === 'shading' && entry.data && 'adapter' in entry.data) {
            const shadingData = entry.data as ShadingPluginExports;
            const typeId = shadingData.adapter.typeId;
            materialAdapterRegistry.unregister(typeId);
            eventBus.emit(Events.SHADING_ADAPTER_UNREGISTERED, { typeId });
        }

        // 后处理插件：注销后处理适配器
        if (entry?.manifest.target === 'postproc' && entry.data && 'adapter' in entry.data) {
            const ppData = entry.data as PostProcessPluginExports;
            const typeId = ppData.adapter.typeId;
            ppData.adapter.dispose();
            postProcessAdapterRegistry.unregister(typeId);
            eventBus.emit(Events.POSTPROC_ADAPTER_UNREGISTERED, { typeId });
        }

        // 从内存注册表移除并释放插件资源（旧实现漏掉这步，导致卸载后 UI 仍残留）
        pluginRegistry.unregister(pluginId);

        await Filesystem.rmdir({
            path: `plugins/${pluginId}`,
            directory: Directory.Data,
            recursive: true,
        });

        try {
            await Filesystem.rmdir({
                path: `plugins/_storage/${pluginId}`,
                directory: Directory.Data,
                recursive: true,
            });
        } catch {
            // 存储目录可能不存在
        }

        await this.registryIO.remove(pluginId);
        eventBus.emit(Events.PLUGIN_UNINSTALLED, { pluginId });
    }

    async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
        await this.registryIO.update(pluginId, { enabled });
        eventBus.emit(Events.PLUGIN_ENABLED_CHANGED, { pluginId, enabled });
    }

    private async getPluginsBaseDir(): Promise<string> {
        const uriResult = await Filesystem.getUri({
            path: 'plugins',
            directory: Directory.Data,
        });
        return Capacitor.convertFileSrc(uriResult.uri);
    }

    private blobToString(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsText(blob);
        });
    }
}

export const pluginLoader = new PluginLoader();
