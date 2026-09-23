import type { PluginContext } from '../core/IPlugin';
import type { PluginModelApi } from './ModelReadBridge';
import type { PluginFileSaveOptions, PluginFileSaveResult } from './PluginFileSaver';
import { materialAdapterRegistry, MaterialAdapterRegistry } from '../features/shading/MaterialAdapterRegistry';
import { postProcessAdapterRegistry, PostProcessAdapterRegistry } from '../features/postproc/PostProcessAdapterRegistry';
import type { particlePresetRegistry as ParticlePresetRegistryInstance } from '../features/particle/particlePresets';
import { PluginFileSaver } from './PluginFileSaver';
import { ModelReadBridge } from './ModelReadBridge';
import type * as shared from '../UIComponents/shared';

/** mp.ui 白名单 UI 组件面 */
export interface MpUiApi {
    Slider: typeof shared.Slider;
    ToggleSwitch: typeof shared.ToggleSwitch;
    Dropdown: typeof shared.Dropdown;
    RGBColorPicker: typeof shared.RGBColorPicker;
    VectorInput: typeof shared.VectorInput;
    CollapsibleSection: typeof shared.CollapsibleSection;
    toast: typeof shared.toast;
    showConfirmDialog: typeof shared.showConfirmDialog;
    icons: typeof shared.icons;
}

/** 暴露给插件的全局命名空间（黑名单白名单：此处不挂 Filesystem / PluginInstaller / registry 写方法） */
export interface MpApi {
    particlePresetRegistry: typeof ParticlePresetRegistryInstance;
    materialAdapterRegistry: MaterialAdapterRegistry;
    postProcessAdapterRegistry: PostProcessAdapterRegistry;
    file: {
        save(options: PluginFileSaveOptions): Promise<PluginFileSaveResult>;
    };
    model: PluginModelApi;
    ui: MpUiApi;
}

/**
 * 组装插件全局 API（window.mp）。
 * 黑名单原则：这里是"宿主主动暴露面"，只挂安全/期望插件使用的能力；
 * 写文件系统只能走 mp.file.save（弹窗确认），宿主绝不把 Filesystem / PluginInstaller
 * 等内部对象挂到全局。
 */
export class PluginApiFactory {
    private shared: any = null;
    private particlePresetRegistry: any = null;

    constructor(
        private fileSaver: PluginFileSaver,
        private modelBridge: ModelReadBridge,
    ) {}

    async build(context: PluginContext, pluginId: string, pluginName: string): Promise<MpApi> {
        if (!this.shared) {
            this.shared = await import('../UIComponents/shared');
        }
        if (!this.particlePresetRegistry) {
            const mod = await import('../features/particle/particlePresets');
            this.particlePresetRegistry = mod.particlePresetRegistry;
        }
        const shared = this.shared;
        return {
            particlePresetRegistry: this.particlePresetRegistry,
            materialAdapterRegistry,
            postProcessAdapterRegistry,
            file: {
                save: (options: PluginFileSaveOptions): Promise<PluginFileSaveResult> =>
                    this.fileSaver.save(pluginId, pluginName, options),
            },
            model: this.modelBridge.build(context),
            ui: {
                Slider: shared.Slider,
                ToggleSwitch: shared.ToggleSwitch,
                Dropdown: shared.Dropdown,
                RGBColorPicker: shared.RGBColorPicker,
                VectorInput: shared.VectorInput,
                CollapsibleSection: shared.CollapsibleSection,
                toast: shared.toast,
                showConfirmDialog: shared.showConfirmDialog,
                icons: shared.icons,
            },
        };
    }
}
