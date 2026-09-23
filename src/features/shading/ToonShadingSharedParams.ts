import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

/** 变体贴图参数名（每材质作用域，由适配器管理） */
export const TOON_TEXTURE_PARAMS = [
    'normalMap',
] as const;
export type ToonTextureParam = (typeof TOON_TEXTURE_PARAMS)[number];

/**
 * Toon 全局共享风格参数。
 *
 * 全局共享的风格参数（光照/阴影/边缘光/环境光/time），
 * 变体贴图则是每材质单独挂载。
 */
export class ToonShadingSharedParams {
    private static _instance: ToonShadingSharedParams | null = null;

    static get instance(): ToonShadingSharedParams {
        if (!ToonShadingSharedParams._instance) {
            ToonShadingSharedParams._instance = new ToonShadingSharedParams();
        }
        return ToonShadingSharedParams._instance;
    }

    // ---- 共享风格参数（全局单例，改一处所有 toon 材质生效） ----
    rimLightWidth = 1;
    rimLightIntensity = 1;
    ambient = 0.75;
    unlit = 0;

    private readonly _materials = new Set<ShaderMaterial>();
    private _white: DynamicTexture | null = null;

    /** 注册材质：写入全部共享风格参数 */
    register(scene: Scene, mat: ShaderMaterial): void {
        this._materials.add(mat);
        this.syncMaterial(mat);
    }

    unregister(mat: ShaderMaterial): void {
        this._materials.delete(mat);
    }

    /** 把全部共享风格参数写入单个材质 */
    syncMaterial(mat: ShaderMaterial): void {
        mat.setFloat('uRimLightWidth', this.rimLightWidth);
        mat.setFloat('uRimLightIntensity', this.rimLightIntensity);
        mat.setFloat('uAmbient', this.ambient);
        mat.setFloat('uUnlit', this.unlit);
    }

    /** 推送全部共享风格参数到所有已注册材质 */
    syncAll(): void {
        for (const m of this._materials) this.syncMaterial(m);
    }

    /** 获取共享的 1x1 白色纹理（变体贴图空值时的兜底） */
    getWhite(scene: Scene): DynamicTexture {
        if (!this._white) {
            const tex = new DynamicTexture('toon_shared_white_1x1', { width: 1, height: 1 }, scene, false, Texture.NEAREST_NEAREST);
            const ctx = tex.getContext();
            if (ctx) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 1, 1);
            }
            tex.update();
            this._white = tex;
        }
        return this._white;
    }
}