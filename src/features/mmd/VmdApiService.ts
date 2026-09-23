/**
 * VMD 动作 API 服务
 * 开放 VMD 动作解析、读写接口，供插件调用
 */
import type { AnimationManager } from './AnimationManager';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';
import { detectVmdType, VmdType } from '../../utils/fileValidation';
import { fetchFileAsArrayBuffer } from '../../utils/platform';

export interface VmdBoneFrame {
    frame: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
}

export interface VmdMorphFrame {
    frame: number;
    weight: number;
}

export interface VmdCameraFrame {
    frame: number;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    distance: number;
    fov: number;
}

export interface VmdAnimationInfo {
    name: string;
    type: 'motion' | 'camera';
    boneNames: string[];
    morphNames: string[];
    maxFrame: number;
}

export class VmdApiService {
    private animationManager: AnimationManager | null = null;

    setAnimationManager(manager: AnimationManager): void {
        this.animationManager = manager;
    }

    /**
     * 解析 VMD 文件
     */
    async parseVmd(filePath: string): Promise<MmdAnimation> {
        if (!this.animationManager) {
            throw new Error('AnimationManager 未初始化');
        }

        const buffer = await fetchFileAsArrayBuffer(filePath);
        const vmdType = detectVmdType(buffer);

        // 使用 vmdLoader 解析
        const vmdLoader = (this.animationManager as any).vmdLoader;
        if (!vmdLoader) {
            throw new Error('VmdLoader 未初始化');
        }

        const animation = await vmdLoader.loadFromBufferAsync(
            `parsed_${Date.now()}`,
            buffer
        );

        return animation;
    }

    /**
     * 获取动画信息摘要
     */
    getAnimationInfo(animation: MmdAnimation): VmdAnimationInfo {
        const boneNames = Array.from(animation.boneTrackNames || []);
        const morphNames = Array.from(animation.morphTrackNames || []);

        // 计算最大帧
        let maxFrame = 0;
        for (const track of animation.boneTracks || []) {
            if (track.frames.length > 0) {
                const lastFrame = track.frames[track.frames.length - 1].frameIndex;
                if (lastFrame > maxFrame) maxFrame = lastFrame;
            }
        }

        return {
            name: animation.name,
            type: 'motion',
            boneNames,
            morphNames,
            maxFrame
        };
    }

    /**
     * 获取骨骼帧数据
     */
    getBoneFrames(animation: MmdAnimation, boneName: string): VmdBoneFrame[] {
        const trackIndex = (animation.boneTrackNames || []).indexOf(boneName);
        if (trackIndex < 0) return [];

        const track = animation.boneTracks[trackIndex];
        if (!track) return [];

        return track.frames.map((f: any) => ({
            frame: f.frameIndex,
            position: {
                x: f.position?.x ?? 0,
                y: f.position?.y ?? 0,
                z: f.position?.z ?? 0
            },
            rotation: {
                x: f.rotation?.x ?? 0,
                y: f.rotation?.y ?? 0,
                z: f.rotation?.z ?? 0,
                w: f.rotation?.w ?? 1
            }
        }));
    }

    /**
     * 获取形变帧数据
     */
    getMorphFrames(animation: MmdAnimation, morphName: string): VmdMorphFrame[] {
        const trackIndex = (animation.morphTrackNames || []).indexOf(morphName);
        if (trackIndex < 0) return [];

        const track = animation.morphTracks[trackIndex];
        if (!track) return [];

        return track.frames.map((f: any) => ({
            frame: f.frameIndex,
            weight: f.weight ?? 0
        }));
    }

    /**
     * 获取镜头帧数据
     */
    getCameraFrames(animation: MmdAnimation): VmdCameraFrame[] {
        const track = animation.cameraTrack;
        if (!track) return [];

        return track.frames.map((f: any) => ({
            frame: f.frameIndex,
            position: {
                x: f.position?.x ?? 0,
                y: f.position?.y ?? 0,
                z: f.position?.z ?? 0
            },
            rotation: {
                x: f.rotation?.x ?? 0,
                y: f.rotation?.y ?? 0,
                z: f.rotation?.z ?? 0
            },
            distance: f.distance ?? 0,
            fov: f.fov ?? 0
        }));
    }

    /**
     * 修改骨骼帧数据
     */
    setBoneFrame(
        animation: MmdAnimation,
        boneName: string,
        frameIndex: number,
        data: Partial<{ position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number; w: number } }>
    ): boolean {
        const trackIndex = (animation.boneTrackNames || []).indexOf(boneName);
        if (trackIndex < 0) return false;

        const track = animation.boneTracks[trackIndex];
        if (!track) return false;

        // 查找或创建帧
        let frame = track.frames.find((f: any) => f.frameIndex === frameIndex);
        if (!frame) {
            // 创建新帧
            frame = { frameIndex };
            track.frames.push(frame);
            track.frames.sort((a: any, b: any) => a.frameIndex - b.frameIndex);
        }

        if (data.position) {
            frame.position = { ...data.position };
        }
        if (data.rotation) {
            frame.rotation = { ...data.rotation };
        }

        return true;
    }

    /**
     * 修改形变帧数据
     */
    setMorphFrame(
        animation: MmdAnimation,
        morphName: string,
        frameIndex: number,
        weight: number
    ): boolean {
        const trackIndex = (animation.morphTrackNames || []).indexOf(morphName);
        if (trackIndex < 0) return false;

        const track = animation.morphTracks[trackIndex];
        if (!track) return false;

        let frame = track.frames.find((f: any) => f.frameIndex === frameIndex);
        if (!frame) {
            frame = { frameIndex };
            track.frames.push(frame);
            track.frames.sort((a: any, b: any) => a.frameIndex - b.frameIndex);
        }

        frame.weight = weight;
        return true;
    }

    /**
     * 导出动画为 VMD 字节流
     */
    async exportVmd(animation: MmdAnimation, fileName: string): Promise<Blob> {
        // VMD 导出需要 babylon-mmd 的 VmdWriter
        // 当前版本可能未包含，后续可扩展
        throw new Error('VMD 导出功能暂未实现，待 babylon-mmd VmdWriter 可用后启用');
    }

    /**
     * 列出当前已加载的所有动画
     */
    listLoadedAnimations(): Array<{ id: string; name: string; modelId: string }> {
        if (!this.animationManager) return [];

        const result: Array<{ id: string; name: string; modelId: string }> = [];
        for (const [id, info] of this.animationManager.getAllAnimations()) {
            result.push({
                id: info.id,
                name: info.name,
                modelId: info.modelId
            });
        }
        return result;
    }

    /**
     * 加载动画到指定模型
     */
    async loadAnimationToModel(
        filePath: string,
        fileName: string,
        modelId: string
    ): Promise<void> {
        if (!this.animationManager) {
            throw new Error('AnimationManager 未初始化');
        }

        const modelManager = (this.animationManager as any).modelManagerProvider?.();
        if (!modelManager) {
            throw new Error('ModelManager 未初始化');
        }

        const model = modelManager.getModel(modelId);
        if (!model?.mesh) {
            throw new Error(`模型 ${modelId} 未找到`);
        }

        await this.animationManager.loadAnimation(
            filePath,
            fileName,
            modelId,
            model.mesh,
            'blend'
        );
    }
}

// 全局单例
export const vmdApiService = new VmdApiService();
