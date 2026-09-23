import type { AssetContainer, AbstractMesh, Scene } from '@babylonjs/core';
import type { AnimationManager } from './AnimationManager';
import { BoneManager } from './BoneManager';

export interface ModelDisposeContext {
    modelId: string;
    mesh: AbstractMesh | null;
    container: AssetContainer | null;
    animationManager: AnimationManager;
    lightManager?: any;
}

/**
 * 统一释放 MMD 模型全生命周期资源
 *
 * 释放顺序：运行时 → 阴影关系 → AssetContainer → 纹理 → metadata → 骨骼可视化
 */
export async function disposeMmdModelResources(ctx: ModelDisposeContext): Promise<void> {
    const { modelId, mesh, container, animationManager, lightManager } = ctx;

    // 1. 运行时解绑（必须先做，防止动画/物理在销毁过程中写骨骼）
    animationManager.clearAnimations(modelId);
    animationManager.destroyMmdModel(modelId);

    // 2. 解除阴影关系（必须在 mesh 被 dispose 前）
    if (mesh && lightManager) {
        const allMeshes = [mesh, ...mesh.getChildMeshes()];
        for (const m of allMeshes) {
            try { lightManager.removeShadowCaster?.(m); } catch { /* ignore */ }
            try { lightManager.unregisterShadowReceiver?.(m); } catch { /* ignore */ }
        }
    }

    // 3. 释放 AssetContainer 前，先保护被场景中其他材质共享的纹理
    //    MmdAsyncTextureLoader 的纹理缓存机制会导致同一模型多次导入时共享同一个 Texture 对象，
    //    如果不提前移除，container.dispose() 会无条件释放所有纹理，导致其他模型实例材质丢失。
    if (container) {
        const scene: Scene = (container as any).scene;
        if (scene) {
            const containerMaterials = new Set(container.materials);
            const sharedTextures = new Set<any>();

            for (const material of container.materials) {
                const mat = material as any;
                if (typeof mat.getActiveTextures === 'function') {
                    for (const texture of mat.getActiveTextures()) {
                        if (!texture) continue;
                        const isUsedElsewhere = scene.materials.some((m: any) =>
                            !containerMaterials.has(m) && m.getActiveTextures?.().includes(texture)
                        );
                        if (isUsedElsewhere) {
                            sharedTextures.add(texture);
                        }
                    }
                }
            }

            // 将共享纹理从 container.textures 中移除，避免 container.dispose() 释放它们
            if (sharedTextures.size > 0) {
                container.textures = container.textures.filter((t: any) => !sharedTextures.has(t));
            }
        }

        container.removeAllFromScene();
        container.dispose();
    }

    // 5. 清理 metadata（容器已 dispose，但 metadata 是挂在 rootMesh 上的自定义大对象）
    if (mesh) {
        if (mesh.metadata) {
            const md = mesh.metadata;
            if (Array.isArray(md.meshes)) md.meshes.length = 0;
            if (Array.isArray(md.materials)) md.materials.length = 0;
            if (Array.isArray(md.bones)) md.bones.length = 0;
            if (Array.isArray(md.morphs)) md.morphs.length = 0;
            mesh.metadata = null;
        }
    }

    // 6. 骨骼可视化清理
    BoneManager.getInstance().clearModelData(modelId);

    // 让出主线程，辅助 GC
    await new Promise(resolve => setTimeout(resolve, 0));
}
