
import { Scene, AssetContainer, BaseTexture } from '@babylonjs/core';
import { MmdStandardMaterial } from 'babylon-mmd/esm/Loader/mmdStandardMaterial';
import { MmdStandardMaterialBuilder } from 'babylon-mmd/esm/Loader/mmdStandardMaterialBuilder';
import type { MaterialInfo, TextureInfo } from 'babylon-mmd/esm/Loader/IMmdMaterialBuilder';
import type { ILogger } from 'babylon-mmd/esm/Loader/Parser/ILogger';
import type { ReferenceFileResolver, IArrayBufferFile } from 'babylon-mmd/esm/Loader/referenceFileResolver';
import { textureDownsampler } from './textureDownsampler';

interface ArrayBufferFile extends IArrayBufferFile {
    data: ArrayBuffer;
}

function isArrayBufferFile(file: File | ArrayBufferFile): file is ArrayBufferFile {
    return 'data' in file && file.data instanceof ArrayBuffer;
}

export class DownsampleMaterialBuilder extends MmdStandardMaterialBuilder {
    private async loadDownsampledTexture(
        imagePathTable: readonly string[],
        textureInfo: TextureInfo | null,
        scene: Scene,
        referenceFileResolver: ReferenceFileResolver,
        rootUrl: string
    ): Promise<BaseTexture | null> {
        if (!textureInfo || textureInfo.imagePathIndex < 0) {
            return null;
        }

        const texturePath = imagePathTable[textureInfo.imagePathIndex];
        if (!texturePath) {
            return null;
        }

        const file = referenceFileResolver.resolve(texturePath);
        let textureData: ArrayBuffer | null = null;
        let textureKey: string = texturePath;

        if (file && isArrayBufferFile(file)) {
            textureData = file.data;
            textureKey = file.relativePath || texturePath;
        }
        else if (file instanceof File) {
            try {
                textureData = await file.arrayBuffer();
                textureKey = (file as any).webkitRelativePath || file.name || texturePath;
            } catch (error) {
                console.error('[DownsampleMaterialBuilder] Failed to read file:', error);
                return null;
            }
        }
        else {
            try {
                const textureUrl = rootUrl + texturePath;
                const response = await fetch(textureUrl);
                if (!response.ok) {
                    return null;
                }
                textureData = await response.arrayBuffer();
            } catch (error) {
                console.error('[DownsampleMaterialBuilder] Failed to fetch texture:', error);
                return null;
            }
        }

        if (!textureData) {
            return null;
        }

        const downsampledTexture = await textureDownsampler.downsample(
            textureData,
            textureKey,
            scene
        );

        return downsampledTexture;
    }

    override async loadDiffuseTexture(
        uniqueId: number,
        material: MmdStandardMaterial,
        materialInfo: MaterialInfo,
        imagePathTable: readonly string[],
        textureInfo: TextureInfo | null,
        scene: Scene,
        assetContainer: AssetContainer | null,
        rootUrl: string,
        referenceFileResolver: ReferenceFileResolver,
        logger: ILogger,
        onTextureLoadComplete?: () => void
    ): Promise<void> {
        const texture = await this.loadDownsampledTexture(
            imagePathTable,
            textureInfo,
            scene,
            referenceFileResolver,
            rootUrl
        );

        if (texture) {
            material.diffuseTexture = texture as any;
            onTextureLoadComplete?.();
            return;
        }

        await super.loadDiffuseTexture(
            uniqueId,
            material,
            materialInfo,
            imagePathTable,
            textureInfo,
            scene,
            assetContainer,
            rootUrl,
            referenceFileResolver,
            logger,
            onTextureLoadComplete
        );
    }

    override async loadSphereTexture(
        uniqueId: number,
        material: MmdStandardMaterial,
        materialInfo: MaterialInfo,
        imagePathTable: readonly string[],
        textureInfo: TextureInfo | null,
        scene: Scene,
        assetContainer: AssetContainer | null,
        rootUrl: string,
        referenceFileResolver: ReferenceFileResolver,
        logger: ILogger,
        onTextureLoadComplete?: () => void
    ): Promise<void> {
        const texture = await this.loadDownsampledTexture(
            imagePathTable,
            textureInfo,
            scene,
            referenceFileResolver,
            rootUrl
        );

        if (texture) {
            material.sphereTexture = texture as any;
            // 设置Spa贴图混合模式，参考mmdStandardMaterialBuilder实现
            if (materialInfo.sphereTextureMode !== undefined) {
                material.sphereTextureBlendMode = materialInfo.sphereTextureMode as any;
            }
            onTextureLoadComplete?.();
            return;
        }

        await super.loadSphereTexture(
            uniqueId,
            material,
            materialInfo,
            imagePathTable,
            textureInfo,
            scene,
            assetContainer,
            rootUrl,
            referenceFileResolver,
            logger,
            onTextureLoadComplete
        );
    }

    override async loadToonTexture(
        uniqueId: number,
        material: MmdStandardMaterial,
        materialInfo: MaterialInfo,
        imagePathTable: readonly string[],
        textureInfo: TextureInfo | null,
        scene: Scene,
        assetContainer: AssetContainer | null,
        rootUrl: string,
        referenceFileResolver: ReferenceFileResolver,
        logger: ILogger,
        onTextureLoadComplete?: () => void
    ): Promise<void> {
        const texture = await this.loadDownsampledTexture(
            imagePathTable,
            textureInfo,
            scene,
            referenceFileResolver,
            rootUrl
        );

        if (texture) {
            material.toonTexture = texture as any;
            onTextureLoadComplete?.();
            return;
        }

        await super.loadToonTexture(
            uniqueId,
            material,
            materialInfo,
            imagePathTable,
            textureInfo,
            scene,
            assetContainer,
            rootUrl,
            referenceFileResolver,
            logger,
            onTextureLoadComplete
        );
    }
}
