/**
 * 粒子系统 API 服务
 * 开放粒子系统的注册、运行、替换、自定义纹理导入等接口，供插件调用
 */
import type { ParticleManager } from './ParticleManager';
import type { ParticleParams, ParticleRenderConfig } from './types';
import { particlePresetRegistry } from './particlePresets';

export interface ParticleSystemInfo {
    name: string;
    type: string;
    enabled: boolean;
    particleCount: number;
    params: Partial<ParticleParams>;
}

export interface ParticlePresetDefinition {
    type: string;
    name: string;
    description?: string;
    defaultParams: Partial<ParticleParams>;
    renderConfig: ParticleRenderConfig;
    adjustableParams: Array<{
        key: string;
        label: string;
        min: number;
        max: number;
        step: number;
        default: number;
    }>;
}

export class ParticleApiService {
    private particleManager: ParticleManager | null = null;

    setParticleManager(manager: ParticleManager): void {
        this.particleManager = manager;
    }

    /**
     * 注册自定义粒子预设（插件用）
     */
    registerPreset(def: ParticlePresetDefinition): void {
        particlePresetRegistry.register({
            type: def.type,
            name: def.name,
            defaultParams: def.defaultParams,
            adjustableParams: def.adjustableParams,
            textureSource: def.renderConfig.textureSource,
            texture: def.renderConfig.texture,
            blendMode: def.renderConfig.blendMode,
            depthWrite: def.renderConfig.depthWrite,
            enableRotation: def.renderConfig.enableRotation,
            defaultMaxParticles: def.renderConfig.defaultMaxParticles
        });
    }

    /**
     * 创建粒子系统（插件用）
     */
    createSystem(
        pluginId: string,
        name: string,
        params: Partial<ParticleParams>,
        renderConfig: ParticleRenderConfig
    ): void {
        if (!this.particleManager) {
            throw new Error('ParticleManager 未初始化');
        }
        this.particleManager.createPluginPreset(pluginId, name, params, renderConfig);
    }

    /**
     * 更新粒子系统参数
     */
    updateParams(name: string, params: Partial<ParticleParams>): void {
        if (!this.particleManager) return;
        this.particleManager.updateParams(name, params);
    }

    /**
     * 启用/禁用粒子系统
     */
    setEnabled(name: string, enabled: boolean): void {
        if (!this.particleManager) return;
        this.particleManager.setEnabled(name, enabled);
    }

    /**
     * 移除粒子系统
     */
    removeSystem(name: string): void {
        if (!this.particleManager) return;
        this.particleManager.removeSystem(name);
    }

    /**
     * 获取粒子系统状态
     */
    getSystemState(name: string): ParticleSystemInfo | null {
        if (!this.particleManager) return null;
        const state = this.particleManager.getSystemState(name);
        if (!state) return null;
        return {
            name: state.name,
            type: state.type,
            enabled: state.enabled,
            particleCount: state.particleCount,
            params: state.params
        };
    }

    /**
     * 列出所有粒子系统
     */
    listSystems(): ParticleSystemInfo[] {
        if (!this.particleManager) return [];
        return this.particleManager.getAllSystems().map(s => ({
            name: s.name,
            type: s.type,
            enabled: s.enabled,
            particleCount: s.particleCount,
            params: s.params
        }));
    }

    /**
     * 列出所有已注册的预设
     */
    listPresets(): ParticlePresetDefinition[] {
        const presets = particlePresetRegistry.getAll();
        return presets.map(p => ({
            type: p.type,
            name: p.name,
            defaultParams: p.defaultParams,
            adjustableParams: p.adjustableParams,
            renderConfig: {
                textureSource: p.textureSource,
                texture: p.texture,
                blendMode: p.blendMode,
                depthWrite: p.depthWrite,
                enableRotation: p.enableRotation,
                defaultMaxParticles: p.defaultMaxParticles
            }
        }));
    }

    /**
     * 加载自定义纹理（从 URL 或 File 对象）
     */
    async loadCustomTexture(
        source: string | File,
        name?: string
    ): Promise<{ url: string; name: string }> {
        let url: string;
        let textureName = name || `custom_${Date.now()}`;

        if (typeof source === 'string') {
            url = source;
        } else {
            // File 对象转 ObjectURL
            url = URL.createObjectURL(source);
            textureName = name || source.name;
        }

        return { url, name: textureName };
    }

    /**
     * 替换现有粒子系统的纹理
     */
    replaceTexture(
        systemName: string,
        textureUrl: string
    ): void {
        if (!this.particleManager) {
            throw new Error('ParticleManager 未初始化');
        }
        // 通过 updateParams 更新纹理相关参数
        this.particleManager.updateParams(systemName, {});
        // 纹理替换需要直接访问 particleSystem，这里留扩展点
        (this.particleManager as any).replaceTexture?.(systemName, textureUrl);
    }

    /**
     * 事件监听
     */
    on(event: string, callback: (data: any) => void): void {
        this.particleManager?.on(event as any, callback);
    }

    off(event: string, callback: (data: any) => void): void {
        this.particleManager?.off(event as any, callback);
    }
}

// 全局单例
export const particleApiService = new ParticleApiService();
