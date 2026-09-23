
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { MmdAnimation } from 'babylon-mmd/esm/Loader/Animation/mmdAnimation';
import type { MmdBoneAnimationTrack, MmdMovableBoneAnimationTrack } from 'babylon-mmd/esm/Loader/Animation/mmdAnimationTrack';

/**
 * 动画数据修正管理器
 * 用于永久修改动画数据中的骨骼旋转
 */
export class AnimationCorrectionManager {
    private static instance: AnimationCorrectionManager;

    // 预分配临时对象，消除循环内分配
    private static readonly _AxisX = new Vector3(1, 0, 0);
    private static readonly _AxisY = new Vector3(0, 1, 0);
    private static readonly _AxisZ = new Vector3(0, 0, 1);
    private static readonly _WorkQuat1 = new Quaternion();
    private static readonly _WorkQuat2 = new Quaternion();
    private static readonly _WorkQuat3 = new Quaternion();
    private static readonly _WorkQuat4 = new Quaternion();

    private constructor() {}

    static getInstance(): AnimationCorrectionManager {
        if (!AnimationCorrectionManager.instance) {
            AnimationCorrectionManager.instance = new AnimationCorrectionManager();
        }
        return AnimationCorrectionManager.instance;
    }

    /**
     * 对动画数据中的指定骨骼应用旋转偏移（永久修改，支持帧范围）
     * @param animation MmdAnimation 实例
     * @param boneName 骨骼名称
     * @param axis 旋转轴 ('x' | 'y' | 'z')
     * @param angleOffset 偏移角度（弧度）
     * @param frameRange 帧范围 {start, end}，可选
     */
    applyRotationOffsetToAnimation(
        animation: MmdAnimation,
        boneName: string,
        axis: 'x' | 'y' | 'z',
        angleOffset: number,
        frameRange?: { start: number; end: number }
    ): boolean {
        const boneTrack = this.findBoneTrack(animation, boneName);
        if (!boneTrack) {
            console.warn(`未找到骨骼 ${boneName} 的动画轨道`);
            return false;
        }

        // 创建偏移四元数（使用预分配临时对象）
        const axisVector = axis === 'x' ? AnimationCorrectionManager._AxisX
            : axis === 'y' ? AnimationCorrectionManager._AxisY
            : AnimationCorrectionManager._AxisZ;
        Quaternion.RotationAxisToRef(axisVector, angleOffset, AnimationCorrectionManager._WorkQuat1);
        const offsetQuaternion = AnimationCorrectionManager._WorkQuat1;

        const rotations = boneTrack.rotations;
        const frameNumbers = boneTrack.frameNumbers;
        const frameCount = frameNumbers.length;

        // 默认范围：全部帧号
        const startFrame = frameRange?.start ?? 0;
        const endFrame = frameRange?.end ?? (frameNumbers[frameCount - 1] ?? 0);

        // 验证范围有效性
        const clampedStart = Math.max(0, startFrame);
        const clampedEnd = Math.max(clampedStart, endFrame);

        let modifiedCount = 0;

        // 遍历所有关键帧，仅处理帧号落在范围内的
        for (let i = 0; i < frameCount; i++) {
            const frameNo = frameNumbers[i];
            if (frameNo < clampedStart || frameNo > clampedEnd) continue;

            const baseIndex = i * 4;

            AnimationCorrectionManager._WorkQuat2.set(
                rotations[baseIndex],
                rotations[baseIndex + 1],
                rotations[baseIndex + 2],
                rotations[baseIndex + 3]
            );

            offsetQuaternion.multiplyToRef(AnimationCorrectionManager._WorkQuat2, AnimationCorrectionManager._WorkQuat3);

            rotations[baseIndex] = AnimationCorrectionManager._WorkQuat3.x;
            rotations[baseIndex + 1] = AnimationCorrectionManager._WorkQuat3.y;
            rotations[baseIndex + 2] = AnimationCorrectionManager._WorkQuat3.z;
            rotations[baseIndex + 3] = AnimationCorrectionManager._WorkQuat3.w;
            modifiedCount++;
        }

        console.log(`已对骨骼 ${boneName} 的帧 ${clampedStart}-${clampedEnd}（共${modifiedCount}个关键帧）应用旋转偏移`);
        return true;
    }

    /**
     * 同步应用三轴旋转偏移（永久修改，支持帧范围）
     * @param animation MmdAnimation 实例
     * @param boneName 骨骼名称
     * @param offsets {x, y, z} 偏移角度（弧度）
     * @param frameRange 帧范围 {start, end}，可选
     */
    applyRotationOffsetsSync(
        animation: MmdAnimation,
        boneName: string,
        offsets: { x: number; y: number; z: number },
        frameRange?: { start: number; end: number }
    ): boolean {
        const boneTrack = this.findBoneTrack(animation, boneName);
        if (!boneTrack) {
            console.warn(`未找到骨骼 ${boneName} 的动画轨道`);
            return false;
        }

        // 创建复合偏移四元数（按XYZ顺序叠加，使用预分配临时对象）
        AnimationCorrectionManager._WorkQuat1.copyFromFloats(0, 0, 0, 1); // offsetQuaternion = identity

        if (offsets.x !== 0) {
            Quaternion.RotationAxisToRef(AnimationCorrectionManager._AxisX, offsets.x, AnimationCorrectionManager._WorkQuat2);
            AnimationCorrectionManager._WorkQuat2.multiplyToRef(AnimationCorrectionManager._WorkQuat1, AnimationCorrectionManager._WorkQuat1);
        }

        if (offsets.y !== 0) {
            Quaternion.RotationAxisToRef(AnimationCorrectionManager._AxisY, offsets.y, AnimationCorrectionManager._WorkQuat2);
            AnimationCorrectionManager._WorkQuat2.multiplyToRef(AnimationCorrectionManager._WorkQuat1, AnimationCorrectionManager._WorkQuat1);
        }

        if (offsets.z !== 0) {
            Quaternion.RotationAxisToRef(AnimationCorrectionManager._AxisZ, offsets.z, AnimationCorrectionManager._WorkQuat2);
            AnimationCorrectionManager._WorkQuat2.multiplyToRef(AnimationCorrectionManager._WorkQuat1, AnimationCorrectionManager._WorkQuat1);
        }

        const offsetQuaternion = AnimationCorrectionManager._WorkQuat1;

        const rotations = boneTrack.rotations;
        const frameNumbers = boneTrack.frameNumbers;
        const frameCount = frameNumbers.length;

        const startFrame = frameRange?.start ?? 0;
        const endFrame = frameRange?.end ?? (frameNumbers[frameCount - 1] ?? 0);

        const clampedStart = Math.max(0, startFrame);
        const clampedEnd = Math.max(clampedStart, endFrame);

        for (let i = 0; i < frameCount; i++) {
            const frameNo = frameNumbers[i];
            if (frameNo < clampedStart || frameNo > clampedEnd) continue;

            const baseIndex = i * 4;

            AnimationCorrectionManager._WorkQuat3.set(
                rotations[baseIndex],
                rotations[baseIndex + 1],
                rotations[baseIndex + 2],
                rotations[baseIndex + 3]
            );

            offsetQuaternion.multiplyToRef(AnimationCorrectionManager._WorkQuat3, AnimationCorrectionManager._WorkQuat4);

            rotations[baseIndex] = AnimationCorrectionManager._WorkQuat4.x;
            rotations[baseIndex + 1] = AnimationCorrectionManager._WorkQuat4.y;
            rotations[baseIndex + 2] = AnimationCorrectionManager._WorkQuat4.z;
            rotations[baseIndex + 3] = AnimationCorrectionManager._WorkQuat4.w;
        }

        return true;
    }

    /**
     * 查找骨骼动画轨道
     */
    private findBoneTrack(
        animation: MmdAnimation,
        boneName: string
    ): MmdBoneAnimationTrack | MmdMovableBoneAnimationTrack | null {
        // 在普通骨骼轨道中查找
        const boneTrack = animation.boneTracks.find(track => track.name === boneName);
        if (boneTrack) return boneTrack;

        // 在可移动骨骼轨道中查找
        const movableTrack = animation.movableBoneTracks.find(track => track.name === boneName);
        if (movableTrack) return movableTrack;

        return null;
    }
}
