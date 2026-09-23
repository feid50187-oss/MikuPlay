import type {
    PluginManifest,
    PluginExports,
    UIPluginExports,
    ShadingPluginExports,
    PostProcessPluginExports,
    FunctionalPluginExports,
} from '../core/IPlugin';
import type { MpApi } from './PluginApiFactory';

/**
 * 校验插件导出是否符合 manifest 声明的契约。
 * 失败时抛错，由调用方捕获并跳过该插件。
 */
function validateExports(manifest: PluginManifest, data: PluginExports): void {
    const id = manifest.id;
    if (manifest.type === 'ui') {
        if (typeof (data as UIPluginExports).createPanel !== 'function') {
            throw new Error(`插件 ${id} 未导出 createPanel 函数`);
        }
    } else if (manifest.target === 'shading') {
        if (!(data as ShadingPluginExports).adapter) {
            throw new Error(`插件 ${id} 未导出 adapter`);
        }
    } else if (manifest.target === 'postproc') {
        if (!(data as PostProcessPluginExports).adapter) {
            throw new Error(`插件 ${id} 未导出 adapter`);
        }
    } else if (manifest.target === 'ground' || manifest.target === 'particle') {
        if (!(data as FunctionalPluginExports).preset) {
            throw new Error(`插件 ${id} 未导出 preset`);
        }
    }
}

/**
 * 插件执行器（黑名单模式）。
 * 不再伪装沙箱：插件与宿主同 realm，宿主把 API 挂到全局命名空间 window.mp / window.BABYLON，
 * 插件代码可直接访问 window/fetch/document 等全局。宿主唯一的防线是"不把 Filesystem 等
 * 危险对象挂上全局"。导出在评估后做 shape 校验。
 */
export class PluginExecutor {
    private babylon: any = null;

    async evaluate(code: string, api: MpApi, manifest: PluginManifest): Promise<PluginExports> {
        if (!this.babylon) {
            this.babylon = await import('./babylon-reexport');
        }
        // 黑名单：宿主级全局暴露点（唯一允许挂载的全局命名空间）
        (globalThis as any).mp = api;
        (globalThis as any).BABYLON = this.babylon;

        const fn = new Function(
            `"use strict";\n${code}\nreturn typeof exports !== 'undefined' ? exports : {};`
        );
        const data = fn() as PluginExports;
        validateExports(manifest, data);
        return data;
    }
}
